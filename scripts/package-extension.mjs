import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const extensionDir = join(root, 'browser-extension');
const distDir = join(root, 'dist', 'browser-extension');
const manifestPath = join(extensionDir, 'manifest.json');
const validateOnly = process.argv.includes('--validate');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFile(path) {
  if (!existsSync(path)) fail(`Missing required extension file: ${path}`);
}

function validateManifest() {
  assertFile(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) fail('Manifest must be version 3.');
  if (!manifest.name || !manifest.version || !manifest.description) fail('Manifest requires name, version, and description.');
  assertFile(join(extensionDir, manifest.background.service_worker));
  assertFile(join(extensionDir, manifest.action.default_popup));
  assertFile(join(extensionDir, manifest.options_page));
  for (const script of manifest.content_scripts || []) {
    for (const js of script.js || []) assertFile(join(extensionDir, js));
    for (const css of script.css || []) assertFile(join(extensionDir, css));
  }
  return manifest;
}

function zipDirectory(source, zipPath) {
  const files = listFiles(source);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file);
    const name = relative(source, file).replace(/\\/g, '/');
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(zipPath, Buffer.concat([...chunks, ...central, end]));
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const manifest = validateManifest();
console.log(`Extension manifest OK: ${manifest.name} ${manifest.version}`);

if (!validateOnly) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const stageDir = join(distDir, `contextfabric-bridge-${manifest.version}`);
  cpSync(extensionDir, stageDir, {
    recursive: true,
    filter: (src) => !src.includes(`${join('browser-extension', 'store')}`),
  });

  const zipPath = join(distDir, `contextfabric-bridge-${manifest.version}.zip`);
  zipDirectory(stageDir, zipPath);
  console.log(`Packaged extension: ${zipPath}`);
}
