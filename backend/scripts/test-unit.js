/**
 * Runs the database-free unit tests with every credential and database setting blanked.
 *
 * The developer's backend/.env may hold real API keys (CEDA_API_KEY, ...) and the
 * development database name. dotenv never overrides variables that are already set, so
 * setting them to '' here guarantees no unit test can read a real key, reach a data API
 * with it, or touch a real database by accident. (npm run test:db does the same for the
 * database-backed suites.)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLANKED_ENV } from './test-env.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn(process.execPath, ['--test', 'test/*.test.js', ...process.argv.slice(2)], {
  cwd: backendDir,
  env: { ...process.env, ...BLANKED_ENV },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
