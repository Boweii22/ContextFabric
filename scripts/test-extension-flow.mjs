import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'browser-extension', 'manifest.json'), 'utf8'));
const background = readFileSync(join(root, 'browser-extension', 'src', 'background.js'), 'utf8');
const content = readFileSync(join(root, 'browser-extension', 'src', 'content.js'), 'utf8');
const popupHtml = readFileSync(join(root, 'browser-extension', 'src', 'popup.html'), 'utf8');
const popupJs = readFileSync(join(root, 'browser-extension', 'src', 'popup.js'), 'utf8');

const failures = [];

if (manifest.manifest_version !== 3) failures.push('Manifest is not MV3.');
if (!manifest.host_permissions.includes('http://127.0.0.1:7749/*')) failures.push('Missing 127.0.0.1:7749 host permission.');
if (!manifest.content_scripts?.some(script => script.matches?.includes('https://claude.ai/*'))) failures.push('Claude content script match missing.');
if (!manifest.content_scripts?.some(script => script.matches?.includes('https://chatgpt.com/*'))) failures.push('ChatGPT second target missing.');

if (!background.includes("apiUrl: 'http://127.0.0.1:7749'")) failures.push('Background default API is not the challenge daemon.');
if (!background.includes('/health')) failures.push('Background does not check /health.');
if (!background.includes('/context?')) failures.push('Background does not fetch GET /context.');
if (!background.includes('CF_RECORD_INJECTION')) failures.push('Background does not record injection state.');
if (!background.includes('CF_SET_ENABLED')) failures.push('Background does not support popup toggle.');

if (!content.includes("'claude.ai': 'Claude'")) failures.push('Content script does not detect Claude.');
if (!content.includes('insertIntoEditable')) failures.push('Content script missing input injection.');
if (!content.includes('pushState') || !content.includes('replaceState') || !content.includes('popstate')) failures.push('SPA navigation hooks missing.');
if (!content.includes('contextfabric:auto-inject')) failures.push('Auto re-injection event missing.');
if (!content.includes('CF_RECORD_INJECTION')) failures.push('Content script does not record last injection.');

if (!popupHtml.includes('data-enabled')) failures.push('Popup toggle missing.');
if (!popupHtml.includes('data-last-injected')) failures.push('Popup last injected field missing.');
if (!popupJs.includes('CF_SET_ENABLED')) failures.push('Popup does not save enabled toggle.');
if (!popupJs.includes('lastInjectedAt')) failures.push('Popup does not display last injection state.');

if (failures.length > 0) {
  console.error('Extension flow checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Extension flow checks passed.');
