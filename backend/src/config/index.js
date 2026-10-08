import dotenv from 'dotenv';
import { parseMandiConfig } from './mandiConfig.js';

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
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    // Option 1: path to a service-account JSON file (kept outside the repo)
    serviceAccountPath:
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    // Option 2: inline service-account fields
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || undefined,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    // Development only: verify tokens issued by the local Firebase Auth Emulator
    authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || undefined,
  },
  // Transactional email (welcome email). Keys stay on the backend.
  email: {
    provider: process.env.EMAIL_PROVIDER || undefined, // resend | sendgrid
    apiKey: process.env.EMAIL_API_KEY || undefined,
    from: process.env.EMAIL_FROM || undefined, // e.g. "FASALYTICS <no-reply@yourdomain.in>"
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
  },
  // Mandi pipeline: safe defaults (no provider, scheduler off, no sample-data writes).
  mandi: parseMandiConfig(process.env),
};

export default config;
