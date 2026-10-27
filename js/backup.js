// Google Drive backup through the user's own Apps Script web app (see apps-script/Code.gs).
import {S} from './state.js';
import {DB} from './db.js';
import {stamp, fmtTime, fmtDate} from './util.js';
import {say} from './speech.js';
import {renderSession} from './ui.js';

export const BK = {queue: {}, flushing: false, timer: null, due: 0, last: 0, error: ''};
export const backupOn = () => !!(S.settings.backupUrl && S.settings.backupSecret);
export const docPayload = d => ({action: 'saveDoc', docId: d.id, title: d.title, text: d.text || ''});
export const sessionPayload = ended => ({action: 'sessionBackup', sessionId: S.session.id, label: `${stamp(S.session.startedAt)} ${S.doc.title}`, text: S.text, ended});
function scheduleFlush(delay) {
  const due = Date.now() + delay;
  if (BK.timer && BK.due <= due) return;
  clearTimeout(BK.timer); BK.due = due;
  BK.timer = setTimeout(() => { BK.timer = null; flushBackups(); }, delay);
}
let persistTimer = null;
const persistQueue = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => DB.put('kv', structuredClone(BK.queue), 'backupQueue').catch(() => {}), 1000); };
export function queueBackup(key, payload, delay) {
  if (!backupOn()) return;
  BK.queue[key] = payload;
  persistQueue();
  scheduleFlush(delay == null ? 90000 : delay);
  renderBackup();
}
export async function postBackup(payload) {
  let r;
  try {
    r = await fetch(S.settings.backupUrl, {method: 'POST', headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify(Object.assign({secret: S.settings.backupSecret}, payload))});
  } catch (e) {
    throw Object.assign(new Error(navigator.onLine ? "Couldn't reach the backup script. Check the web app URL, and that it is deployed with access for Anyone." : 'Waiting for signal'), {offline: !navigator.onLine});
  }
  let j = null;
  try { j = await r.json(); } catch (e) { throw new Error('The backup address did not answer like the Zephyr script. Check the web app URL.'); }
  if (!j.ok) throw new Error(j.error === 'Wrong secret' ? 'The backup secret does not match the one in the script.' : (j.error || 'Backup failed.'));
  return j;
}
export async function flushBackups() {
  if (!backupOn()) return false;
  if (BK.flushing) return BK.flushing;
  const keys = Object.keys(BK.queue);
  if (!keys.length) return true;
  if (!navigator.onLine) { BK.error = 'Waiting for signal'; renderBackup(); scheduleFlush(120000); return false; }
  BK.flushing = (async () => {
    let ok = true;
    for (const k of keys) {
      const p = BK.queue[k];
      try { await postBackup(p); if (BK.queue[k] === p) delete BK.queue[k]; BK.last = Date.now(); BK.error = ''; }
      catch (e) { ok = false; BK.error = e.message; break; }
    }
    DB.put('kv', structuredClone(BK.queue), 'backupQueue').catch(() => {});
    DB.put('kv', BK.last, 'backupLast').catch(() => {});
    if (!ok) scheduleFlush(120000);
    return ok;
  })();
  const result = await BK.flushing;
  BK.flushing = false; renderBackup();
  return result;
}
export async function backupNow() {
  if (!backupOn()) return say('Google Drive backup is not set up yet. Add it in Settings when you are parked.');
  if (S.session) BK.queue['s_' + S.session.id] = sessionPayload(false);
  BK.queue['d_' + S.doc.id] = docPayload(Object.assign({}, S.doc, {text: S.text}));
  const ok = await flushBackups();
  say(ok ? 'Backed up to Google Drive.' : "I couldn't reach Google Drive. I'll keep trying when you have signal.");
}
export function backupLine() {
  if (!backupOn()) return '';
  const waiting = Object.keys(BK.queue).length;
  if (BK.error) return `Drive: ${BK.error.toLowerCase().startsWith('waiting') ? 'waiting for signal' : 'problem, see Settings'}`;
  if (waiting && !BK.last) return 'Drive: pending';
  return BK.last ? `Drive: backed up ${fmtTime(BK.last)}` : 'Drive: ready';
}
export function renderBackup() {
  renderSession();
  const el = document.querySelector('#bkStatus'); if (!el) return;
  el.dataset.state = !backupOn() ? 'off' : BK.error ? 'error' : 'ok';
  if (!backupOn()) { el.textContent = 'Not set up.'; return; }
  const waiting = Object.keys(BK.queue).length;
  el.textContent = (BK.last ? `Last backup ${fmtDate(BK.last)} ${fmtTime(BK.last)}.` : 'No backups yet.') +
    (waiting ? ` ${waiting} waiting to send.` : '') + (BK.error ? ` ${BK.error}` : '');
}
export async function loadBackupState() {
  BK.queue = (await DB.get('kv', 'backupQueue')) || {};
  BK.last = (await DB.get('kv', 'backupLast')) || 0;
  renderBackup();
  if (Object.keys(BK.queue).length) scheduleFlush(3000);
}
window.addEventListener('online', () => flushBackups());
