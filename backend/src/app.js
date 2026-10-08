import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import healthRoutes from './routes/health.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Middleware
app.use(cors({
  origin: [config.frontendUrl, 'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route for convenient quick check
app.get('/', (req, res) => {
  res.json({
    name: 'FASALYTICS API Backend',
    version: '1.0.0',
    phase: 'Phase 1 - Project Setup & Architecture',
    endpoints: {
      health: '/api/health',
      databaseHealth: '/api/health/database',
      mlHealth: '/api/health/ml',
    },
  });
});

// Modular Routes
app.use('/api/health', healthRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
