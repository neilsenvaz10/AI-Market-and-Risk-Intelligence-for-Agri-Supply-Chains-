/**
 * Locates the ML service virtualenv interpreter for the Phase 4 forecast commands.
 *
 * Resolution order:
 *   1. PYTHON_BIN / ML_PYTHON environment variable (explicit override)
 *   2. ml-service/venv            (.venv also accepted; Scripts on Windows, bin elsewhere)
 *   3. the interpreter running this script
 *
 * Returns null when nothing usable is found, so callers can fail with an
 * actionable message instead of a stack trace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(backendDir, '..');
export const mlServiceDir = path.join(repoRoot, 'ml-service');

const isWindows = process.platform === 'win32';
const executable = isWindows ? 'python.exe' : 'python3';

export function resolveMlPython({ env = process.env } = {}) {
  const override = env.ML_PYTHON || env.PYTHON_BIN;
  if (override && fs.existsSync(override)) return override;

  const candidates = [];
  for (const venvName of ['venv', '.venv']) {
    const venv = path.join(mlServiceDir, venvName);
    candidates.push(isWindows ? path.join(venv, 'Scripts', executable) : path.join(venv, 'bin', executable));
    candidates.push(isWindows ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Runs `python -m forecasting <args>` in the ml-service directory. */
export function runForecasting(pythonArgs, { spawnImpl } = {}) {
  const python = resolveMlPython();
  if (!python) {
    console.error(
      [
        '[forecast] No ML service virtualenv found.',
        `  expected: ${path.join(mlServiceDir, isWindows ? 'venv\\Scripts\\python.exe' : 'venv/bin/python')}`,
        '  create it with:',
        '    cd ml-service',
        '    python -m venv venv',
        isWindows ? '    .\\venv\\Scripts\\Activate.ps1' : '    source venv/bin/activate',
        '    pip install -r requirements.txt',
        '  or set ML_PYTHON to an interpreter that has the requirements installed.',
      ].join('\n')
    );
    process.exitCode = 2;
    return null;
  }

  const spawn = spawnImpl ?? nodeSpawn;
  const child = spawn(python, ['-m', 'forecasting', ...pythonArgs], {
    cwd: mlServiceDir,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: mlServiceDir, PYTHONUNBUFFERED: '1' },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  return child;
}
