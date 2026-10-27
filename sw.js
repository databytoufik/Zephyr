// Offline support. App files: try the network first (so updates arrive), fall back to the saved copy after a
// short wait or when offline. Fonts: saved copy first. Claude and Google Drive requests are never touched.
const VERSION = 'zephyr-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'css/themes.css',
  'js/theme-boot.js', 'js/app.js', 'js/ai.js', 'js/backup.js', 'js/claude.js', 'js/commands.js', 'js/db.js', 'js/dictation.js',
  'js/doc.js', 'js/edits.js', 'js/markup.js', 'js/palettes.js', 'js/speech.js', 'js/state.js', 'js/ui.js', 'js/util.js', 'js/wake.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'apps-script/Code.gs'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const FONTS = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONTS.test(req.url)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
    net.catch(() => {});
    const cached = await c.match(req, {ignoreSearch: true}) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (!cached) return net;
    // Prefer fresh files, but don't keep a writer waiting on a weak signal.
    const timeout = new Promise(r => setTimeout(() => r(null), 3000));
    try { return (await Promise.race([net, timeout])) || cached; } catch (err) { return cached; }
  })());
});
