// VirrTech Duka POS — icon generator (zero dependencies).
// Draws the VirrTech mark (indigo tile + teal V) procedurally into an
// RGB framebuffer and encodes valid PNGs with Node's built-in zlib.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- mark drawing

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const INDIGO = hex('#2f3aa3');
const INDIGO_DEEP = hex('#25308c');
const TEAL = hex('#12b8a0');
const PAPER = hex('#f7f5f0');

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Draw the mark at `size` pixels.
 * maskable=true keeps the content inside the 80% safe zone.
 */
function renderIcon(size, { maskable = false, transparent = false } = {}) {
  const px = Buffer.alloc(size * size * 3);
  const s = size;
  const inset = maskable ? 0.1 : 0; // maskable: full-bleed bg, content in central zone
  const k = (v) => (inset + v * (1 - 2 * inset)) * s;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      let color = null;

      // background tile
      if (u >= inset && u < 1 - inset && v >= inset && v < 1 - inset) {
        const t = (v - inset) / (1 - 2 * inset);
        color = lerp(INDIGO, INDIGO_DEEP, Math.min(1, Math.max(0, t)));
      }

      // V mark: two thick strokes, round caps (distance-to-segment test)
      const thickness = 0.075 * s;
      const a = [k(0.3), k(0.34)];
      const b = [k(0.5), k(0.68)];
      const c = [k(0.7), k(0.34)];
      const dA = distToSegment(u * s, v * s, a[0], a[1], b[0], b[1]);
      const dB = distToSegment(u * s, v * s, c[0], c[1], b[0], b[1]);
      if (Math.min(dA, dB) <= thickness) color = TEAL;

      const idx = (y * s + x) * 3;
      if (color) {
        px[idx] = Math.round(color[0]);
        px[idx + 1] = Math.round(color[1]);
        px[idx + 2] = Math.round(color[2]);
      } else if (!transparent) {
        // outside the tile: transparent for 'any' icons, paper for maskable
        const alpha = 0;
        px[idx] = 0;
        px[idx + 1] = 0;
        px[idx + 2] = 0;
        void alpha;
      }
    }
  }
  return px;
}

function renderIconWithAlpha(size, { maskable = false } = {}) {
  const rgb = Buffer.alloc(size * size * 3);
  const alpha = Buffer.alloc(size * size);
  const s = size;
  const inset = 0; // background is always full-bleed for PNG (alpha handles corners)
  const radius = maskable ? 0 : 0.18; // rounded corners for 'any', square for maskable

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      let inside = true;
      if (radius > 0) {
        // rounded-rectangle SDF
        const hw = 0.5 - radius;
        const qx = Math.abs(u - 0.5) - hw;
        const qy = Math.abs(v - 0.5) - hw;
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
        inside = outside <= 0;
      }
      let color = null;
      if (inside) {
        const t = v;
        color = lerp(INDIGO, INDIGO_DEEP, Math.min(1, Math.max(0, t)));
        const thickness = 0.075 * s;
        const k = (val) => (0.12 + val * 0.76) * s; // content inside safe zone
        const a = [k(0.3), k(0.34)];
        const b = [k(0.5), k(0.68)];
        const c = [k(0.7), k(0.34)];
        const dA = distToSegment(u * s, v * s, a[0], a[1], b[0], b[1]);
        const dB = distToSegment(u * s, v * s, c[0], c[1], b[0], b[1]);
        if (Math.min(dA, dB) <= thickness) color = TEAL;
      }
      const idx = (y * s + x) * 3;
      alpha[y * s + x] = inside ? 255 : 0;
      if (inside) {
        rgb[idx] = Math.round(color[0]);
        rgb[idx + 1] = Math.round(color[1]);
        rgb[idx + 2] = Math.round(color[2]);
      }
      void inset;
    }
  }
  return { rgb, alpha };
}

function encodePNGRGBA(size, rgb, alpha) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // color type: truecolor+alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[y * size * 3 + x * 3];
      raw[o + 1] = rgb[y * size * 3 + x * 3 + 1];
      raw[o + 2] = rgb[y * size * 3 + x * 3 + 2];
      raw[o + 3] = alpha[y * size + x];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- outputs

const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

for (const [name, size, opts] of [
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
]) {
  const { rgb, alpha } = renderIconWithAlpha(size, opts);
  writeFileSync(join(outDir, name), encodePNGRGBA(size, rgb, alpha));
  console.log(`icons/${name} (${size}x${size})`);
}

// SVG favicon (crisp, matches the mark)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="#2f3aa3"/>
  <path d="M20 24l12 22 12-22" fill="none" stroke="#12b8a0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
writeFileSync(join(outDir, 'icon.svg'), svg);
console.log('icons/icon.svg');
