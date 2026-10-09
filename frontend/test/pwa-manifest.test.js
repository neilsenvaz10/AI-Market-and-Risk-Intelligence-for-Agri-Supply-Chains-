import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));

/** PNG width/height from the IHDR chunk. */
function pngSize(p) {
  const buf = fs.readFileSync(path.join(root, 'public', p));
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('web app manifest', () => {
  it('has the fields browsers require for installability', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declares 192 and 512 PNG icons plus a maskable icon, and every file exists with the declared size', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(icon.src.replace(/^\//, ''))).toEqual([w, h]);
    }
    expect(pngSize('icons/apple-touch-icon.png')).toEqual([180, 180]);
  });

  it('uses the Stitch brand colours from the Tailwind theme', () => {
    const tailwind = read('tailwind.config.js');
    expect(tailwind).toContain(`"primary": "${manifest.theme_color}"`);
    expect(tailwind).toContain(`"background": "${manifest.background_color}"`);
  });
});

describe('index.html and offline page', () => {
  const html = read('index.html');
  it('links the manifest, theme colour and iOS icons', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it('offline page is self-contained, trilingual and never shows prices', () => {
    const offline = read('public/offline.html');
    for (const lang of ['en', 'hi', 'mr']) expect(offline).toContain(`lang="${lang}"`);
    expect(offline).not.toMatch(/<script\s+src=|<link[^>]+href="http/i);
    expect(offline).not.toMatch(/₹|quintal|modal/i);
    expect(offline).toMatch(/No saved prices are shown/);
  });

  it('service worker file ships in public/ and the app registers it from main.jsx', () => {
    expect(fs.existsSync(path.join(root, 'public/sw.js'))).toBe(true);
    expect(read('src/main.jsx')).toContain('registerServiceWorker()');
  });
});
