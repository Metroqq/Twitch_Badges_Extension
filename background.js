(function () {
  'use strict';

  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get('tw_random_badge_settings', (result) => {
      if (!result.tw_random_badge_settings) {
        chrome.storage.local.set({
          tw_random_badge_settings: {
            enabled: true,
            excludeSub: false,
            excludeTurbo: false,
            excludeBits: false,
            excludedBadges: []
          }
        });
      }
    });
  });

  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url && tab.url.includes('twitch.tv')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'selectRandom' });
      } catch (e) {
        console.log('Could not send message to content script:', e.message);
      }
    }
  });

})();
