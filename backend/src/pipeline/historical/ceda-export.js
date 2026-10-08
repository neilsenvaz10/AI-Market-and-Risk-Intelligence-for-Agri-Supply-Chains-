import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { buildCedaRecords, CEDA_HISTORICAL_END, CEDA_HISTORICAL_START, splitDateRange } from '../providers/ceda.provider.js';
import { normalizeMandiRecord } from '../normalizer.js';
import { validateMandiRecord } from '../validator.js';
import { deduplicateWithinSource } from '../deduplicator.js';
import { redactText } from '../http.js';
import { createDiskGuard, Manifest, readCsvGz, sha256File, writeCsvGz } from './storage.js';

/**
 * CEDA historical export: one commodity in one district over a date range inside
 * 2021-10-01..2026-09-30 (inclusive), split into windows. Each window is one
 * checkpointed task:
 *   prices + quantities  ->  raw JSON (gzip)  ->  normalised CSV (gzip)  ->  manifest
 * Re-running with the same manifest skips completed tasks whose files still match
 * their recorded size and checksum (resume). Disk space and the download budget are
 * checked before and during every task; a stop leaves the manifest consistent.
 * Optional import persists each task's valid rows into PostgreSQL.
 */

const gzip = promisify(zlib.gzip);

export const CSV_COLUMNS = [
  'validation_status', 'rejection_codes', 'source', 'source_record_key', 'source_market_id', 'source_commodity_id',
  'source_state_id', 'source_district_id', 'source_market_name', 'source_commodity_name', 'source_state_name',
  'source_district_name', 'mandi_code', 'mandi_name', 'state', 'district', 'commodity_code', 'commodity_name',
  'variety', 'grade', 'price_date', 'min_price', 'max_price', 'modal_price', 'price_unit',
  'arrivals_quantity', 'arrival_unit', 'quality_flags', 'fetched_at',
];

export function clampToHistoricalWindow(fromDate, toDate) {
  const from = fromDate || CEDA_HISTORICAL_START;
  const to = toDate || CEDA_HISTORICAL_END;
  if (from < CEDA_HISTORICAL_START || to > CEDA_HISTORICAL_END || from > to) {
    throw new Error(`Date range must lie within ${CEDA_HISTORICAL_START}..${CEDA_HISTORICAL_END} (inclusive) and from <= to`);
  }
  return { from, to };
}

const taskId = (scope, window) => `c${scope.commodityId}_s${scope.stateId}_d${scope.districtId}_${window.from}_${window.to}`;

async function fileMatches(entry, outDir) {
  if (!entry?.csvFile) return false;
  const full = path.join(outDir, entry.csvFile);
  try {
    const stat = await fsp.stat(full);
    return stat.size === entry.csvBytes && (await sha256File(full)) === entry.csvSha256;
  } catch {
    return false;
  }
}

/**
 * @param {object} p
 * @param {import('../providers/ceda.provider.js').CedaProvider} p.provider
 * @param {object} [p.persister]  MandiPersister — only when importing
 */
