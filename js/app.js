// Start-up: load settings and the last document, pick up an unfinished session, then show the page.
import {S, DEFAULT_SETTINGS} from './state.js';
import {DB, idb, persistStorage} from './db.js';
import {SR} from './speech.js';
import {purgeArchives, createDoc, refreshTitles} from './doc.js';
import {loadBackupState} from './backup.js';
import {showZephyr, render, initUI} from './ui.js';

(async function boot() {
  try { await idb(); }
  catch (e) { showZephyr('This browser blocked storage, so Zephyr cannot save. Open this page in a normal (not private) browser window.'); return; }
  const saved = await DB.get('kv', 'settings');
  S.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
  initUI();
  await loadBackupState();
  await purgeArchives();
  await refreshTitles();
  const activeId = await DB.get('kv', 'activeSession');
  if (activeId) {
    const s = await DB.get('sessions', activeId);
    const d = s && !s.endedAt ? await DB.get('docs', s.docId) : null;
    if (s && d) {
      S.doc = d; S.session = s;
      S.text = s.versions[s.versions.length - 1].text;
      S.undo = s.versions.slice(0, -1).map((v, i) => ({text: v.text, label: s.versions[i + 1].label, t: v.t}));
      showZephyr(`Picked up your unfinished session on ${d.title}.`);
    }
  }
  if (!S.doc) {
    const lastId = await DB.get('kv', 'lastDoc');
    S.doc = lastId ? await DB.get('docs', lastId) : null;
    if (!S.doc) { const docs = await DB.all('docs'); S.doc = docs.sort((a, b) => b.updatedAt - a.updatedAt)[0] || await createDoc('Untitled draft', ''); }
    S.text = S.doc.text || '';
  }
  DB.put('kv', S.doc.id, 'lastDoc').catch(() => {});
  if (!SR) showZephyr('This browser cannot listen. On iPhone use Safari, on Android use Chrome.');
  render();
  // ask the browser to keep our storage once there is writing worth keeping
  if (S.text.trim() || S.docTitles.length > 1) persistStorage();
  else addEventListener('pointerdown', () => persistStorage(), {once: true});
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
