import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modulePath = join(process.cwd(), 'src', 'shared', 'contextAssembly.ts');
const source = readFileSync(modulePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

const exportsObject = {};
const sandbox = { exports: exportsObject, module: { exports: exportsObject }, require: (name) => {
  if (name === './types') return {};
  throw new Error(`Unexpected require: ${name}`);
}};
vm.runInNewContext(compiled.outputText, sandbox, { filename: modulePath });

const {
  PAYLOAD_ASSEMBLY_SYSTEM_PROMPT,
  buildContextAssemblyPrompt,
  parseContextAssembly,
  buildFallbackContextPayload,
  normalizeAssemblyApp,
  validateAssemblyGrounding,
} = sandbox.module.exports;

const now = Date.now();
const nodes = [
  node('n-project', 'project', 'ContextFabric', 'ContextFabric is a local-first AI memory layer that stores user context on-device.'),
  node('n-extension', 'project', 'Browser Bridge', 'The browser extension injects approved ContextFabric memory into AI chat tools.'),
  node('n-sqlite', 'decision', 'Use SQLite', 'ContextFabric stores memory nodes in local SQLite with encrypted-at-rest content.'),
  node('n-gemma', 'decision', 'Use Gemma 4 locally', 'Gemma 4 runs through Ollama to extract and assemble context without cloud egress.'),
  node('n-permission', 'decision', 'Permission tokens', 'Apps request access and receive signed scoped context tokens after approval.'),
  node('n-style', 'style', 'Direct style', 'The user prefers simple, direct explanations with clear testing steps.'),
  node('n-pref', 'preference', 'No fake demos', 'The user wants real working features, not hardcoded demo behavior.'),
  node('n-privacy', 'preference', 'Privacy first', 'The project must keep normal memory processing local and private.'),
  node('n-person', 'person', 'Builder', 'Bowei is building ContextFabric for the Gemma 4 Challenge.'),
  node('n-docs', 'document', 'Prompt docs', 'PROMPTS.md documents extraction, conflict detection, and assembly prompt decisions.'),
  node('n-test', 'note', 'Testing', 'Tests should cover parser behavior, memory storage, conflicts, and extension injection.'),
];

function node(id, type, title, summary) {
  return {
    id,
    type,
    title,
    summary,
    content: summary,
    sourceId: 'source-1',
    sourceName: 'Assembly Fixture',
    sourceType: 'markdown',
    timestamp: now,
    confidence: 0.92,
    tags: [],
    entities: [],
    metadata: {},
  };
}

const failures = [];

if (!PAYLOAD_ASSEMBLY_SYSTEM_PROMPT.includes('Use ONLY the supplied memory nodes')) {
  failures.push('Assembly prompt does not forbid unsupported facts.');
}
if (!PAYLOAD_ASSEMBLY_SYSTEM_PROMPT.includes('claude') || !PAYLOAD_ASSEMBLY_SYSTEM_PROMPT.includes('cursor')) {
  failures.push('Assembly prompt does not define app-aware formats.');
}

const prompt = buildContextAssemblyPrompt({ appId: 'cursor', query: 'project context', nodes, maxWords: 800 });
if (!prompt.includes('Maximum words: 800')) failures.push('Prompt does not include the requested word limit.');
if (!prompt.includes('n-project') || !prompt.includes('n-test')) failures.push('Prompt does not include all 10+ node fixtures.');
if (normalizeAssemblyApp('app.cursor.com') !== 'cursor') failures.push('Cursor app normalization failed.');
if (normalizeAssemblyApp('claude.ai') !== 'claude') failures.push('Claude app normalization failed.');

const fallback = buildFallbackContextPayload({ appId: 'cursor', query: 'project context', nodes, maxWords: 800 });
if (!fallback.payload.includes('Project') || !fallback.payload.includes('Architecture / Decisions')) {
  failures.push('Cursor fallback is not app-aware.');
}
if (fallback.payload.includes('{') || fallback.payload.includes('"nodes"')) {
  failures.push('Fallback looks like a JSON dump.');
}
if (fallback.wordCount > 800) failures.push(`Fallback exceeded word limit: ${fallback.wordCount}`);
if (fallback.usedNodeIds.length < 6) failures.push('Fallback did not use enough relevant nodes.');

const rawOnly = buildFallbackContextPayload({
  appId: 'claude',
  query: 'current project context',
  nodes: [
    node('raw-1', 'document', 'README.md', 'ContextFabric is a local-first memory app for AI tools.'),
    node('raw-2', 'conversation', 'Planning chat', 'The user prefers real working features over scripted demos.'),
  ],
  maxWords: 800,
});
if (rawOnly.payload.includes('Context\n- No reliable memory yet.')) {
  failures.push('Claude fallback ignored useful raw/document nodes.');
}
if (!rawOnly.payload.includes('[node:raw-1]')) failures.push('Raw/document fallback did not cite source node ids.');

const bundledOnly = buildFallbackContextPayload({
  appId: 'claude',
  query: 'current project context',
  nodes: [
    node('doc-1', 'document', 'README.md', 'ContextFabric is a local-first memory layer for AI tools.'),
    node('doc-2', 'document', 'PROMPTS.md', 'Payload assembly uses Gemma 4 to create grounded context briefs.'),
  ],
  maxWords: 800,
});
if (/function _mergeNamespaces|index-[A-Za-z0-9_-]+\.js/.test(bundledOnly.payload)) {
  failures.push('Assembly payload includes generated bundle text.');
}

const gemmaRaw = JSON.stringify({
  payload: [
    'Context',
    '- ContextFabric is a local-first AI memory layer stored on-device [node:n-project].',
    '',
    'Decisions',
    '- It uses local Gemma 4 through Ollama for extraction and assembly [node:n-gemma].',
    '',
    'Working Style',
    '- Keep explanations simple, direct, and testable [node:n-style].',
  ].join('\n'),
  usedNodeIds: ['n-project', 'n-gemma', 'n-style'],
  warnings: [],
});
const parsed = parseContextAssembly(gemmaRaw, { appId: 'claude', nodes, maxWords: 800 });
if (parsed.appFormat !== 'claude') failures.push('Parsed assembly did not preserve Claude app format.');
if (!parsed.payload.includes('[node:n-project]')) failures.push('Parsed assembly lost source citations.');
if (parsed.wordCount > 800) failures.push('Parsed assembly exceeded word limit.');

const hallucinated = validateAssemblyGrounding(
  'ContextFabric has 5000 users and $1M revenue [node:n-project].',
  nodes,
  ['n-project'],
);
if (hallucinated.warnings.length === 0) failures.push('Grounding validator did not flag unsupported metric claims.');

if (failures.length > 0) {
  console.error('Context assembly tests failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Context assembly tests passed.');
