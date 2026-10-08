import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'fasalytics',
    connectionString: process.env.DATABASE_URL || undefined,
  },
};

// Configuration reloaded with updated DB_PORT
export default config;
