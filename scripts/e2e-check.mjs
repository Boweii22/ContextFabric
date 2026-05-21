import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function run(label, command, args, options = {}) {
  console.log(`- ${label}`);
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', shell: false, ...options });
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return result;
}

function runGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { res, body };
}

function testExtensionPackage() {
  run('validate extension manifest', process.execPath, ['scripts/package-extension.mjs', '--validate']);
  run('package extension zip', process.execPath, ['scripts/package-extension.mjs']);
  const zip = join(root, 'dist', 'browser-extension', 'contextfabric-bridge-0.1.0.zip');
  assert(existsSync(zip), 'Extension zip was not created.');
  assert(readFileSync(zip).includes(Buffer.from('manifest.json')), 'Extension zip does not contain manifest.json.');
}

function testImportFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'cf-e2e-'));
  const chatgptDir = join(dir, 'chatgpt-export');
  const claudeDir = join(dir, 'claude-export');
  mkdirSync(chatgptDir);
  mkdirSync(claudeDir);

  writeFileSync(join(chatgptDir, 'conversations.json'), JSON.stringify([
    {
      title: 'TrialMatch planning',
      create_time: 1770000000,
      mapping: {
        a: { message: { author: { role: 'user' }, create_time: 1770000000, content: { parts: ['What is TrialMatch?'] } } },
        b: { message: { author: { role: 'assistant' }, create_time: 1770000001, content: { parts: ['TrialMatch is a local clinical trial matching assistant.'] } } },
      },
    },
  ]));

  writeFileSync(join(claudeDir, 'conversations.json'), JSON.stringify([
    {
      title: 'ContextFabric notes',
      created_at: '2026-05-21T10:00:00Z',
      messages: [
        { role: 'human', content: [{ text: 'Remember my architecture decision.' }] },
        { role: 'assistant', content: [{ text: 'ContextFabric keeps memory local and permissioned.' }] },
      ],
    },
  ]));

  assert(JSON.parse(readFileSync(join(chatgptDir, 'conversations.json'), 'utf8'))[0].mapping, 'ChatGPT fixture did not parse.');
  assert(JSON.parse(readFileSync(join(claudeDir, 'conversations.json'), 'utf8'))[0].messages.length === 2, 'Claude fixture did not parse.');

  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), '# TrialMatch\n\nLocal clinical trial matching assistant.');
  const init = runGit(['init'], repo);
  if (init.status === 0) {
    runGit(['config', 'user.email', 'e2e@example.com'], repo);
    runGit(['config', 'user.name', 'E2E'], repo);
    const add = runGit(['add', '.'], repo);
    assert(add.status === 0, `GitHub connector fixture repo could not stage files: ${add.stderr || add.stdout}`);
    const commit = runGit(['commit', '-m', 'Add TrialMatch readme'], repo);
    assert(commit.status === 0, `GitHub connector fixture repo could not create a commit: ${commit.stderr || commit.stdout}`);
  } else {
    console.warn('  git not available; skipping git fixture commit check');
  }
}

async function testLiveDaemonIfRunning() {
  console.log('- live daemon permissions/sync smoke');
  try {
    const health = await fetchJson('http://127.0.0.1:47821/health');
    if (!health.res.ok) {
      console.log('  ContextFabric daemon not running; live API checks skipped.');
      return;
    }

    const request = await fetchJson('http://127.0.0.1:47821/api/permission/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ContextFabric-App': 'e2e-check' },
      body: JSON.stringify({ scopes: ['context'], reason: 'E2E permission smoke test' }),
    });
    assert(request.res.status === 202 || request.body.status === 'pending', 'Permission request endpoint did not create a pending request.');

    const sync = await fetchJson('http://127.0.0.1:47822/health', {
      headers: { 'X-ContextFabric-Sync-Key': 'wrong-key' },
    });
    assert(sync.res.status === 401, 'Sync endpoint should reject an invalid sync key.');
  } catch {
    console.log('  ContextFabric daemon not running; live API checks skipped.');
  }
}

testExtensionPackage();
testImportFixtures();
await testLiveDaemonIfRunning();

if (failures.length > 0) {
  console.error('\nE2E checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('\nE2E checks passed.');
