import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [
  {
    file: 'src/renderer/src/App.tsx',
    mustContain: ['path="gemma"', 'GemmaEvidencePage', 'OnboardingPage', 'HelpPage'],
  },
  {
    file: 'src/renderer/src/components/layout/AppShell.tsx',
    mustContain: ['Gemma Evidence', 'Help', 'Sources', 'Permissions'],
  },
  {
    file: 'src/renderer/src/pages/GemmaEvidence/index.tsx',
    mustContain: ['runLiveCheck', 'api.memory.query', 'sourceTitle', 'Real Gemma 4 evidence'],
  },
  {
    file: 'src/renderer/src/pages/Onboarding/index.tsx',
    mustContain: ['Add a source', 'Sync memory', 'Ask questions'],
  },
  {
    file: 'src/renderer/src/pages/Help/index.tsx',
    mustContain: ['ContextFabric', 'Troubleshooting', 'browser bridge'],
  },
];

const failures = [];

for (const check of checks) {
  const absolute = path.join(root, check.file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${check.file} is missing`);
    continue;
  }

  const text = fs.readFileSync(absolute, 'utf8');
  for (const needle of check.mustContain) {
    if (!text.includes(needle)) failures.push(`${check.file} does not contain "${needle}"`);
  }
}

if (failures.length > 0) {
  console.error('UI flow check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('UI flow check passed.');
