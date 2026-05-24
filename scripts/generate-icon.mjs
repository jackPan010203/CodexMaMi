import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = path.join(root, "resources");
const iconSvgPath = path.join(resourcesDir, "icon.svg");
const iconIcoPath = path.join(resourcesDir, "icon.ico");

await fs.mkdir(resourcesDir, { recursive: true });
await fs.writeFile(iconSvgPath, createSvg(), "utf8");
await fs.writeFile(iconIcoPath, createIco([createPng(256), createPng(128), createPng(64)]));

console.log(`Generated ${path.relative(root, iconSvgPath)} and ${path.relative(root, iconIcoPath)}`);

function createSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title desc">
  <title id="title">CodexMaMi icon</title>
  <desc id="desc">A calm geometric CodexMaMi app icon.</desc>
  <defs>
    <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#6D6AF2"/>
      <stop offset="55%" stop-color="#1EBB9B"/>
      <stop offset="100%" stop-color="#74C7F0"/>
    </linearGradient>
  </defs>
  <rect x="18" y="18" width="220" height="220" rx="54" fill="url(#bg)"/>
  <path d="M72 91h46c24 0 43 19 43 43v31" fill="none" stroke="#0B141C" stroke-linecap="round" stroke-linejoin="round" stroke-width="20"/>
  <path d="M184 165h-46c-24 0-43-19-43-43V91" fill="none" stroke="#0B141C" stroke-linecap="round" stroke-linejoin="round" stroke-width="20"/>
  <circle cx="96" cy="133" r="12" fill="#0B141C"/>
  <circle cx="160" cy="133" r="12" fill="#0B141C"/>
</svg>
`;
}

function createIco(pngImages) {
  const headerSize = 6 + pngImages.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);

  let offset = headerSize;
  pngImages.forEach((image, index) => {
    const entryOffset = 6 + index * 16;
    header[entryOffset] = image.size >= 256 ? 0 : image.size;
    header[entryOffset + 1] = image.size >= 256 ? 0 : image.size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.buffer.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += image.buffer.length;
  });

  return Buffer.concat([header, ...pngImages.map((image) => image.buffer)]);
}

function createPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const rectInset = size * 0.07;
  const dark = [11, 20, 28, 255];

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const inside = roundedRectCoverage(x + 0.5, y + 0.5, rectInset, rectInset, size - rectInset * 2, size - rectInset * 2, radius);
      const gradient = mix3([109, 106, 242], [30, 187, 155], [116, 199, 240], (x + y) / (size * 2));
      raw[offset] = gradient[0];
      raw[offset + 1] = gradient[1];
      raw[offset + 2] = gradient[2];
      raw[offset + 3] = Math.round(255 * inside);
    }
  }

  const lines = [
    [0.29, 0.35, 0.46, 0.35],
    [0.46, 0.35, 0.63, 0.52],
    [0.63, 0.52, 0.63, 0.65],
    [0.71, 0.65, 0.54, 0.65],
    [0.54, 0.65, 0.37, 0.48],
    [0.37, 0.48, 0.37, 0.35]
  ];
  for (const line of lines) {
    drawSegment(raw, size, line.map((value) => value * size), size * 0.075, dark);
  }
  drawCircle(raw, size, size * 0.39, size * 0.52, size * 0.045, dark);
  drawCircle(raw, size, size * 0.61, size * 0.52, size * 0.045, dark);

  const png = Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", ihdr(size, size)),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return { size, buffer: png };
}

function roundedRectCoverage(x, y, rx, ry, width, height, radius) {
  const cx = clamp(x, rx + radius, rx + width - radius);
  const cy = clamp(y, ry + radius, ry + height - radius);
  const distance = Math.hypot(x - cx, y - cy);
  return clamp(radius + 0.5 - distance, 0, 1);
}

function drawSegment(raw, size, [x1, y1, x2, y2], thickness, color) {
  const half = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - half - 2));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + half + 2));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - half - 2));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + half + 2));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2);
      const alpha = clamp(half + 1 - distance, 0, 1);
      if (alpha > 0) blendPixel(raw, size, x, y, color, alpha);
    }
  }
}

function drawCircle(raw, size, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const alpha = clamp(radius + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy), 0, 1);
      if (alpha > 0) blendPixel(raw, size, x, y, color, alpha);
    }
  }
}

function blendPixel(raw, size, x, y, color, alpha) {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const sourceAlpha = (color[3] / 255) * alpha;
  const targetAlpha = raw[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    raw[offset + channel] = Math.round((color[channel] * sourceAlpha + raw[offset + channel] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  }
  raw[offset + 3] = Math.round(outAlpha * 255);
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function mix3(a, b, c, t) {
  if (t < 0.55) return mix(a, b, t / 0.55);
  return mix(b, c, (t - 0.55) / 0.45);
}

function mix(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * clamp(t, 0, 1)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pngSignature() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
