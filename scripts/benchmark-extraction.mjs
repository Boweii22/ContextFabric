import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';

const OLLAMA_URL = process.env.CONTEXTFABRIC_OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.CONTEXTFABRIC_OLLAMA_MODEL || 'cf-gemma4';
const TARGET_MS = Number(process.env.CONTEXTFABRIC_EXTRACTION_TARGET_MS || 3000);
const PER_CASE_TIMEOUT_MS = Number(process.env.CONTEXTFABRIC_EXTRACTION_TIMEOUT_MS || 45000);

const root = process.cwd();
const modulePath = join(root, 'src', 'shared', 'contextExtraction.ts');
const compiled = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const exportsObject = {};
const sandbox = { exports: exportsObject, module: { exports: exportsObject } };
vm.runInNewContext(compiled.outputText, sandbox, { filename: modulePath });
const { buildContextExtractionPrompt, parseContextExtraction } = sandbox.module.exports;

const fixtures = [
  {
    type: 'conversation',
    text: 'User: ContextFabric should keep AI memory local. Assistant: We can use Gemma 4 through Ollama and issue permission tokens for apps like Claude and ChatGPT.',
  },
  {
    type: 'notes',
    text: 'Decision: use SQLite locally instead of a hosted database. Reason: privacy, zero setup, and offline operation are core to the product.',
  },
  {
    type: 'code_comments',
    text: '// Preference: keep IPC payloads typed and small. // Project: ContextFabric desktop app connects sources to local Gemma extraction.',
  },
  {
    type: 'bullet_points',
    text: '- Writing style: concise, practical, source-cited answers\n- Preference: avoid cloud calls for private context\n- Person: Bowei is building the challenge submission',
  },
  {
    type: 'prose',
    text: 'ContextFabric is a local-first memory graph for AI tools. It uses Gemma 4 to extract projects, preferences, decisions, style signals, and people from real user-owned sources.',
  },
];

async function fetchJson(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CASE_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}${path}`, { ...init, signal: controller.signal });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { res, body, text, timedOut: false };
  } catch (error) {
    return { res: { ok: false, status: 0 }, body: { error: error instanceof Error ? error.message : String(error) }, text: '', timedOut: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const version = await fetchJson('/api/version');
  if (!version.res.ok) {
    console.log(`Ollama not reachable at ${OLLAMA_URL}; parser benchmark only.`);
    parserOnly();
    return;
  }

  const timings = [];
  for (const fixture of fixtures) {
    const prompt = buildContextExtractionPrompt(fixture.text, fixture.type);
    const start = performance.now();
    const generated = await fetchJson('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        keep_alive: '0s',
        options: {
          num_ctx: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_CTX || 128),
          num_predict: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_PREDICT || 32),
          num_batch: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_BATCH || 4),
          temperature: 0,
        },
      }),
    });
    const elapsed = performance.now() - start;
    if (generated.timedOut) {
      timings.push(elapsed);
      console.log(`${fixture.type}: timed out after ${Math.round(elapsed)}ms`);
      continue;
    }
    const parsed = parseContextExtraction(String(generated.body.response || generated.text || ''));
    timings.push(elapsed);
    console.log(`${fixture.type}: ${Math.round(elapsed)}ms, nodes=${parsed.result.nodes.length}, valid=${parsed.ok}`);
  }

  const avg = timings.reduce((sum, value) => sum + value, 0) / timings.length;
  const max = Math.max(...timings);
  console.log(`Average extraction: ${Math.round(avg)}ms`);
  console.log(`Slowest extraction: ${Math.round(max)}ms`);

  if (avg > TARGET_MS) {
    console.warn(`WARN Average is above ${TARGET_MS}ms on this machine. Use this honestly in the submission notes.`);
  } else {
    console.log(`PASS Average is under ${TARGET_MS}ms target.`);
  }
}

function parserOnly() {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    parseContextExtraction(JSON.stringify({ nodes: [] }));
  }
  console.log(`Parser-only benchmark: ${Math.round(performance.now() - start)}ms for 1000 parses.`);
}

await main();
