const CONTEXTFABRIC_HOSTS = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'www.perplexity.ai': 'Perplexity',
  'perplexity.ai': 'Perplexity',
  'poe.com': 'Poe',
  'copilot.microsoft.com': 'Microsoft Copilot',
  'www.cursor.com': 'Cursor',
  'cursor.com': 'Cursor',
  'app.cursor.com': 'Cursor',
  'chat.mistral.ai': 'Mistral',
  'mistral.ai': 'Mistral',
  'chat.deepseek.com': 'DeepSeek',
  'grok.com': 'Grok',
  'you.com': 'You.com',
  'www.phind.com': 'Phind',
  'huggingface.co': 'HuggingChat',
  'kimi.moonshot.cn': 'Kimi',
  'chat.qwen.ai': 'Qwen',
  'notebooklm.google.com': 'NotebookLM',
  'aistudio.google.com': 'Google AI Studio',
};

const platformName = CONTEXTFABRIC_HOSTS[window.location.hostname] || 'this AI tool';
const DEFAULT_QUERY = 'current project context, writing style, technical decisions, preferences';

function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function isEditable(element) {
  if (!element) return false;
  if (element.closest?.('#contextfabric-bridge')) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === 'textarea' || tag === 'input' || element.isContentEditable || element.getAttribute('role') === 'textbox';
}

function findEditable() {
  const selectors = [
    '#prompt-textarea',
    'textarea[data-testid="prompt-textarea"]',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror',
  ];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    const visible = elements.find(el => {
      if (el.closest?.('#contextfabric-bridge')) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 80 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    if (visible) return visible;
  }

  return isEditable(document.activeElement) ? document.activeElement : null;
}

function setNativeValue(element, value) {
  const proto = element.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter ? setter.call(element, value) : (element.value = value);
}

function insertIntoEditable(text) {
  const target = findEditable();
  if (!target) return false;

  target.focus();
  const tag = target.tagName?.toLowerCase();

  if (tag === 'textarea' || tag === 'input') {
    const current = target.value || '';
    const prefix = current.trim() ? `${current.trim()}\n\n` : '';
    setNativeValue(target, `${prefix}${text}`);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const currentText = target.innerText || target.textContent || '';
  const prefix = currentText.trim() ? '\n\n' : '';
  try {
    document.execCommand('insertText', false, `${prefix}${text}`);
  } catch {
    target.textContent = `${currentText}${prefix}${text}`;
  }
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}

async function copyPrompt(text) {
  await navigator.clipboard.writeText(text);
}

function createBridge() {
  if (document.getElementById('contextfabric-bridge')) return;
  if (!document.body) return;

  const root = document.createElement('div');
  root.id = 'contextfabric-bridge';
  root.innerHTML = `
    <button class="cfb-trigger" type="button" title="Load ContextFabric context">CF</button>
    <section class="cfb-panel" hidden>
      <div class="cfb-header">
        <strong>ContextFabric</strong>
        <button class="cfb-icon" type="button" data-close title="Close">x</button>
      </div>
      <label class="cfb-field">
        <span>Context query</span>
        <textarea data-query rows="3" spellcheck="false">${DEFAULT_QUERY}</textarea>
      </label>
      <div class="cfb-actions">
        <button type="button" data-inject>Inject</button>
        <button type="button" data-copy>Copy</button>
      </div>
      <p class="cfb-status" data-status>Ready for ${platformName}.</p>
    </section>
  `;

  const trigger = root.querySelector('.cfb-trigger');
  const panel = root.querySelector('.cfb-panel');
  const status = root.querySelector('[data-status]');
  const query = root.querySelector('[data-query]');

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function getPrompt() {
    setStatus('Loading approved local context...');
    if (query.value.includes('Use this ContextFabric memory')) {
      query.value = DEFAULT_QUERY;
    }
    const result = await sendToBackground('CF_GET_CONTEXT', {
      hostname: window.location.hostname,
      pageTitle: document.title,
      query: query.value.trim(),
    });

    if (result?.status === 'permission_required') {
      setStatus('Approval needed. Open ContextFabric Permissions and grant the request, then try again.', 'warn');
      return null;
    }

    if (result?.status === 'error' || result?.error) {
      setStatus(result.error || 'ContextFabric is not reachable.', 'error');
      return null;
    }

    return result.prompt;
  }

  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  root.querySelector('[data-close]').addEventListener('click', () => {
    panel.hidden = true;
  });

  root.querySelector('[data-inject]').addEventListener('click', async () => {
    try {
      const prompt = await getPrompt();
      if (!prompt) return;
      const inserted = insertIntoEditable(prompt);
      if (inserted) {
        setStatus('Context inserted into the chat box.', 'ok');
      } else {
        await copyPrompt(prompt);
        setStatus('No chat box found. Context copied instead.', 'warn');
      }
    } catch (error) {
      setStatus(error.message || 'Could not inject context.', 'error');
    }
  });

  root.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      const prompt = await getPrompt();
      if (!prompt) return;
      await copyPrompt(prompt);
      setStatus('Context copied to clipboard.', 'ok');
    } catch (error) {
      setStatus(error.message || 'Could not copy context.', 'error');
    }
  });

  document.body.appendChild(root);
}

function keepBridgeMounted() {
  createBridge();

  const observer = new MutationObserver(() => {
    if (!document.getElementById('contextfabric-bridge')) {
      createBridge();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('pageshow', createBridge);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) createBridge();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', keepBridgeMounted, { once: true });
} else {
  keepBridgeMounted();
}
