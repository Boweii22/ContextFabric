import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const ollamaCmd = isWindows ? 'ollama.exe' : 'ollama';
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (nodeMajor >= 24) {
  console.error('ContextFabric currently supports Node 20 or 22 for the Electron/native SQLite toolchain.');
  console.error(`Detected Node ${process.versions.node}. Install Node 20, then rerun: npm run start`);
  process.exit(1);
}

function run(label, command, args, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function tryRun(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  return result.status === 0;
}

function startOllamaServe() {
  console.log('\n== Start Ollama if needed ==');
  const check = spawnSync(ollamaCmd, ['list'], { stdio: 'ignore', shell: false });
  if (check.status === 0) {
    console.log('Ollama is already running.');
    return;
  }

  const child = spawn(ollamaCmd, ['serve'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  console.log('Started ollama serve in the background.');
}

try {
  if (!existsSync(join(root, 'node_modules'))) {
    run('Install npm dependencies', npmCmd, ['install']);
  } else {
    console.log('node_modules found; skipping npm install.');
  }

  startOllamaServe();

  if (!tryRun('Pull Gemma 4 E2B', ollamaCmd, ['pull', 'gemma4:e2b'])) {
    console.log('gemma4:e2b was not available; trying gemma4:e4b fallback.');
    run('Pull Gemma 4 E4B fallback', ollamaCmd, ['pull', 'gemma4:e4b']);
  }
  run('Pull local embedding model', ollamaCmd, ['pull', 'nomic-embed-text']);
  run('Verify Gemma local runtime', npmCmd, ['run', 'verify:gemma']);
  run('Start ContextFabric daemon and desktop app', npmCmd, ['run', 'dev']);
} catch (error) {
  console.error('\nSetup failed.');
  console.error(error instanceof Error ? error.message : error);
  console.error('\nInstall Ollama from https://ollama.com, then rerun: npm run start');
  process.exit(1);
}
