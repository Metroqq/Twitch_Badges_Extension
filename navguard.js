// Исправлено: страховка от самопроизвольного открытия вкладок при ротации
// значков. Значок «Основатель» при клике мог открывать
// https://help.twitch.tv/s/article/founders-badge (4 новые вкладки).
// Пока идёт ротация, content.js шлёт сообщение tw-rbadge-nav, и на это
// время блокируется window.open для URL, ведущих на другую страницу.
(() => {
  'use strict';

  let block = false;
  const origOpen = window.open;

  window.open = function (url, ...rest) {
    if (block && typeof url === 'string') {
      try {
        const u = new URL(url, location.href);
        if (u.origin !== location.origin || u.pathname !== location.pathname) {
          return null;
        }
      } catch (e) {
        return null;
      }
    }
    return origOpen.call(this, url, ...rest);
  };

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'tw-rbadge-nav') return;
    block = !!e.data.block;
  });
})();
