// アプリ本体をキャッシュし、毎朝の通知を表示する
const CACHE = 'shadowing-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 新しい版を優先し、つながらない時だけキャッシュを使う
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// 単語帳（IndexedDB）から今日の復習の数を数える
function dueCount() {
  return new Promise(resolve => {
    const req = indexedDB.open('shadowing', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const g = req.result.transaction('kv').objectStore('kv').get('vocab');
        g.onsuccess = () => {
          const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          resolve((g.result || []).filter(v => !v.mastered && v.due && v.due <= today).length);
        };
        g.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}; try { data = e.data.json(); } catch {}
    const n = await dueCount();
    const body = data.body || (n === null ? '今日の復習をしましょう' : n > 0 ? `今日の復習：${n}個` : '今日の復習はありません。動画で練習しましょう');
    if (n !== null && self.navigator.setAppBadge) { n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge(); }
    await self.registration.showNotification('Shadowing', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily', data: { url: n > 0 ? './#/review' : './#/vocab' } });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
