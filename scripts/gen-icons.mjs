// Generates the PWA icons (PNG) and favicon (SVG) from code, so the project
// ships no external art. Run with `npm run icons`; output goes to public/icons.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [29, 43, 54];
const TEAL = [79, 179, 169];
const BUILDINGS = [
  // [x0, width, height] in a 0..1 unit square, drawn from the baseline up
  [0.16, 0.14, 0.34, [95, 191, 90]],
  [0.32, 0.16, 0.52, [90, 155, 224]],
  [0.5, 0.14, 0.42, [160, 127, 220]],
  [0.66, 0.18, 0.28, [227, 178, 60]],
];

function drawIcon(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const pad = maskable ? 0.12 : 0; // maskable icons keep content inside the safe zone
  const radius = maskable ? 0 : 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let c = null;
      // rounded square background
      const dx = Math.max(radius - u, 0, u - (1 - radius));
      const dy = Math.max(radius - v, 0, v - (1 - radius));
      if (radius === 0 || dx * dx + dy * dy <= radius * radius) c = BG;
      const su = (u - pad) / (1 - 2 * pad);
      const sv = (v - pad) / (1 - 2 * pad);
      const base = 0.74;
      for (const [x0, w, hgt, col] of BUILDINGS) {
        if (su >= x0 && su < x0 + w && sv <= base && sv >= base - hgt) c = col;
      }
      // "uptime" line: teal bar under the skyline
      if (su >= 0.12 && su <= 0.88 && sv > base + 0.04 && sv < base + 0.09) c = TEAL;
      const o = (y * size + x) * 4;
      if (c) {
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = 255;
      }
    }
  }
  return encodePng(size, size, px);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
function svg() {
  const rects = BUILDINGS.map(
    ([x0, w, hgt, col]) =>
      `<rect x="${x0 * 64}" y="${(0.74 - hgt) * 64}" width="${w * 64}" height="${hgt * 64}" fill="${hex(col)}"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="11.5" fill="${hex(BG)}"/>${rects}<rect x="7.7" y="49.9" width="48.6" height="3.2" fill="${hex(TEAL)}"/></svg>\n`;
}

writeFileSync(new URL('icon-192.png', OUT), drawIcon(192, false));
writeFileSync(new URL('icon-512.png', OUT), drawIcon(512, false));
writeFileSync(new URL('icon-512-maskable.png', OUT), drawIcon(512, true));
writeFileSync(new URL('favicon.svg', OUT), svg());
console.log('Icons written to public/icons');
