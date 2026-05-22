const DEFAULT_SETTINGS = {
  apiUrl: 'http://localhost:47821',
  appId: 'browser-extension',
  defaultQuery: 'current project context, writing style, technical decisions, preferences',
  maxTokens: 800,
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function apiFetch(path, options = {}) {
  const settings = await getSettings();
  const response = await fetch(`${settings.apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-ContextFabric-App': settings.appId,
      ...(options.headers || {}),
    },
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(body?.error || `ContextFabric API ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function trimContext(context, maxTokens) {
  const maxChars = Math.max(1200, Number(maxTokens || 800) * 6);
  if (context.length <= maxChars) return context;
  return `${context.slice(0, maxChars).trim()}\n\n[ContextFabric trimmed this bundle to fit the configured prompt size.]`;
}

function targetAppFromPayload(meta = {}) {
  const host = `${meta.hostname || ''}`.toLowerCase();
  const title = `${meta.pageTitle || ''}`.toLowerCase();
  if (host.includes('claude') || title.includes('claude')) return 'claude';
  if (host.includes('chatgpt') || host.includes('openai') || title.includes('chatgpt')) return 'chatgpt';
  if (host.includes('cursor') || title.includes('cursor')) return 'cursor';
  return 'generic';
}

function buildContextPrompt(context, meta = {}) {
  const title = meta.pageTitle ? ` for "${meta.pageTitle}"` : '';
  const targetApp = targetAppFromPayload(meta);
  if (targetApp === 'cursor') {
    return [
      `ContextFabric project memory${title}:`,
      '',
      trimContext(context, meta.maxTokens).trim(),
      '',
      'Use this as engineering background. Cite ContextFabric node ids when making project-specific claims.',
    ].join('\n');
  }
  if (targetApp === 'claude') {
    return [
      `Please load this ContextFabric memory${title} as background context.`,
      '',
      trimContext(context, meta.maxTokens).trim(),
      '',
      'Acknowledge briefly that the memory is loaded, then continue naturally with the user task.',
    ].join('\n');
  }
  if (targetApp === 'chatgpt') {
    return [
      `Use the following ContextFabric memory${title} before answering:`,
      '',
      trimContext(context, meta.maxTokens).trim(),
      '',
      'Keep the answer grounded in these memories and mention when there is not enough context.',
    ].join('\n');
  }
  return [
    `Use this ContextFabric memory${title} as background context before answering.`,
    'Respect these project facts, preferences, and decisions unless the user says otherwise.',
    '',
    trimContext(context, meta.maxTokens).trim(),
    '',
    'Acknowledge briefly that ContextFabric context is loaded, then continue with the user task.',
  ].join('\n');
}

async function ensurePermission(reason) {
  const settings = await getSettings();
  try {
    await apiFetch('/api/stats');
    return { allowed: true };
  } catch (error) {
    if (error.status !== 403) throw error;
    const request = await apiFetch('/api/permission/request', {
      method: 'POST',
      body: JSON.stringify({
        scopes: ['context', 'project', 'preferences'],
        reason: reason || 'Browser extension wants to inject approved context into an AI chat.',
      }),
    });
    return {
      allowed: false,
      request,
      message: `Approve ${settings.appId} in ContextFabric -> Permissions, then try again.`,
    };
  }
}

async function getContextBundle(payload = {}) {
  const settings = await getSettings();
  const query = payload.query || settings.defaultQuery;
  const permission = await ensurePermission(`Inject context into ${payload.hostname || 'an AI chat'}.`);
  if (!permission.allowed) return { status: 'permission_required', ...permission };

  const token = await apiFetch('/api/token', {
    method: 'POST',
    body: JSON.stringify({
      query,
      ttlSeconds: 3600,
      targetApp: targetAppFromPayload(payload),
      maxWords: settings.maxTokens,
    }),
  });

  const retrieved = await apiFetch(`/api/token/${encodeURIComponent(token.token)}`, {
    method: 'GET',
  });

  return {
    status: 'ready',
    token,
    context: retrieved.context,
    prompt: buildContextPrompt(retrieved.context, { ...payload, maxTokens: settings.maxTokens }),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    if (message.type === 'CF_GET_CONTEXT') {
      sendResponse(await getContextBundle(message.payload || {}));
      return;
    }

    if (message.type === 'CF_GET_STATUS') {
      const settings = await getSettings();
      try {
        const health = await apiFetch('/health', { headers: { 'X-ContextFabric-App': settings.appId } });
        sendResponse({ connected: true, settings, health });
      } catch (error) {
        sendResponse({ connected: false, settings, error: error.message });
      }
      return;
    }

    if (message.type === 'CF_SAVE_SETTINGS') {
      await chrome.storage.sync.set(message.settings || {});
      sendResponse({ ok: true, settings: await getSettings() });
    }
  })().catch(error => {
    sendResponse({
      status: 'error',
      ok: false,
      error: error.message,
      body: error.body,
    });
  });

  return true;
});
