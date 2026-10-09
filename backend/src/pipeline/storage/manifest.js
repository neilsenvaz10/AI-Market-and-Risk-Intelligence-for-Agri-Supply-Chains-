/**
 * Atomic checkpoint manifest for a dataset run.
 *
 * The manifest records every completed window (record count, byte size, sha256,
 * timestamps) and every failed window (error message), so an interrupted run resumes
 * without re-downloading finished work.
 *
 * Interrupt safety has two layers:
 *   1. the file is written atomically (temp + rename), and
 *   2. the document carries an `integrity` block (sha256 of the payload + a
 *      `complete: true` marker) that is verified on load — a truncated or hand-edited
 *      manifest is rejected instead of being mistaken for a valid one.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { redactText } from '../http.js';
import { writeJsonAtomic } from './atomicWrite.js';

export const MANIFEST_VERSION = 1;

export class ManifestError extends Error {
  constructor(message, { code = 'MANIFEST_INVALID', path: filePath = null, cause = null } = {}) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
    this.path = filePath;
    if (cause) this.cause = cause;
  }
}

const isoNow = () => new Date().toISOString();
const asCount = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const asBytes = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function newWindows() {
  return {};
}

/** Fresh manifest object (no file involved). */
export function createManifest({ dataset = null, source = null, windows = newWindows(), version = MANIFEST_VERSION, now = isoNow() } = {}) {
  return { version, dataset, source, createdAt: now, updatedAt: now, windows: { ...windows } };
}

/** Canonical payload — the exact object whose hash the `integrity` block signs. */
function buildPayload(manifest, updatedAt) {
  return {
    version: manifest?.version ?? MANIFEST_VERSION,
    dataset: manifest?.dataset ?? null,
    source: manifest?.source ?? null,
    createdAt: manifest?.createdAt ?? updatedAt,
    updatedAt,
    windows: manifest?.windows && typeof manifest.windows === 'object' && !Array.isArray(manifest.windows) ? manifest.windows : {},
  };
}

function payloadDigest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Loads a manifest. A missing file yields a fresh manifest seeded with `defaults`
 * (so the first run needs no special case). Anything malformed, truncated or tampered
 * with throws ManifestError — a broken checkpoint must never look complete.
 */
export async function loadManifest(filePath, defaults = {}) {
  if (!filePath) throw new TypeError('loadManifest(filePath) requires a path');
  let text;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return createManifest(defaults);
    throw new ManifestError(`Cannot read manifest at ${filePath}: ${err.message}`, { code: 'MANIFEST_UNREADABLE', path: filePath, cause: err });
  }

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new ManifestError(
      `Manifest at ${filePath} is truncated or corrupt JSON (${err.message}); refusing to treat it as a valid checkpoint`,
      { code: 'MANIFEST_TRUNCATED', path: filePath, cause: err }
    );
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ManifestError(`Manifest at ${filePath} is not a JSON object`, { code: 'MANIFEST_INVALID', path: filePath });
  }
  if (!doc.windows || typeof doc.windows !== 'object' || Array.isArray(doc.windows)) {
    throw new ManifestError(`Manifest at ${filePath} has no windows object`, { code: 'MANIFEST_INVALID', path: filePath });
  }
  const integrity = doc.integrity;
  if (!integrity || integrity.complete !== true || integrity.algorithm !== 'sha256') {
    throw new ManifestError(
      `Manifest at ${filePath} is incomplete (no integrity block); it may be a partially written file`,
      { code: 'MANIFEST_INCOMPLETE', path: filePath }
    );
  }
  const payload = buildPayload(doc, doc.updatedAt);
  if (payloadDigest(payload) !== integrity.hash) {
    throw new ManifestError(`Manifest at ${filePath} failed its sha256 integrity check; the checkpoint is corrupt`, {
      code: 'MANIFEST_CORRUPT',
      path: filePath,
    });
  }
  return payload;
}

/** Atomically persists the manifest (temp file + fsync + rename). */
export async function saveManifest(filePath, manifest, { now = isoNow } = {}) {
  if (!filePath) throw new TypeError('saveManifest(filePath, manifest) requires a path');
  if (!manifest || typeof manifest !== 'object') throw new TypeError('saveManifest(filePath, manifest) requires a manifest object');
  const updatedAt = typeof now === 'function' ? now() : now;
  manifest.updatedAt = updatedAt;
  if (!manifest.createdAt) manifest.createdAt = updatedAt;
  if (!manifest.windows || typeof manifest.windows !== 'object' || Array.isArray(manifest.windows)) manifest.windows = newWindows();
  const payload = buildPayload(manifest, updatedAt);
  const doc = { ...payload, integrity: { algorithm: 'sha256', hash: payloadDigest(payload), complete: true, signedAt: updatedAt } };
  await writeJsonAtomic(filePath, doc);
  return manifest;
}

