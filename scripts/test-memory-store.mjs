import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function embed(text) {
  const dims = 32;
  const v = new Array(dims).fill(0);
  for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let hash = 0;
    for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    v[hash % dims] += 1;
  }
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / mag);
}

function cosine(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

const dir = mkdtempSync(join(tmpdir(), 'cf-memory-test-'));
const db = new DatabaseSync(join(dir, 'memory.db'));
const failures = [];

try {
  db.exec(`
    CREATE TABLE memory_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE memory_embeddings (
      node_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL
    );
  `);

  const insertNode = db.prepare('INSERT INTO memory_nodes (id, type, content, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertEmbedding = db.prepare('INSERT INTO memory_embeddings (node_id, embedding) VALUES (?, ?)');

  for (let i = 0; i < 60; i++) {
    const type = i % 3 === 0 ? 'project' : i % 3 === 1 ? 'preference' : 'decision';
    const content = i < 20
      ? `ContextFabric local privacy memory graph node ${i}`
      : i < 40
        ? `Gemma extraction preference source cited answer node ${i}`
        : `Unrelated mobile logging carousel adapter node ${i}`;
    insertNode.run(`node-${i}`, type, content, 0.6 + (i % 10) / 30, 'fixture', Date.now() + i);
    insertEmbedding.run(`node-${i}`, JSON.stringify(embed(content)));
  }

  const total = db.prepare('SELECT COUNT(*) AS count FROM memory_nodes WHERE deleted_at IS NULL').get().count;
  if (total !== 60) failures.push(`Expected 60 live nodes, got ${total}.`);

  const preferences = db.prepare("SELECT COUNT(*) AS count FROM memory_nodes WHERE type = 'preference' AND deleted_at IS NULL").get().count;
  if (preferences !== 20) failures.push(`Expected 20 preference nodes, got ${preferences}.`);

  const query = embed('local privacy memory graph');
  const ranked = db.prepare(`
    SELECT n.id, n.content, e.embedding
    FROM memory_nodes n JOIN memory_embeddings e ON e.node_id = n.id
    WHERE n.deleted_at IS NULL
  `).all()
    .map(row => ({ ...row, score: cosine(query, JSON.parse(row.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!ranked[0]?.content.includes('ContextFabric local privacy')) failures.push('Semantic query did not rank the local privacy node first.');

  db.prepare('UPDATE memory_nodes SET deleted_at = ? WHERE id = ?').run(Date.now(), 'node-0');
  const deleted = db.prepare('SELECT COUNT(*) AS count FROM memory_nodes WHERE deleted_at IS NOT NULL').get().count;
  if (deleted !== 1) failures.push('Soft delete did not mark node as deleted.');

  db.prepare('UPDATE memory_nodes SET deleted_at = NULL WHERE id = ?').run('node-0');
  const restored = db.prepare('SELECT deleted_at FROM memory_nodes WHERE id = ?').get('node-0').deleted_at;
  if (restored !== null) failures.push('Restore did not clear deleted_at.');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('Memory store tests failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Memory store tests passed.');
