/**
 * Translation-key check: every key used in src/ must exist in en, hi and mr.
 *   npm run check:i18n
 * Finds keys passed to t(...) and dotted key literals used in lookup tables
 * (e.g. nameKey: 'home.mandiPrices.puneName'). Exits 1 when a key is missing,
 * because a key missing in English would be rendered as raw text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const stringsSource = fs.readFileSync(path.join(srcDir, 'i18n/strings.js'), 'utf8');
const start = stringsSource.indexOf('const STRINGS = ');
const body = stringsSource.slice(start, stringsSource.indexOf('\n};', start) + 3);
const STRINGS = new Function(`${body}; return STRINGS;`)();
const LANGUAGES = ['en', 'hi', 'mr'];
const namespaces = new Set(Object.keys(STRINGS.en).filter((k) => k.includes('.')).map((k) => k.split('.')[0]));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : walk(full);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const used = new Map();
for (const file of walk(srcDir)) {
  const code = fs.readFileSync(file, 'utf8');
  const add = (key) => used.set(key, [...(used.get(key) || []), path.relative(srcDir, file)]);
  for (const m of code.matchAll(/\bt\(\s*[\w.?]+\s*,\s*'([^']+)'/g)) add(m[1]);
  for (const m of code.matchAll(/'([a-z][A-Za-z]*\.[A-Za-z0-9.]+)'/g)) {
    if (namespaces.has(m[1].split('.')[0])) add(m[1]);
  }
}

let missing = 0;
for (const [key, files] of [...used].sort()) {
  const absent = LANGUAGES.filter((lang) => !(key in STRINGS[lang]));
  if (absent.length) {
    missing += 1;
    console.log(`MISSING ${key} in ${absent.join(', ')}  (used in ${[...new Set(files)].join(', ')})`);
  }
}

for (const lang of LANGUAGES) {
  const block = stringsSource.slice(stringsSource.indexOf(`\n  ${lang}: {`));
  const seen = new Map();
  for (const m of block.slice(0, block.indexOf('\n  },')).matchAll(/^\s+'?([\w.]+)'?:\s/gm)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) console.log(`warning: duplicate keys in ${lang}: ${dups.join(', ')}`);
}

console.log(`${used.size} keys checked across ${LANGUAGES.join('/')}: ${missing ? `${missing} missing` : 'all present'}`);
process.exitCode = missing ? 1 : 0;
