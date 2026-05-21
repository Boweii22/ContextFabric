const state = document.querySelector('[data-state]');
const message = document.querySelector('[data-message]');

function setStatus(label, text) {
  state.textContent = label;
  message.textContent = text;
}

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'CF_GET_STATUS' });
  if (result?.connected) {
    setStatus('Connected', `Daemon found at ${result.settings.apiUrl}. Use the CF button on supported AI sites to inject context.`);
  } else {
    setStatus('Offline', result?.error || 'Start ContextFabric, then try again.');
  }
}

document.querySelector('[data-request]').addEventListener('click', async () => {
  setStatus('Requesting', 'Sending a permission request to ContextFabric.');
  const result = await chrome.runtime.sendMessage({
    type: 'CF_GET_CONTEXT',
    payload: {
      hostname: 'browser extension popup',
      pageTitle: 'Permission check',
      query: 'current project context',
    },
  });

  if (result?.status === 'permission_required') {
    setStatus('Approval needed', 'Open ContextFabric Permissions and approve the browser-extension request.');
  } else if (result?.status === 'ready') {
    setStatus('Approved', 'The extension can retrieve approved context.');
  } else {
    setStatus('Error', result?.error || 'Could not request access.');
  }
});

document.querySelector('[data-options]').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refresh().catch(error => setStatus('Error', error.message));
