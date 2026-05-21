import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modulePath = join(process.cwd(), 'src', 'shared', 'conflictDetection.ts');
const compiled = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const exportsObject = {};
const sandbox = { exports: exportsObject, module: { exports: exportsObject } };
vm.runInNewContext(compiled.outputText, sandbox, { filename: modulePath });

const { buildConflictDetectionPrompt, parseConflictDetection, CONFLICT_DETECTION_PROMPT } = sandbox.module.exports;
const failures = [];

if (!CONFLICT_DETECTION_PROMPT.includes('"maybe"')) failures.push('Prompt does not require maybe flag.');
const prompt = buildConflictDetectionPrompt(
  { type: 'preference', title: 'Concise answers', content: 'Preference: prefer concise answers.' },
  { type: 'preference', title: 'Detailed answers', content: 'Preference: prefer detailed long answers.' },
);
if (!prompt.includes('Existing node') || !prompt.includes('New node')) failures.push('Prompt missing comparison sections.');

const parsed = parseConflictDetection(JSON.stringify({
  conflict: true,
  maybe: true,
  confidence: 0.67,
  type: 'tension',
  severity: 'medium',
  reason: 'Concise and detailed answers may conflict depending on task.',
  suggestedResolution: 'review',
}));
if (!parsed?.conflict || !parsed.maybe || parsed.suggestedResolution !== 'review') failures.push('Parser did not preserve maybe conflict.');

const noConflict = parseConflictDetection('```json\n{"conflict":false,"maybe":false,"confidence":0,"type":"tension","severity":"low","reason":"","suggestedResolution":"review",}\n```');
if (!noConflict || noConflict.conflict) failures.push('Parser did not repair no-conflict JSON.');

if (failures.length > 0) {
  console.error('Conflict detection tests failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Conflict detection tests passed.');
