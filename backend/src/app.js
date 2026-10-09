import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import healthRoutes from './routes/health.routes.js';
import createAuthRoutes from './routes/auth.routes.js';
import createFarmerRoutes from './routes/farmer.routes.js';
import createMandiRoutes from './routes/mandi.routes.js';
import createForecastRoutes from './routes/forecast.routes.js';
import { requireAuth as defaultRequireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createEmailProvider } from './services/email/emailProvider.js';
import { createWelcomeEmailService } from './services/email/welcomeEmail.service.js';

export function createDefaultWelcomeEmailService() {
  return createWelcomeEmailService({
    provider: createEmailProvider(config.email),
    dashboardUrl: config.frontendUrl,
  });
}

/**
 * Builds the Express app. `requireAuth`, `welcomeEmail` and `mandiRoutesOptions` are
 * injectable so tests can supply a fake token verifier / email provider / ingestion
 * authoriser; production always uses Firebase Admin verification, the configured
 * email provider and denies HTTP ingestion until an admin role is approved.
 */
export function createApp({
  requireAuth = defaultRequireAuth,
  welcomeEmail = createDefaultWelcomeEmailService(),
  mandiRoutesOptions = {},
} = {}) {
  const app = express();
  app.locals.welcomeEmail = welcomeEmail;

  // Behind a reverse proxy set TRUST_PROXY (hop count such as 1, or 'loopback') so req.ip, and
  // therefore the rate limiter, sees the real client instead of the proxy address.
  const trustProxy = (process.env.TRUST_PROXY || '').trim();
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  // Middleware
  app.use(cors({
    origin: [config.frontendUrl, 'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    credentials: true,
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Root route for convenient quick check
  app.get('/', (req, res) => {
    res.json({
      name: 'FASALYTICS API Backend',
      version: '1.0.0',
      phase: 'Phase 4 - Price Forecasting',
      endpoints: {
        health: '/api/health',
        databaseHealth: '/api/health/database',
        mlHealth: '/api/health/ml',
        session: '/api/auth/session',
        farmerProfile: '/api/farmers/me',
        forecast: {
          byCommodityAndMandi: '/api/forecast/:commodity/:mandi',
          query: '?horizon=1..7&modelVersion=<version>&includeSample=false&order=ASC|DESC',
        },
        mandi: {
          mandis: '/api/mandi/mandis',
          mandiDetails: '/api/mandi/mandis/:id',
          latestPrices: '/api/mandi/prices/latest',
          priceHistory: '/api/mandi/prices/history',
          commodities: '/api/mandi/commodities',
          sync: '/api/mandi/sync',
          syncStatus: '/api/mandi/sync/status',
          qualityReport: '/api/mandi/quality/report',
        },
      },
    });
  });

  // Modular Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', createAuthRoutes(requireAuth));
  app.use('/api/farmers', createFarmerRoutes(requireAuth));
  app.use('/api/mandi', createMandiRoutes({ requireAuth, ...mandiRoutesOptions }));
  app.use('/api/forecast', createForecastRoutes());

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const app = createApp();

export default app;
