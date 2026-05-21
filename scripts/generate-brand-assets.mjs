import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const resources = join(root, 'resources');
const extensionIcons = join(root, 'browser-extension', 'icons');
mkdirSync(resources, { recursive: true });
mkdirSync(join(resources, 'brand'), { recursive: true });
mkdirSync(extensionIcons, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title desc">
  <title id="title">ContextFabric icon</title>
  <desc id="desc">A private context graph mark with connected memory nodes.</desc>
  <defs>
    <linearGradient id="bg" x1="24" y1="16" x2="232" y2="240" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset=".45" stop-color="#6366F1"/>
      <stop offset="1" stop-color="#A855F7"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="62%">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".30"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="58" fill="#070A18"/>
  <rect x="14" y="14" width="228" height="228" rx="48" fill="url(#bg)"/>
  <rect x="14" y="14" width="228" height="228" rx="48" fill="url(#glow)"/>
  <path d="M78 102 L128 72 L178 102 L178 154 L128 184 L78 154 Z" fill="none" stroke="white" stroke-width="10" stroke-linejoin="round" opacity=".90"/>
  <path d="M128 72 V128 L178 154 M128 128 L78 154 M128 128 L178 102 M128 128 L78 102 M128 128 V184" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" opacity=".48"/>
  <circle cx="128" cy="128" r="27" fill="#070A18" opacity=".36"/>
  <circle cx="128" cy="128" r="19" fill="white"/>
  <circle cx="128" cy="72" r="13" fill="white"/>
  <circle cx="178" cy="102" r="13" fill="white" opacity=".86"/>
  <circle cx="178" cy="154" r="13" fill="white" opacity=".86"/>
  <circle cx="128" cy="184" r="13" fill="white"/>
  <circle cx="78" cy="154" r="13" fill="white" opacity=".86"/>
  <circle cx="78" cy="102" r="13" fill="white" opacity=".86"/>
</svg>
`;

const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 180" role="img" aria-labelledby="title">
  <title id="title">ContextFabric wordmark</title>
  <rect width="820" height="180" rx="32" fill="#070A18"/>
  <image href="../icon.svg" x="36" y="38" width="104" height="104"/>
  <text x="164" y="94" fill="#F8FAFC" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="46" font-weight="750">ContextFabric</text>
  <text x="167" y="128" fill="#94A3B8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18">Private AI memory for local-first workflows</text>
</svg>
`;

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 720" role="img" aria-labelledby="title">
  <title id="title">ContextFabric release banner</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F172A"/>
      <stop offset=".45" stop-color="#312E81"/>
      <stop offset="1" stop-color="#083344"/>
    </linearGradient>
  </defs>
  <rect width="1400" height="720" fill="url(#g)"/>
  <g opacity=".16" stroke="#FFFFFF">
    <path d="M0 160H1400M0 300H1400M0 440H1400M0 580H1400M180 0V720M360 0V720M540 0V720M720 0V720M900 0V720M1080 0V720M1260 0V720"/>
  </g>
  <circle cx="1060" cy="330" r="176" fill="#22D3EE" opacity=".14"/>
  <circle cx="1110" cy="384" r="112" fill="#A855F7" opacity=".18"/>
  <image href="../icon.svg" x="112" y="118" width="154" height="154"/>
  <text x="112" y="338" fill="#FFFFFF" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="78" font-weight="800">ContextFabric</text>
  <text x="118" y="398" fill="#CBD5E1" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="30">Private AI memory. Local by default. Permissioned by design.</text>
  <rect x="116" y="468" width="244" height="52" rx="26" fill="#67E8F9"/>
  <text x="148" y="502" fill="#020617" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" font-weight="700">Local-first beta</text>
</svg>
`;

writeFileSync(join(resources, 'icon.svg'), svg, 'utf8');
writeFileSync(join(resources, 'brand', 'wordmark.svg'), wordmark, 'utf8');
writeFileSync(join(resources, 'brand', 'release-banner.svg'), banner, 'utf8');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  const png = renderPng(size);
  writeFileSync(join(resources, `icon-${size}.png`), png);
  if ([16, 32, 48, 128].includes(size)) writeFileSync(join(extensionIcons, `icon-${size}.png`), png);
}

writeFileSync(join(resources, 'icon.ico'), makeIco([16, 32, 48, 256].map(size => renderPng(size))));
console.log('Brand assets generated in resources/ and browser-extension/icons/.');

function renderPng(size) {
  const bytes = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const nodes = [
    [0.5, 0.28], [0.72, 0.40], [0.72, 0.60],
    [0.5, 0.72], [0.28, 0.60], [0.28, 0.40], [0.5, 0.5],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = x / Math.max(size - 1, 1);
      const ny = y / Math.max(size - 1, 1);
      const corner = roundedAlpha(x, y, size, radius);
      const mix = (nx + ny) / 2;
      const c1 = [34, 211, 238];
      const c2 = [99, 102, 241];
      const c3 = [168, 85, 247];
      const base = mix < 0.5 ? lerpColor(c1, c2, mix * 2) : lerpColor(c2, c3, (mix - 0.5) * 2);
      bytes[i] = base[0];
      bytes[i + 1] = base[1];
      bytes[i + 2] = base[2];
      bytes[i + 3] = Math.round(255 * corner);
    }
  }
  drawHex(bytes, size);
  for (const [px, py] of nodes) drawCircle(bytes, size, px * size, py * size, Math.max(1.7, size * (px === 0.5 && py === 0.5 ? 0.075 : 0.052)), [255, 255, 255, 245]);
  return pngEncode(size, size, bytes);
}

function roundedAlpha(x, y, size, radius) {
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  if (dx === 0 && dy === 0) return 1;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d <= radius ? 1 : 0;
}

function drawHex(buf, size) {
  const pts = [[.5,.28],[.72,.4],[.72,.6],[.5,.72],[.28,.6],[.28,.4]];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    drawLine(buf, size, a[0] * size, a[1] * size, b[0] * size, b[1] * size, Math.max(2, size * 0.035), [255, 255, 255, 220]);
  }
  for (const p of pts) drawLine(buf, size, .5 * size, .5 * size, p[0] * size, p[1] * size, Math.max(1, size * 0.016), [255, 255, 255, 130]);
}

function drawLine(buf, size, x1, y1, x2, y2, width, color) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + width));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + width));
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    const px = x1 + t * dx, py = y1 + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d <= width / 2) blend(buf, size, x, y, color);
  }
}

function drawCircle(buf, size, cx, cy, r, color) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(size - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(size - 1, Math.ceil(cx + r)); x++) {
      if (Math.hypot(x - cx, y - cy) <= r) blend(buf, size, x, y, color);
    }
  }
}

function blend(buf, size, x, y, color) {
  const i = (y * size + x) * 4;
  const a = color[3] / 255;
  buf[i] = Math.round(color[0] * a + buf[i] * (1 - a));
  buf[i + 1] = Math.round(color[1] * a + buf[i + 1] * (1 - a));
  buf[i + 2] = Math.round(color[2] * a + buf[i + 2] * (1 - a));
}

function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function pngEncode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    pngChunk('IHDR', bufferFromInts([width, height], [4, 4], Buffer.from([8, 6, 0, 0, 0]))),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function bufferFromInts(values, sizes, tail) {
  const buf = Buffer.alloc(sizes.reduce((a, b) => a + b, 0) + tail.length);
  let off = 0;
  values.forEach((value, i) => { buf.writeUIntBE(value, off, sizes[i]); off += sizes[i]; });
  tail.copy(buf, off);
  return buf;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;
  images.forEach((img, i) => {
    const size = [16, 32, 48, 256][i];
    const e = i * 16;
    entries[e] = size === 256 ? 0 : size;
    entries[e + 1] = size === 256 ? 0 : size;
    entries[e + 2] = 0;
    entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(img.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([header, entries, ...images]);
}
