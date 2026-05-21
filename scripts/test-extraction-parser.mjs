import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const modulePath = join(root, 'src', 'shared', 'contextExtraction.ts');
const source = readFileSync(modulePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

const exportsObject = {};
const sandbox = { exports: exportsObject, module: { exports: exportsObject } };
vm.runInNewContext(compiled.outputText, sandbox, { filename: modulePath });
const { parseContextExtraction, buildContextExtractionPrompt, CONTEXT_NODE_TYPES } = sandbox.module.exports;

const valid = JSON.stringify({
  nodes: [
    {
      type: 'project',
      title: 'ContextFabric',
      summary: 'ContextFabric keeps AI memory local and portable across tools.',
      confidence: 0.94,
      evidence: 'local-first AI memory layer',
      entities: ['ContextFabric', 'Gemma 4'],
      tags: ['local-first', 'memory'],
      metadata: { sourceInputType: 'prose' },
    },
    {
      type: 'decision',
      title: 'Use local Gemma 4',
      summary: 'The project uses Gemma 4 locally to avoid cloud egress.',
      confidence: 0.9,
      evidence: 'Gemma 4 runs locally via Ollama',
      entities: ['Gemma 4', 'Ollama'],
      tags: ['privacy'],
      metadata: { reasoning: 'Private extraction is central to the product.', reversible: true },
    },
  ],
});

const markdownWrapped = `Here is the JSON:\n\`\`\`json\n${valid.replace(/}\]/, '},]')}\n\`\`\``;
const invalidType = JSON.stringify({
  nodes: [{ type: 'random', title: 'Nope', summary: 'Nope', confidence: 0.9, evidence: 'Nope', entities: [], tags: [], metadata: {} }],
});
const lowConfidence = JSON.stringify({
  nodes: [{ type: 'preference', title: 'Guess', summary: 'Weak guess.', confidence: 0.2, evidence: 'maybe', entities: [], tags: [], metadata: {} }],
});

const cases = [
  ['valid schema', valid, true, 2],
  ['markdown repair', markdownWrapped, true, 2],
  ['invalid type rejected', invalidType, false, 0],
  ['low confidence dropped', lowConfidence, true, 0],
];

const failures = [];
for (const [name, raw, expectedOk, expectedCount] of cases) {
  const parsed = parseContextExtraction(raw);
  if (parsed.ok !== expectedOk) failures.push(`${name}: expected ok=${expectedOk}, got ${parsed.ok}`);
  if (parsed.result.nodes.length !== expectedCount) {
    failures.push(`${name}: expected ${expectedCount} node(s), got ${parsed.result.nodes.length}`);
  }
}

const prompt = buildContextExtractionPrompt('I chose SQLite because this is local-first.', 'notes');
for (const type of CONTEXT_NODE_TYPES) {
  if (!prompt.includes(type)) failures.push(`Prompt does not mention node type: ${type}`);
}
if (!prompt.includes('"nodes"')) failures.push('Prompt does not include JSON nodes schema.');

if (failures.length > 0) {
  console.error('Extraction parser tests failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Extraction parser tests passed.');
