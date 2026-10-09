/**
 * Generates the PWA PNG icons (no dependencies): brand-green tile with a light "F".
 *   node scripts/generate-pwa-icons.mjs
 * Output: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
 * Colours match tailwind.config.js (primary #00260d, inverse-primary #a1d2a7).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
const BG = [0x00, 0x26, 0x0d];
const FG = [0xa1, 0xd2, 0xa7];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/** @param {number} size @param {boolean} rounded rounded tile (any) vs full-bleed (maskable) @param {number} scale glyph scale */
function renderIcon(size, rounded, scale) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = rounded ? size * 0.2 : 0;
  // "F" glyph in a box centred on the tile
  const box = size * scale;
  const x0 = (size - box) / 2;
  const y0 = (size - box) / 2;
  const stem = box * 0.24;
  const rects = [
    [x0 + box * 0.12, y0, stem, box], // stem
    [x0 + box * 0.12, y0, box * 0.8, stem], // top bar
    [x0 + box * 0.12, y0 + box * 0.42, box * 0.6, stem * 0.9], // middle bar
  ];
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let inside = true;
      if (radius) {
        const cx = x < radius ? radius : x > size - radius ? size - radius : x;
        const cy = y < radius ? radius : y > size - radius ? size - radius : y;
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
      }
      const glyph = rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
      const [r, g, b] = glyph ? FG : BG;
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, true, 0.5],
  ['icon-512.png', 512, true, 0.5],
  ['icon-maskable-512.png', 512, false, 0.4], // glyph inside the 80% maskable safe zone
  ['apple-touch-icon.png', 180, false, 0.5], // iOS applies its own rounding
];
for (const [name, size, rounded, scale] of targets) {
  fs.writeFileSync(path.join(outDir, name), renderIcon(size, rounded, scale));
  console.log(`wrote public/icons/${name}`);
}
