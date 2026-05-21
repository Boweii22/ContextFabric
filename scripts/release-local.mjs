import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const releaseDir = join(root, 'dist', 'release-notes');

function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runDirect(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findInstallerNote() {
  return [
    'Windows app release zip is produced in dist/. Extract it and run ContextFabric.exe.',
    'For a full NSIS installer build, run: npm run package',
    `Browser extension zip: ${join(root, 'dist', 'browser-extension', 'contextfabric-bridge-0.1.0.zip')}`,
    'Recommended manual smoke test: start ContextFabric.exe, add one source, query it, load extension unpacked, inject context.',
  ].join('\n');
}

function createWindowsBundle() {
  const electronDist = join(root, 'node_modules', 'electron', 'dist');
  const outDir = join(root, 'dist', 'win-unpacked');
  const appDir = join(outDir, 'resources', 'app');

  if (!existsSync(electronDist)) {
    console.error(`Missing Electron runtime: ${electronDist}`);
    process.exit(1);
  }
  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    console.error('Missing built app files. Run npm run build first.');
    process.exit(1);
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(electronDist, outDir, { recursive: true });

  const electronExe = join(outDir, 'electron.exe');
  const appExe = join(outDir, 'ContextFabric.exe');
  if (existsSync(appExe)) rmSync(appExe, { force: true });
  if (existsSync(electronExe)) renameSync(electronExe, appExe);

  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  cpSync(join(root, 'out'), join(appDir, 'out'), { recursive: true });
  if (existsSync(join(root, 'resources'))) cpSync(join(root, 'resources'), join(appDir, 'resources'), { recursive: true });

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'context-fabric',
    productName: 'ContextFabric',
    version: '1.0.0',
    main: './out/main/index.js',
  }, null, 2), 'utf8');

  cpSync(join(root, 'node_modules'), join(appDir, 'node_modules'), {
    recursive: true,
    filter: (src) => {
      const normalized = src.replace(/\\/g, '/');
      return !normalized.includes('/node_modules/.cache') &&
        !normalized.includes('/node_modules/electron/dist') &&
        !normalized.includes('/node_modules/electron-builder/out') &&
        !normalized.includes('/node_modules/app-builder-bin');
    },
  });
}

function createWindowsZip() {
  const source = join(root, 'dist', 'win-unpacked');
  const zip = join(root, 'dist', 'ContextFabric-1.0.0-win-unpacked.zip');
  const powershell = existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    : 'powershell.exe';
  if (!existsSync(source)) {
    console.error(`Missing Windows app folder: ${source}`);
    process.exit(1);
  }
  rmSync(zip, { force: true });
  runDirect('Create Windows release zip', powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path "${source}\\*" -DestinationPath "${zip}" -Force`,
  ]);
}

mkdirSync(releaseDir, { recursive: true });
rmSync(join(root, 'dist', 'win-unpacked'), { recursive: true, force: true });
rmSync(join(root, 'dist', 'ContextFabric-1.0.0-win-unpacked.zip'), { force: true });

run('Build desktop app', 'npm', ['run', 'build']);
run('Validate browser extension', 'npm', ['run', 'extension:validate']);
run('Package browser extension', 'npm', ['run', 'extension:package']);
run('Run E2E checks', 'npm', ['run', 'e2e']);
console.log('\n== Build Windows app release folder ==');
createWindowsBundle();
createWindowsZip();

const notePath = join(releaseDir, `release-${new Date().toISOString().slice(0, 10)}.txt`);
writeFileSync(notePath, findInstallerNote(), 'utf8');
console.log(`\nRelease notes written: ${notePath}`);

if (!existsSync(join(root, 'dist'))) {
  console.warn('dist/ was not found after release build.');
}
