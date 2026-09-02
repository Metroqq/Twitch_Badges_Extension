(function () {
  'use strict';

  const STORAGE_KEY = 'tw_random_badge_settings';

  const ROLE_BADGE_PATTERNS = [
    'Владелец канала', 'Модератор', 'VIP', 'Партнёр Twitch',
    'Стажёр Twitch', 'Сотрудник Twitch', 'Значок роли',
    'broadcaster', 'moderator', 'staff'
  ];

  const ROLE_BADGE_URL_PARTS = [
    '/5527c58c-', '/32651058-', '/346e8ea4-', '/d3716312-', '/ff330000-'
  ];

  const EXCLUDED_BADGE_IDS = ['no_video', 'no_audio'];

  const EXCLUDED_BADGE_ALTS = ['Отсутствует', 'Только прослушивание', 'Просмотр без звука'];

  let settings = {
    enabled: true,
    rotationMode: 'random',
    excludeSub: false,
    excludeTurbo: false,
    excludeBits: false,
    excludedBadges: []
  };

  let lastBadgeSrc = null;
  let isSending = false;
  let sendQueue = [];
  let isProcessingQueue = false;
  let sequentialIndex = 0;

  const STORAGE_KEY_SEQ = 'tw_random_badge_seq_index';

  function log(msg) {
    console.log(`[TwRandomBadge] ${msg}`);
  }

  function isRoleBadge(img) {
    const alt = (img.alt || '').toLowerCase();
    const aria = (img.getAttribute('aria-label') || '').toLowerCase();
    const src = (img.src || '');

    for (const p of ROLE_BADGE_PATTERNS) {
      if (alt.includes(p.toLowerCase()) || aria.includes(p.toLowerCase())) return true;
    }
    for (const u of ROLE_BADGE_URL_PARTS) {
      if (src.includes(u)) return true;
    }
    return false;
  }

  function isExcludedBadge(img) {
    const badgeId = img.getAttribute('data-badge-id') || '';
    if (EXCLUDED_BADGE_IDS.includes(badgeId)) return true;

    const alt = (img.alt || '').toLowerCase();
    for (const a of EXCLUDED_BADGE_ALTS) {
      if (alt.includes(a.toLowerCase())) return true;
    }

    const parent = img.parentElement;
    if (parent) {
      const pid = parent.getAttribute('data-badge-id') || '';
      if (EXCLUDED_BADGE_IDS.includes(pid)) return true;
    }

    return false;
  }

  // Исправлено: добавлен '/subs/' — ссылки на страницу покупки подписки
  // (https://www.twitch.tv/subs/{имя_стримера}) не распознавались как подписочные,
  // из-за чего их кликали при ротации и открывались вкладки /subs.
  const SUBSCRIPTION_URL_PARTS = [
    'subscribe', '/sub/', '/subs/', 'product', 'checkout', 'purchase',
    'gift-sub', 'prime', 'tier'
  ];

  const SUBSCRIPTION_ALT_PATTERNS = [
    'подписк', 'subscribe', 'sub gift', 'подарочная подписка',
    'prime gaming', ' sub '
  ];

  function isSubscriptionBadge(img) {
    const alt = (img.alt || '').toLowerCase();
    const aria = (img.getAttribute('aria-label') || '').toLowerCase();

    for (const p of SUBSCRIPTION_ALT_PATTERNS) {
      if (alt.includes(p) || aria.includes(p)) return true;
    }

    let el = img;
    for (let i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) break;

      if (el.tagName === 'A') {
        const href = (el.getAttribute('href') || '').toLowerCase();
        for (const part of SUBSCRIPTION_URL_PARTS) {
          if (href.includes(part)) return true;
        }
      }

      const target = (el.getAttribute('data-a-target') || '').toLowerCase();
      if (target.includes('subscribe') || target.includes('sub-goal') ||
          target.includes('product') || target.includes('promo')) {
        return true;
      }

      const testId = (el.getAttribute('data-test-selector') || '').toLowerCase();
      if (testId.includes('subscribe') || testId.includes('sub-') ||
          testId.includes('product')) {
        return true;
      }
    }

    return false;
  }

  function hasChannelSpecificBadge() {
    const btn = findBadgePickerButton();
    if (!btn) return false;

    if (btn.getAttribute('data-a-target') === 'chat-badge-carousel-badge-icon') {
      const img = btn.querySelector('img');
      if (img && img.getAttribute('data-badge-id')) return true;
    }

    return false;
  }

  function filterBySettings(badges) {
    return badges.filter(b => {
      const s = (b.src + ' ' + b.alt).toLowerCase();
      if (settings.excludeSub && (/subscriber/i.test(s) || /\/sub\//i.test(s))) return false;
      if (settings.excludeTurbo && /turbo/i.test(s)) return false;
      if (settings.excludeBits && (/bits/i.test(s) || /cheer/i.test(s))) return false;
      for (const ex of settings.excludedBadges) {
        if (s.includes(ex.toLowerCase())) return false;
      }
      return true;
    });
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) settings = { ...settings, ...result[STORAGE_KEY] };
    } catch (e) {}
  }

  async function saveSettings() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    } catch (e) {}
  }

  async function loadSequentialIndex() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_SEQ);
      if (result[STORAGE_KEY_SEQ] !== undefined) sequentialIndex = result[STORAGE_KEY_SEQ];
    } catch (e) {}
  }

  async function saveSequentialIndex() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_SEQ]: sequentialIndex });
    } catch (e) {}
  }

  function findBadgePickerButton() {
    return document.querySelector('button[data-a-target="chat-badge-carousel-badge-icon"]') ||
           document.querySelector('button[aria-label="ChatBadgeCarousel"]') ||
           document.querySelector('[data-a-target="chat-badge-carousel"] button');
  }

  function findPickerDialog() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const d of dialogs) {
      if (d.querySelector('img.chat-badge') ||
          d.querySelector('[data-a-target*="badge"]') ||
          d.textContent.includes('значок')) return d;
    }
    return dialogs[0] || null;
  }

  function findClickableBadgeParent(img) {
    let el = img;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;

      if (el.tagName === 'A') {
        const href = (el.getAttribute('href') || '').toLowerCase();
        let isSubLink = false;
        for (const part of SUBSCRIPTION_URL_PARTS) {
          if (href.includes(part)) { isSubLink = true; break; }
        }
        if (isSubLink) continue;
      }

      const role = el.getAttribute('role');
      const tag = el.tagName;
      if (role === 'button' || tag === 'BUTTON' || tag === 'A' ||
          el.hasAttribute('tabindex') || el.dataset.aTarget) {
        return el;
      }
    }
    return img.parentElement || img;
  }

  function simulateClick(element) {
    element.click();
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function collectDialogBadges() {
    const dialog = findPickerDialog();
    if (!dialog) return [];

    const badges = [];
    const seen = new Set();

    const allImgs = dialog.querySelectorAll('img');
    allImgs.forEach(img => {
      if (!img.src || seen.has(img.src)) return;
      if (isRoleBadge(img)) return;
      if (isExcludedBadge(img)) return;
      if (isSubscriptionBadge(img)) return;

      const src = img.src;
      if (!src.includes('/badges/') && !src.includes('badges.twitch.tv') && !src.includes('badgescdn')) return;

      seen.add(src);
      const alt = img.alt || img.getAttribute('aria-label') || '';
      const clickable = findClickableBadgeParent(img);
      badges.push({ alt, src, element: clickable, img });
    });

    return badges;
  }

  function pickRandom(badges) {
    const filtered = filterBySettings(badges);
    const pool = filtered.length > 0 ? filtered : badges;
    if (pool.length === 0) return null;

    if (settings.rotationMode === 'sequential') {
      sequentialIndex = sequentialIndex % pool.length;
      const badge = pool[sequentialIndex];
      sequentialIndex = (sequentialIndex + 1) % pool.length;
      saveSequentialIndex();
      return badge;
    }

    const nonRepeat = pool.filter(b => b.src !== lastBadgeSrc);
    const candidates = nonRepeat.length > 0 ? nonRepeat : pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function closePicker() {
    const dialog = findPickerDialog();
    if (dialog) {
      const closeBtn = dialog.querySelector(
        'button[aria-label="Close"], button[data-test-selector="chat-settings-close-button-selector"]'
      );
      if (closeBtn) { closeBtn.click(); return; }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
    }));
  }

  function nativeSendEnter(chatInput) {
    isSending = true;
    chatInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    setTimeout(() => { isSending = false; }, 100);
  }

  function hidePicker() {
    document.body.classList.add('tw-rbadge-hidden');
  }

  function showPicker() {
    document.body.classList.remove('tw-rbadge-hidden');
  }

  function rotateAndSend(chatInput) {
    if (!settings.enabled) {
      nativeSendEnter(chatInput);
      processQueue();
      return;
    }

    if (hasChannelSpecificBadge()) {
      log('Channel-specific badge detected, skipping rotation');
      nativeSendEnter(chatInput);
      processQueue();
      return;
    }

    const btn = findBadgePickerButton();
    if (!btn) {
      nativeSendEnter(chatInput);
      processQueue();
      return;
    }

    hidePicker();
    btn.click();

    let attempts = 0;
    const tryPick = () => {
      attempts++;
      if (attempts > 30) {
        closePicker();
        showPicker();
        nativeSendEnter(chatInput);
        processQueue();
        return;
      }

      const allBadges = collectDialogBadges();

      if (allBadges.length < 2) {
        setTimeout(tryPick, 20);
        return;
      }

      const badge = pickRandom(allBadges);
      if (badge && badge.element) {
        simulateClick(badge.element);
        simulateClick(badge.img);
        lastBadgeSrc = badge.src;
        log('Selected: ' + (badge.alt || 'badge'));

        setTimeout(() => {
          closePicker();
          setTimeout(() => {
            showPicker();
            nativeSendEnter(chatInput);
            processQueue();
          }, 50);
        }, 50);
      } else {
        setTimeout(tryPick, 20);
      }
    };

    setTimeout(tryPick, 100);
  }

  function processQueue() {
    if (sendQueue.length === 0) {
      isProcessingQueue = false;
      return;
    }

    isProcessingQueue = true;
    const next = sendQueue.shift();
    rotateAndSend(next);
  }

  function queueSend(chatInput) {
    sendQueue.push(chatInput);
    if (!isProcessingQueue) {
      isProcessingQueue = true;
      rotateAndSend(sendQueue.shift());
    }
  }

  function hookInput() {
    const chatInput = document.querySelector('[data-a-target="chat-input"]');
    if (!chatInput) {
      setTimeout(hookInput, 1000);
      return;
    }

    if (chatInput._twBadgeHooked) return;
    chatInput._twBadgeHooked = true;

    chatInput.addEventListener('keydown', (e) => {
      if (isSending) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        const text = chatInput.textContent || '';
        if (!text.trim()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        queueSend(chatInput);
      }
    }, true);

    const sendBtn = document.querySelector('[data-a-target="chat-send-button"]');
    if (sendBtn && !sendBtn._twBadgeHooked) {
      sendBtn._twBadgeHooked = true;
      sendBtn.addEventListener('click', (e) => {
        if (isSending) return;
        const text = chatInput.textContent || '';
        if (!text.trim()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        queueSend(chatInput);
      }, true);
    }

    log('Hooks installed');
  }

  function init() {
    log('Initializing...');
    loadSettings().then(() => {
      loadSequentialIndex().then(() => {
        hookInput();
        new MutationObserver(() => {
          const input = document.querySelector('[data-a-target="chat-input"]');
          if (input && !input._twBadgeHooked) hookInput();
        }).observe(document.body, { childList: true, subtree: true });
      });
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getSettings') {
      sendResponse({ settings });
    } else if (msg.action === 'updateSettings') {
      settings = { ...settings, ...msg.settings };
      saveSettings().then(() => sendResponse({ success: true }));
      return true;
    } else if (msg.action === 'selectRandom') {
      const chatInput = document.querySelector('[data-a-target="chat-input"]');
      if (chatInput) queueSend(chatInput);
      sendResponse({ success: true });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