export async function runCedaExport({
  provider, commodity, state, district, fromDate, toDate, outDir, windowDays = 92,
  minFreeGb = 20, budgetMb = 500, saveRaw = true, maxTasks = Infinity, persister = null,
  signal, log = console, guard: injectedGuard,
}) {
  const range = clampToHistoricalWindow(fromDate, toDate);
  await fsp.mkdir(outDir, { recursive: true });
  const guard = injectedGuard || createDiskGuard({ dir: outDir, minFreeGb, budgetMb });
  await guard.assertSpace('before start');

  const scope = await provider.resolveScope({ commodity, state, district, signal });
  const manifestPath = path.join(outDir, `manifest_c${scope.commodityId}_s${scope.stateId}_d${scope.districtId}.json`);
  const manifest = await Manifest.load(manifestPath, {
    source: 'CEDA',
    attribution: 'CEDA, Ashoka University (Agmarknet data) — non-commercial use with attribution',
    scope: { commodity: scope.commodityName, commodityId: scope.commodityId, state: scope.stateName, stateId: scope.stateId,
      district: scope.districtName, districtId: scope.districtId, markets: scope.markets },
  });
  const marketIds = (scope.markets || []).map((m) => m.market_id).filter(Boolean);
  const marketNames = new Map((scope.markets || []).map((m) => [String(m.market_id), m.market_name]));
  const summary = { tasksPlanned: 0, tasksCompleted: 0, tasksSkipped: 0, rowsWritten: 0, rowsValid: 0, rowsRejected: 0,
    imported: { inserted: 0, updated: 0, unchanged: 0, failed: 0 }, stoppedReason: null, manifestPath };

  const windows = splitDateRange(range.from, range.to, windowDays);
  summary.tasksPlanned = windows.length;
  let processed = 0;
  for (const window of windows) {
    const id = taskId(scope, window);
    const existing = manifest.task(id);
    if (existing?.status === 'done' && (await fileMatches(existing, outDir)) && (!persister || existing.imported)) {
      summary.tasksSkipped += 1;
      continue;
    }
    if (processed >= maxTasks) { summary.stoppedReason = `maxTasks (${maxTasks}) reached`; break; }
    if (signal?.aborted) { summary.stoppedReason = 'interrupted'; break; }
    processed += 1;
    try {
      await guard.assertSpace(`before task ${id}`);
      await manifest.update(id, { status: 'running', window });
      const request = { commodityId: scope.commodityId, stateId: scope.stateId, districtIds: [scope.districtId],
        ...(marketIds.length ? { marketIds } : {}),
        fromDate: window.from, toDate: window.to, signal };
      const prices = await provider.client.getPrices(request);
      const quantities = await provider.client.getQuantities(request);
      const fetchedAt = new Date().toISOString();

      const relDir = path.join('ceda', `commodity=${scope.commodityId}`, `state=${scope.stateId}`, `district=${scope.districtId}`);
      let rawFile = null;
      if (saveRaw) {
        rawFile = path.join(relDir, `${window.from}_${window.to}.raw.json.gz`);
        const rawBody = await gzip(JSON.stringify({ request: { ...request, signal: undefined }, fetchedAt, prices, quantities }));
        guard.addBytes(rawBody.length);
        await fsp.mkdir(path.join(outDir, relDir), { recursive: true });
        await fsp.writeFile(path.join(outDir, `${rawFile}.partial`), rawBody);
        await fsp.rename(path.join(outDir, `${rawFile}.partial`), path.join(outDir, rawFile));
      }

      const rows = [];
      const valid = [];
      for (const raw of buildCedaRecords(prices, quantities, { ...scope, marketNames, fetchedAt })) {
        const record = normalizeMandiRecord(raw);
        const check = validateMandiRecord(record);
        rows.push({ ...record, validation_status: check.valid ? 'valid' : 'rejected', rejection_codes: check.errors.map((e) => e.code) });
        if (check.valid) valid.push(record);
      }
      const csvFile = path.join(relDir, `${window.from}_${window.to}.csv.gz`);
      const written = await writeCsvGz(path.join(outDir, csvFile), CSV_COLUMNS, rows, { guard });

      let imported = null;
      if (persister) {
        const { uniqueRecords, conflicts } = deduplicateWithinSource(valid);
        imported = await persister.persistBatch(uniqueRecords, { batchConflicts: conflicts });
        for (const key of Object.keys(summary.imported)) summary.imported[key] += imported[key];
      }
      await manifest.update(id, {
        status: 'done', window, csvFile, csvBytes: written.bytes, csvSha256: written.sha256, rawFile,
        priceRows: prices.length, quantityRows: quantities.length, rowsWritten: written.rows,
        rowsValid: valid.length, rowsRejected: rows.length - valid.length, fetchedAt,
        imported: Boolean(imported), importResult: imported && { inserted: imported.inserted, updated: imported.updated,
          unchanged: imported.unchanged, failed: imported.failed }, error: null,
      });
      summary.tasksCompleted += 1;
      summary.rowsWritten += written.rows;
      summary.rowsValid += valid.length;
      summary.rowsRejected += rows.length - valid.length;
      log.log?.(`[CedaExport] ${id}: ${written.rows} rows (${valid.length} valid) -> ${csvFile}`);
    } catch (err) {
      const safeMessage = redactText(err.message, [provider.client?.apiKey]);
      await manifest.update(id, { status: 'failed', window, error: safeMessage.slice(0, 300) });
      if (['LOW_DISK_SPACE', 'DOWNLOAD_BUDGET_EXCEEDED', 'ABORTED', 'UNAUTHORIZED', 'SOURCE_NOT_CONFIGURED'].includes(err.code)) {
        summary.stoppedReason = safeMessage;
        break;
      }
      log.error?.(`[CedaExport] ${id} failed: ${safeMessage}`);
    }
  }
  summary.bytesWritten = guard.bytesWritten;
  manifest.data.lastRun = { finishedAt: new Date().toISOString(), ...summary, manifestPath: undefined };
  await manifest.save();
  return summary;
}

/** Re-imports completed export files (e.g. into a freshly migrated database). */
export async function importCedaExport({ manifestPath, persister, log = console }) {
  const manifest = await Manifest.load(manifestPath, {});
  const outDir = path.dirname(manifestPath);
  const totals = { files: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, skippedFiles: [] };
  for (const [id, task] of Object.entries(manifest.data.tasks)) {
    if (task.status !== 'done') continue;
    if (!(await fileMatches(task, outDir))) { totals.skippedFiles.push(id); continue; }
    const records = [];
    for await (const row of readCsvGz(path.join(outDir, task.csvFile))) {
      if (row.validation_status !== 'valid') continue;
      const numeric = (v) => (v === null ? null : Number(v));
      records.push({
        ...row,
        is_sample_data: false,
        min_price: numeric(row.min_price), max_price: numeric(row.max_price), modal_price: numeric(row.modal_price),
        arrivals_quantity: numeric(row.arrivals_quantity),
        quality_flags: row.quality_flags ? row.quality_flags.split('|') : [],
        raw_payload: null,
      });
    }
    const checked = records.filter((r) => validateMandiRecord(r).valid);
    const { uniqueRecords, conflicts } = deduplicateWithinSource(checked);
    const result = await persister.persistBatch(uniqueRecords, { batchConflicts: conflicts });
    for (const key of ['inserted', 'updated', 'unchanged', 'failed']) totals[key] += result[key];
    totals.files += 1;
    log.log?.(`[CedaImport] ${id}: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged} failed=${result.failed}`);
  }
  return totals;
}
