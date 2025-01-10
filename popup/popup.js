document.addEventListener('DOMContentLoaded', async () => {
  // Load saved API key
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
    updateApiStatus('API key is set', 'success');
  }

  // Handle API key saving
  document.getElementById('saveApiKey').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
      updateApiStatus('Please enter an API key', 'error');
      return;
    }

    try {
      await chrome.storage.local.set({ apiKey });
      updateApiStatus('API key saved successfully', 'success');
    } catch (error) {
      updateApiStatus('Error saving API key', 'error');
    }
  });
});

function updateApiStatus(message, type) {
  const status = document.getElementById('apiStatus');
  status.textContent = message;
  status.className = `status ${type}`;
} 