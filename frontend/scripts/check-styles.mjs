// Separate processes avoid Tailwind's config cache masking a cwd-dependent build.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../', import.meta.url));
const vite = new URL('../node_modules/vite/dist/node/index.js', import.meta.url).href;
const configFile = fileURLToPath(new URL('../vite.config.js', import.meta.url));
const code = `
  import { build } from ${JSON.stringify(vite)};
  import assert from 'node:assert/strict';
  import { createHash } from 'node:crypto';
  const result = await build({ configFile: ${JSON.stringify(configFile)}, logLevel: 'error', build: { write: false } });
  const css = result.output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('');
  for (const token of ['#00260d', '.gap-space-md', '.bg-secondary', '.font-headline-md', '.rounded-xl']) {
    assert.ok(css.includes(token), 'Missing Stitch style: ' + token);
  }
  console.log(createHash('sha256').update(css).digest('hex'));
`;
const hashes = [frontend, repository].map((cwd) => execFileSync(process.execPath,
  ['--input-type=module', '--eval', code], { cwd, encoding: 'utf8', timeout: 60_000 }).trim());
assert.equal(hashes[0], hashes[1], 'CSS must be identical from both launch directories');
console.log('PASS: identical Stitch CSS from frontend and repository roots');
