/**
 * Environment overrides for the database-free unit tests (see scripts/test-unit.js).
 * Every credential / database variable is blanked: dotenv never overrides variables that
 * are already set, so a developer's real backend/.env cannot reach the unit tests.
 * test/credential-handling.test.js checks that every secret-looking variable in
 * .env.example is listed here, so a newly added credential cannot be forgotten.
 */
export const BLANKED_ENV = {
  NODE_ENV: 'test',
  // data sources
  CEDA_API_KEY: '',
  CEDA_API_URL: '',
  DATA_GOV_IN_API_KEY: '',
  DATA_GOV_IN_API_URL: '',
  MANDI_DATA_PROVIDER: '',
  MANDI_ALLOW_SAMPLE_DATA: '',
  MANDI_SYNC_INTERVAL_MINUTES: '0',
  // voice + chat assistant
  GROQ_API_KEY: '',
  SARVAM_API_KEY: '',
  // e-mail
  EMAIL_PROVIDER: '',
  EMAIL_API_KEY: '',
  // Firebase Admin credentials
  FIREBASE_SERVICE_ACCOUNT_PATH: '',
  GOOGLE_APPLICATION_CREDENTIALS: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  // database: unit tests must not connect; an unusable target makes any accidental connection fail fast
  DATABASE_URL: '',
  DB_NAME: 'fasalytics_unit_tests_must_not_connect',
  DB_PASSWORD: 'not-a-real-password',
};

export default BLANKED_ENV;
