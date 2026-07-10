(function () {
  'use strict';

  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleSequential = document.getElementById('toggle-sequential');
  const statusEl = document.getElementById('status');

  function updateStatus(enabled) {
    if (enabled) {
      statusEl.textContent = 'Активно — бейджи будут меняться при отправке';
      statusEl.className = 'status active';
    } else {
      statusEl.textContent = 'Выключено — бейджи не будут меняться';
      statusEl.className = 'status inactive';
    }
  }

  async function loadSettings() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('twitch.tv')) {
        statusEl.textContent = 'Откройте Twitch.tv для использования расширения';
        statusEl.className = 'status inactive';
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getSettings' });
      if (response && response.settings) {
        toggleEnabled.checked = response.settings.enabled;
        toggleSequential.checked = response.settings.rotationMode === 'sequential';
        updateStatus(response.settings.enabled);
      }
    } catch (e) {
      statusEl.textContent = 'Не удалось подключиться к странице Twitch';
      statusEl.className = 'status inactive';
    }
  }

  async function updateSettings(newSettings) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      await chrome.tabs.sendMessage(tab.id, {
        action: 'updateSettings',
        settings: newSettings
      });
    } catch (e) {}
  }

  toggleEnabled.addEventListener('change', () => {
    updateStatus(toggleEnabled.checked);
    updateSettings({ enabled: toggleEnabled.checked });
  });

  toggleSequential.addEventListener('change', () => {
    updateSettings({ rotationMode: toggleSequential.checked ? 'sequential' : 'random' });
  });

  loadSettings();

})();
