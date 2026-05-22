const state = document.querySelector('[data-state]');
const message = document.querySelector('[data-message]');
const enabled = document.querySelector('[data-enabled]');
const lastInjected = document.querySelector('[data-last-injected]');

function setStatus(label, text) {
  state.textContent = label;
  message.textContent = text;
}

function formatLastInjected(result) {
  if (!result?.lastInjectedAt) return 'Never';
  const date = new Date(result.lastInjectedAt);
  const host = result.lastInjectedHost ? ` on ${result.lastInjectedHost}` : '';
  return `${date.toLocaleString()}${host}`;
}

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'CF_GET_STATUS' });
  enabled.checked = result?.settings?.enabled !== false;
  lastInjected.textContent = formatLastInjected(result);
  if (result?.connected) {
    setStatus('Connected', `Daemon found at ${result.settings.apiUrl}. ${enabled.checked ? 'Auto-inject is ready for new chats.' : 'Bridge is currently off.'}`);
  } else {
    setStatus('Offline', result?.error || 'Start ContextFabric, then try again.');
  }
}

enabled.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'CF_SET_ENABLED', enabled: enabled.checked });
  setStatus(enabled.checked ? 'Enabled' : 'Off', enabled.checked
    ? 'ContextFabric will inject on supported AI chats.'
    : 'ContextFabric will not inject or show the page button.');
});

document.querySelector('[data-refresh]').addEventListener('click', async () => {
  setStatus('Checking', 'Looking for the local ContextFabric API.');
  await refresh();
});

document.querySelector('[data-options]').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refresh().catch(error => setStatus('Error', error.message));
