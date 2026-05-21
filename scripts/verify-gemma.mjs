const OLLAMA_URL = process.env.CONTEXTFABRIC_OLLAMA_URL || 'http://127.0.0.1:11434';
const PREFERRED_SOURCE_MODEL = process.env.CONTEXTFABRIC_GEMMA_SOURCE_MODEL || 'gemma4:e2b';
const FALLBACK_SOURCE_MODELS = ['gemma4:e4b', 'gemma4:latest'];
let SOURCE_MODEL = PREFERRED_SOURCE_MODEL;
const MODEL = process.env.CONTEXTFABRIC_OLLAMA_MODEL || 'cf-gemma4';
const EMBEDDING_MODEL = process.env.CONTEXTFABRIC_EMBEDDING_MODEL || 'nomic-embed-text';

const LOW_MEMORY_OPTIONS = {
  num_ctx: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_CTX || 128),
  num_predict: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_PREDICT || 32),
  num_batch: Number(process.env.CONTEXTFABRIC_GEMMA_NUM_BATCH || 4),
  temperature: 0,
};

const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function warn(message) {
  console.log(`WARN ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${OLLAMA_URL}${path}`, init);
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { res, body, text };
}

async function ensureOllama() {
  try {
    const { res, body } = await fetchJson('/api/version');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pass(`Ollama is running at ${OLLAMA_URL} (${body.version || 'version unknown'})`);
  } catch (error) {
    fail(`Ollama is not reachable at ${OLLAMA_URL}. Start Ollama, then rerun npm run verify:gemma.`);
    throw error;
  }
}

async function listModels() {
  const { res, body } = await fetchJson('/api/tags');
  if (!res.ok) {
    fail(`Could not list Ollama models: HTTP ${res.status}`);
    return [];
  }
  return body.models || [];
}

async function createConstrainedModel(numCtx = LOW_MEMORY_OPTIONS.num_ctx) {
  const { res, text } = await fetchJson('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      from: SOURCE_MODEL,
      parameters: {
        num_ctx: numCtx,
        num_predict: LOW_MEMORY_OPTIONS.num_predict,
        num_batch: LOW_MEMORY_OPTIONS.num_batch,
        temperature: 0,
      },
      stream: false,
    }),
  });

  if (!res.ok) {
    fail(`Could not create ${MODEL}: ${text.slice(0, 500)}`);
    return false;
  }

  pass(`Created ${MODEL} with num_ctx=${numCtx}`);
  return true;
}

async function ensureModel(models) {
  const names = models.map(model => model.name);
  const hasPreferredSource = names.includes(PREFERRED_SOURCE_MODEL) || names.includes(`${PREFERRED_SOURCE_MODEL}:latest`);
  const fallbackSource = FALLBACK_SOURCE_MODELS.find(model => names.includes(model) || names.includes(`${model}:latest`));
  const hasSource = hasPreferredSource || Boolean(fallbackSource);
  const hasConstrained = names.includes(MODEL) || names.includes(`${MODEL}:latest`);

  if (!hasSource && !hasConstrained) {
    fail(`Missing Gemma source model. Run: ollama pull ${PREFERRED_SOURCE_MODEL}`);
    return false;
  }

  if (hasPreferredSource) {
    SOURCE_MODEL = PREFERRED_SOURCE_MODEL;
    pass(`Gemma source model is installed: ${SOURCE_MODEL}`);
  } else if (fallbackSource) {
    SOURCE_MODEL = fallbackSource;
    warn(`Preferred edge model ${PREFERRED_SOURCE_MODEL} is not installed; using larger fallback ${SOURCE_MODEL}.`);
    warn(`For the challenge setup, run: ollama pull ${PREFERRED_SOURCE_MODEL}`);
  }

  if (hasConstrained) {
    pass(`Constrained model profile exists: ${MODEL}`);
    if (process.env.CONTEXTFABRIC_RECREATE_GEMMA === '1' || SOURCE_MODEL !== PREFERRED_SOURCE_MODEL) return createConstrainedModel();
    return true;
  }

  warn(`Constrained model ${MODEL} is missing. Creating it from ${SOURCE_MODEL}...`);
  return createConstrainedModel();
}

async function ensureEmbedding(models) {
  const names = models.map(model => model.name);
  if (names.includes(EMBEDDING_MODEL) || names.includes(`${EMBEDDING_MODEL}:latest`)) {
    pass(`Embedding model is installed: ${EMBEDDING_MODEL}`);
    return true;
  }
  warn(`Embedding model is missing. Semantic search will use fallback embeddings until you run: ollama pull ${EMBEDDING_MODEL}`);
  return false;
}

async function generateTest() {
  await unload(MODEL);
  await unload(SOURCE_MODEL);
  const prompt = 'Reply with exactly: ContextFabric Gemma 4 online';
  const { res, body, text } = await fetchJson('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      keep_alive: '0s',
      options: LOW_MEMORY_OPTIONS,
    }),
  });

  if (!res.ok) {
    const message = body.error || text || `HTTP ${res.status}`;
    fail(`Gemma generation failed: ${message}`);
    if (/memory|allocate|system/i.test(message)) {
      warn('Recreating the constrained model at num_ctx=128 and retrying once.');
      await createConstrainedModel(128);
      await unload(MODEL);
      const retry = await fetchJson('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
          keep_alive: '0s',
          options: { ...LOW_MEMORY_OPTIONS, num_ctx: 128, num_batch: 1, num_predict: 16 },
        }),
      });
      if (retry.res.ok && retry.body.response) {
        pass(`Gemma responded after low-memory retry: ${String(retry.body.response).trim().replace(/\s+/g, ' ').slice(0, 160)}`);
        return true;
      }
      warn(`Close browsers/editors, or install the smaller edge model with: ollama pull ${PREFERRED_SOURCE_MODEL}`);
    }
    return false;
  }

  const response = String(body.response || '').trim();
  if (!response) {
    fail('Gemma returned an empty response.');
    return false;
  }
  pass(`Gemma responded: ${response.replace(/\s+/g, ' ').slice(0, 160)}`);
  return true;
}

async function unload(model = MODEL) {
  await fetchJson('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
  }).catch(() => {});
}

await ensureOllama();
const models = await listModels();
await ensureEmbedding(models);
const modelReady = await ensureModel(models);
if (modelReady) await generateTest();
await unload();

if (failures.length > 0) {
  console.error('\nGemma verification failed.');
  console.error('Fix the FAIL item(s), then rerun: npm run verify:gemma');
  process.exit(1);
}

console.log('\nGemma verification passed.');
console.log('Offline proof: disconnect WiFi, keep Ollama running, then rerun npm run verify:gemma.');
