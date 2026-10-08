/**
 * Traces one stored price record from its raw response to the API and the expected dashboard text.
 * READ-ONLY (SELECT queries and GET requests to an in-process copy of the API).
 *
 *   npm run trace:record -- --source=DATA_GOV_IN            newest non-sample row of that source
 *   npm run trace:record -- --id=123 [--out=evidence.json]  one specific row
 *
 * Run it with DB_NAME pointing at the database that holds the record (the isolated test database
 * during the live test). Output never contains credentials: raw payloads hold only source data.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { loadRow, traceRow } from '../src/pipeline/trace.js';
import { parseArgs, targetDatabaseName } from './cli-utils.js';

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.id && !args.source) throw new Error('give --id=<price id> or --source=DATA_GOV_IN|CEDA');
  if (args.id && !/^\d+$/.test(String(args.id))) throw new Error('--id must be a whole number');
  const row = await loadRow(pool, { id: args.id ? Number(args.id) : null, source: args.source });
  if (!row) throw new Error(`no matching record in database "${targetDatabaseName()}"`);

  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const fetchApi = async (p) => {
      const res = await fetch(base + p);
      return { status: res.status, body: await res.json() };
    };
    const result = { database: targetDatabaseName(), ...(await traceRow({ row, fetchApi })) };
    const text = JSON.stringify(result, null, 2);
    console.log(text);
    if (args.out && args.out !== true) {
      const outPath = path.resolve(args.out);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, `${text}\n`);
    }
    console.log(`\nVERDICT: ${result.verdict}`);
    process.exitCode = result.verdict === 'GENUINE_TRACE_PASS' ? 0 : 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .catch((err) => {
      console.error(`[trace:record] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
