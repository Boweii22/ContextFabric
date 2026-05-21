const DEFAULT_SETTINGS = {
  apiUrl: 'http://localhost:47821',
  appId: 'browser-extension',
  defaultQuery: 'current project context, writing style, technical decisions, preferences',
  maxTokens: 1800,
};

const fields = {
  apiUrl: document.querySelector('[data-api-url]'),
  appId: document.querySelector('[data-app-id]'),
  defaultQuery: document.querySelector('[data-default-query]'),
  maxTokens: document.querySelector('[data-max-tokens]'),
};
const status = document.querySelector('[data-status]');

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  fields.apiUrl.value = settings.apiUrl;
  fields.appId.value = settings.appId;
  fields.defaultQuery.value = settings.defaultQuery;
  fields.maxTokens.value = settings.maxTokens;
}

document.querySelector('[data-save]').addEventListener('click', async () => {
  const settings = {
    apiUrl: fields.apiUrl.value.trim().replace(/\/$/, '') || DEFAULT_SETTINGS.apiUrl,
    appId: fields.appId.value.trim().toLowerCase() || DEFAULT_SETTINGS.appId,
    defaultQuery: fields.defaultQuery.value.trim() || DEFAULT_SETTINGS.defaultQuery,
    maxTokens: Number(fields.maxTokens.value) || DEFAULT_SETTINGS.maxTokens,
  };
  await chrome.runtime.sendMessage({ type: 'CF_SAVE_SETTINGS', settings });
  status.textContent = 'Saved';
  setTimeout(() => { status.textContent = ''; }, 1800);
});

load();
