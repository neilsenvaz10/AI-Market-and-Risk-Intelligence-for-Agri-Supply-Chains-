import app from './app.js';
import { config } from './config/index.js';
import { pool } from './db.js';

let server;

function startServer(portToUse) {
  const currentPort = Number(portToUse);
  server = app.listen(currentPort, () => {
    console.log(`=========================================`);
    console.log(`🌾 FASALYTICS Express Backend Running`);
    console.log(`📡 Port: ${currentPort}`);
    console.log(`🔗 Health Check: http://localhost:${currentPort}/api/health`);
    console.log(`🗄️  Database Check: http://localhost:${currentPort}/api/health/database`);
    console.log(`🤖 ML Service Check: http://localhost:${currentPort}/api/health/ml`);
    console.log(`=========================================`);
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