/**
 * Derives the checkpoint key of a window descriptor: a bare string key, an explicit
 * `key`, a `{from,to}` pair, or a `{year,month}` partition.
 */
export function windowKey(window) {
  if (typeof window === 'string') {
    if (!window) throw new TypeError('windowKey: empty window key');
    return window;
  }
  if (window && typeof window === 'object') {
    if (window.key) return String(window.key);
    if (window.from && window.to) return `${window.from}_${window.to}`;
    if (window.year && window.month) return `${window.year}-${window.month}`;
  }
  throw new TypeError('windowKey: cannot derive a key (expected string, {key}, {from,to} or {year,month})');
}

/** Current status of a window: 'complete' | 'failed' | 'running' | 'missing'. */
export function windowStatus(manifest, key) {
  return manifest?.windows?.[key]?.status ?? 'missing';
}

/** True only when the window was explicitly marked complete. */
export function isWindowComplete(manifest, key) {
  return windowStatus(manifest, key) === 'complete';
}

/** Records a completed window (record count, byte size, sha256, timestamps). */
export function markWindowComplete(manifest, key, info = {}) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('markWindowComplete requires a manifest object');
  const id = windowKey(key);
  const now = info.now ?? isoNow();
  const previous = manifest.windows?.[id] ?? {};
  const entry = {
    ...info,
    status: 'complete',
    key: id,
    recordCount: asCount(info.recordCount ?? info.records),
    bytes: asBytes(info.bytes ?? info.compressedBytes),
    sha256: info.sha256 ?? null,
    file: info.file ?? info.path ?? null,
    startedAt: info.startedAt ?? previous.startedAt ?? null,
    completedAt: now,
    updatedAt: now,
    error: null,
  };
  delete entry.now;
  delete entry.records;
  delete entry.compressedBytes;
  delete entry.path;
  manifest.windows = manifest.windows ?? newWindows();
  manifest.windows[id] = entry;
  manifest.updatedAt = now;
  return entry;
}

/** Records a failed window with a redacted error message (secrets never persisted). */
export function markWindowFailed(manifest, key, error, info = {}) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('markWindowFailed requires a manifest object');
  const id = windowKey(key);
  const now = info.now ?? isoNow();
  const previous = manifest.windows?.[id] ?? {};
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const message = redactText(raw, info.secrets ?? []).slice(0, 500);
  const entry = {
    ...info,
    status: 'failed',
    key: id,
    recordCount: asCount(info.recordCount ?? info.records),
    bytes: asBytes(info.bytes ?? info.compressedBytes),
    sha256: null,
    file: info.file ?? null,
    startedAt: info.startedAt ?? previous.startedAt ?? null,
    completedAt: null,
    failedAt: info.failedAt ?? now,
    updatedAt: now,
    error: message,
    errorCode: (error && typeof error === 'object' && 'code' in error ? error.code : null) ?? null,
  };
  delete entry.now;
  delete entry.records;
  delete entry.compressedBytes;
  delete entry.secrets;
  manifest.windows = manifest.windows ?? newWindows();
  manifest.windows[id] = entry;
  manifest.updatedAt = now;
  return entry;
}

/** Windows from `allWindows` that are not complete yet (failed windows are retried). */
export function pendingWindows(manifest, allWindows = []) {
  if (!Array.isArray(allWindows)) throw new TypeError('pendingWindows(manifest, allWindows) requires an array');
  return allWindows.filter((window) => !isWindowComplete(manifest, windowKey(window)));
}

/** Re-verifies a completed window's artefact (size + sha256) before trusting the checkpoint. */
export async function verifyWindowFile(manifest, key, { baseDir = '.', fs = fsp } = {}) {
  const entry = manifest?.windows?.[windowKey(key)];
  if (!entry || entry.status !== 'complete' || !entry.file || !entry.sha256) return false;
  const full = path.isAbsolute(entry.file) ? entry.file : path.resolve(baseDir, entry.file);
  try {
    const stat = await fs.stat(full);
    if (entry.bytes && stat.size !== entry.bytes) return false;
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(full)) hash.update(chunk);
    return hash.digest('hex') === entry.sha256;
  } catch {
    return false;
  }
}

export default {
  loadManifest, saveManifest, createManifest, markWindowComplete, markWindowFailed,
  isWindowComplete, pendingWindows, windowKey, windowStatus, verifyWindowFile, ManifestError, MANIFEST_VERSION,
};
