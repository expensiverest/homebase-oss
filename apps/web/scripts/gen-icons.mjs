// Generates the PWA PNG icons without any image dependency.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const COLORS = {
  bg: [0x0e, 0x0d, 0x0c, 255],
  iris: [0x5a, 0x50, 0xe6, 255],
  bar: [0xf5, 0xf3, 0xee, 255],
};

function roundedRect(pixels, size, x, y, w, h, radius, color) {
  for (let py = Math.max(0, y); py < Math.min(size, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(size, x + w); px += 1) {
      const dx = Math.min(px - x, x + w - 1 - px);
      const dy = Math.min(py - y, y + h - 1 - py);
      if (dx < radius && dy < radius) {
        const ddx = radius - dx;
        const ddy = radius - dy;
        if (ddx * ddx + ddy * ddy > radius * radius) continue;
      }
      const index = (py * size + px) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function renderIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  // Full-bleed background keeps maskable icons inside any mask shape.
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = COLORS.bg[0];
    pixels[i * 4 + 1] = COLORS.bg[1];
    pixels[i * 4 + 2] = COLORS.bg[2];
    pixels[i * 4 + 3] = 255;
  }
  const scale = (value) => Math.round((value / 512) * size);
  const inset = maskable ? 128 : 96;
  const card = size - inset * 2;
  roundedRect(pixels, size, inset, inset, card, card, scale(64), COLORS.iris);
  const left = inset + Math.round(card * 0.17);
  const barHeight = Math.max(2, scale(34));
  const widths = [0.66, 0.47, 0.33];
  widths.forEach((width, index) => {
    roundedRect(
      pixels,
      size,
      left,
      inset + Math.round(card * (0.225 + index * 0.193)),
      Math.round(card * width),
      barHeight,
      Math.round(barHeight / 2),
      index === 0 ? COLORS.bar : [COLORS.bar[0], COLORS.bar[1], COLORS.bar[2], index === 1 ? 220 : 170],
    );
  });
  return encodePng(size, size, pixels);
}

const outputs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, {}],
];

for (const [name, size, options] of outputs) {
  writeFileSync(path.join(outDir, name), renderIcon(size, options));
  console.log(`wrote ${name} (${size}px)`);
}
