import app from './app.js';
import { config } from './config/index.js';
import { pool } from './db.js';
import { isFirebaseAdminReady } from './config/firebaseAdmin.js';
import { mandiPipeline } from './services/index.js';

let server;
let retryTimer = null;
let syncIntervalHandle = null;

const WELCOME_EMAIL_RETRY_MS = 15 * 60 * 1000;

/** Retries undelivered welcome emails at startup and every 15 minutes. */
function startWelcomeEmailRetries(welcomeEmail) {
  if (!welcomeEmail || !welcomeEmail.isConfigured || retryTimer) return;
  const run = () =>
    welcomeEmail
      .retryPending()
      .then(({ attempted }) => attempted && console.log(`[WelcomeEmail] Retry pass processed ${attempted} farmer(s).`))
      .catch((err) => console.error('[WelcomeEmail] Retry pass failed:', err.message));
  run();
  retryTimer = setInterval(run, WELCOME_EMAIL_RETRY_MS);
  retryTimer.unref();
}

/**
 * Scheduled Mandi Data Pipeline Sync
 * Runs automatically at the configured interval (MANDI_SYNC_INTERVAL_MINUTES).
 * Uses the provider configured by MANDI_DATA_PROVIDER env variable.
 */
async function runScheduledSync() {
  const providerName = config.mandi?.provider || 'MOCK';
  console.log(`[Scheduler] Starting scheduled pipeline sync (provider: ${providerName})...`);
  try {
    const result = await mandiPipeline.runPipeline({ days: 1 });
    console.log(
      `[Scheduler] Sync completed — status: ${result.status}, fetched: ${result.records_fetched}, ` +
      `inserted: ${result.records_inserted}, updated: ${result.records_updated}, ` +
      `rejected: ${result.records_rejected}, time: ${result.execution_time_ms}ms`
    );
  } catch (err) {
    console.error('[Scheduler] Scheduled pipeline sync failed:', err.message);
  }
}

function startScheduledSync() {
  const syncInterval = config.mandi?.syncIntervalMinutes ?? 60;
  const intervalMs = syncInterval * 60 * 1000;
  if (intervalMs <= 0) {
    console.log('[Scheduler] Mandi sync scheduling disabled (MANDI_SYNC_INTERVAL_MINUTES <= 0).');
    return;
  }

  // Trigger an initial sync shortly after startup (30s delay to allow DB to stabilize)
  setTimeout(() => {
    runScheduledSync();
  }, 30_000);

  // Schedule recurring sync
  syncIntervalHandle = setInterval(runScheduledSync, intervalMs);
  console.log(`[Scheduler] Mandi pipeline scheduled every ${syncInterval} minute(s) (provider: ${config.mandi?.provider || 'MOCK'})`);
}

function startServer(portToUse) {
  const currentPort = Number(portToUse);
  server = app.listen(currentPort, () => {
    console.log(`=========================================`);
    console.log(`🌾 FASALYTICS Express Backend Running`);
    console.log(`📡 Port: ${currentPort}`);
    console.log(`💓 Health Check: http://localhost:${currentPort}/api/health`);
    console.log(`🗄️  Database Check: http://localhost:${currentPort}/api/health/database`);
    console.log(`🤖 ML Service Check: http://localhost:${currentPort}/api/health/ml`);
    console.log(
      isFirebaseAdminReady()
        ? `🔐 Firebase Auth: ready (project "${config.firebase.projectId || 'from service account'}")`
        : '🔐 Firebase Auth: NOT CONFIGURED — set FIREBASE_PROJECT_ID in backend/.env (farmer APIs return 503)',
    );
    const welcomeEmail = app.locals.welcomeEmail;
    if (welcomeEmail) {
      console.log(
        welcomeEmail.isConfigured
          ? `✉️  Welcome email: ${welcomeEmail.providerName}`
          : '✉️  Welcome email: NOT CONFIGURED — set EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM (deliveries recorded as not_configured)',
      );
      startWelcomeEmailRetries(welcomeEmail);
    }
    console.log(`🌾 Mandi API: http://localhost:${currentPort}/api/mandi/mandis`);
    console.log(`=========================================`);
    startScheduledSync();
  });

  server.on('error', (err) => {
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && currentPort === 5000) {
      console.warn(`[Server] Port 5000 is unavailable (Windows EACCES exclusion). Automatically switching to port 5001...`);
      startServer(5001);
    } else {
      console.error(`[Server] Server failed to start on port ${currentPort}:`, err.message);
      process.exit(1);
    }
  });
}

startServer(config.port);

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Stop welcome email retry timer
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }

  // Stop scheduled sync
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
    console.log('[Scheduler] Pipeline sync scheduler stopped.');
  }

  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      try {
        await pool.end();
        console.log('[PostgreSQL] Connection pool drained.');
        process.exit(0);
      } catch (err) {
        console.error('[PostgreSQL] Error during pool drain:', err.message);
        process.exit(1);
      }
    });
  }

  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
