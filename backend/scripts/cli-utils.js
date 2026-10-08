/**
 * Shared helpers for operator CLIs. Database writes always require
 * --confirm-db=<DB_NAME> so a command cannot write to the wrong database by accident.
 */
import { config } from '../src/config/index.js';

// Command-line arguments are visible to every process on the machine (and in shell history),
// so credentials may only come from environment variables.
const SECRET_ARGUMENT = /(^|-)(api-?key|key|token|secret|password|passwd|credentials?|private-?key)(-|$)/i;

/**
 * Parses --name / --name=value arguments. With allowPositional, bare words (e.g. a
 * sub-command) are collected in `_`. Arguments that look like secrets are refused.
 */
export function parseArgs(argv, { allowPositional = false } = {}) {
  const args = {};
  const positional = [];
  for (const arg of argv) {
    const match = arg.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
    if (!match) {
      if (allowPositional && !arg.startsWith('-')) {
        positional.push(arg);
        continue;
      }
      throw new Error(`Unrecognised argument "${arg}" (use --name=value)`);
    }
    if (SECRET_ARGUMENT.test(match[1])) {
      throw new Error(`--${match[1]} is not accepted: secrets must never be passed on the command line. Set the matching environment variable instead.`);
    }
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return allowPositional ? { ...args, _: positional } : args;
}

export function targetDatabaseName() {
  if (config.database.connectionString) return new URL(config.database.connectionString).pathname.slice(1);
  return config.database.database;
}

export function requireDatabaseConfirmation(args) {
  const target = targetDatabaseName();
  if (args['confirm-db'] !== target) {
    throw new Error(`This command writes to PostgreSQL database "${target}". Re-run with --confirm-db=${target} to proceed.`);
  }
  return target;
}

export function abortOnSignals() {
  const controller = new AbortController();
  const stop = (signal) => {
    console.warn(`\n[CLI] ${signal} received: finishing the current step, then stopping (state is checkpointed).`);
    controller.abort(Object.assign(new Error(`${signal} received`), { code: 'ABORTED' }));
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  return controller;
}
