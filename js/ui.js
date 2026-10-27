// Everything on screen: rendering, the tabs, typing, settings, themes, export and import.
import {S} from './state.js';
import {DB} from './db.js';
import {esc, fmtTime, fmtDate, WEEK, uid} from './util.js';
import {renderDocHTML, words, exportText, exportMarkdown} from './markup.js';
import {PALETTES, paletteById} from './palettes.js';
import {testKey} from './claude.js';
import {say, stopSpeaking, startListening, stopListening, loadVoices, restartRec} from './speech.js';
import {setText, endSession, createNew, createDoc, openDoc, setTitle, saveSettings, flushSave, refreshTitles} from './doc.js';
import {wakeMatch} from './wake.js';
import {handleFinal, runCommand, isCommand} from './commands.js';
import {BK, backupOn, backupLine, renderBackup, postBackup, backupNow, flushBackups} from './backup.js';

export const $ = s => document.querySelector(s);
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/* ---------- status ---------- */
export function showZephyr(t) { $('#zephyrSaid').textContent = t; }
function statusOf() {
  if (S.busy) return ['thinking', 'Thinking'];
  if (S.speaking) return ['speaking', 'Speaking'];
  if (!S.listening) return ['off', 'Not listening'];
  if (S.awaiting) return ['await', S.awaiting === 'command' ? 'Yes? Say a command' : S.awaiting === 'edit-answer' ? 'Go ahead, answer' : 'Go ahead'];
  const on = ['b', 'i', 'u'].filter(k => S.inline[k]).map(k => ({b: 'bold', i: 'italic', u: 'underline'}[k]));
  const extra = on.length ? ' · ' + on.join(', ') : '';
  if (S.mode === 'draft') return ['draft', (S.heard ? 'Writing…' : 'Composing') + extra];
  if (S.mode === 'idle') return ['await', 'Paused · say Zephyr please compose' + extra];
  return ['listen', 'Listening for “Zephyr”' + extra];
}
export function renderStatus() {
  const [st, label] = statusOf();
  const pill = $('#pill'); pill.dataset.state = st; pill.textContent = label;
  const mic = $('#mic');
  mic.setAttribute('aria-pressed', String(S.listening));
  mic.dataset.state = S.listening && S.mode === 'draft' ? 'draft' : '';
  $('#micLabel').textContent = S.listening ? (S.mode === 'draft' ? 'Composing · tap to stop' : 'Paused · tap to stop') : 'Start listening';
}
export function renderSession() {
  const el = $('#sessionInfo');
  const bk = backupLine();
  $('#settingsDot').hidden = !(backupOn() && BK.error && !/^waiting/i.test(BK.error));
  renderSettingsState();
  if (!S.session) { el.textContent = 'No session open' + (bk ? ' · ' + bk : ''); return; }
  const n = S.session.versions.length;
  el.textContent = `Session since ${fmtTime(S.session.startedAt)} · ${n} autosave${n === 1 ? '' : 's'}` + (bk ? ' · ' + bk : '');
}

/* ---------- manuscript ---------- */
export function render(fromTextarea) {
  $('#docTitle').textContent = S.doc ? S.doc.title : '';
  $('#wc').textContent = `${words(S.text)} words`;
  if (!fromTextarea) setTextarea(S.text);
  $('#docView').innerHTML = S.text.trim() ? renderDocHTML(S.text) : '<p class="pending">Tap Start listening and talk. Everything you say lands here.</p>';
  if (document.activeElement !== $('#titleInput')) $('#titleInput').value = S.doc ? S.doc.title : '';
  renderStatus(); renderSession();
}
// Update the text box without throwing away the writer's place in it.
function setTextarea(text) {
  const ta = $('#docText');
  if (ta.value === text) return;
  const focused = document.activeElement === ta, pos = ta.selectionStart, old = ta.value;
  ta.value = text;
  if (focused) { const keep = text.startsWith(old.slice(0, pos)) ? pos : text.length; ta.setSelectionRange(keep, keep); }
}
let typeTimer = null;
// Commit whatever is typed but not yet saved. Called before any other change so typing is never overwritten.
export function flushTyping() {
  if (!typeTimer) return;
  clearTimeout(typeTimer); typeTimer = null;
  setText($('#docText').value, 'Typed change', {coalesce: true, fromTextarea: true});
}
export function renderSuggestions() {
  const box = $('#sugg');
  box.hidden = !S.suggestions.length;
  $('#suggList').innerHTML = S.suggestions.map(s => `<li>${esc(s.say.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}</li>`).join('');
}
function setView(raw) {
  if (!raw) flushTyping();
  $('#viewFormatted').setAttribute('aria-pressed', String(!raw));
  $('#viewRaw').setAttribute('aria-pressed', String(raw));
  $('#docView').hidden = raw; $('#docText').hidden = !raw; $('#markHint').hidden = !raw;
  if (!raw) render();
}

/* ---------- documents and archive ---------- */
let confirmDel = null;
export async function renderDocs() {
  const docs = (await DB.all('docs')).sort((a, b) => b.updatedAt - a.updatedAt);
  S.docTitles = docs.map(d => d.title);
  $('#docList').innerHTML = docs.map(d => {
    const cur = S.doc && d.id === S.doc.id;
    return `<li><div class="meta"><div class="t">${esc(d.title)}${cur ? '<span class="current-tag">Open</span>' : ''}</div>
      <div class="s">${words(d.text)} words saved · ${fmtDate(d.updatedAt)} ${fmtTime(d.updatedAt)}</div></div>
      <div class="row">${cur ? '' : `<button class="btn small" data-open="${esc(d.id)}" type="button">Open</button>
      <button class="btn small danger" data-del="${esc(d.id)}" type="button">${confirmDel === d.id ? 'Tap again to delete' : 'Delete'}</button>`}</div></li>`;
  }).join('');
}
let archiveCache = [];
export async function renderArchive() {
  const all = await DB.all('sessions');
  archiveCache = all.sort((a, b) => (b.endedAt || Infinity) - (a.endedAt || Infinity) || b.startedAt - a.startedAt);
  if (!archiveCache.length) { $('#archiveList').innerHTML = '<p class="note">No sessions yet.</p>'; return; }
  $('#archiveList').innerHTML = archiveCache.map(s => {
    const live = !s.endedAt;
    const days = live ? null : Math.max(0, Math.ceil((s.endedAt + WEEK - Date.now()) / 86400000));
    return `<details class="sess" data-sid="${esc(s.id)}"><summary>
        <span><strong>${esc(s.docTitle)}</strong> · ${fmtDate(s.startedAt)} ${fmtTime(s.startedAt)}${live ? ' <span class="current-tag">In progress</span>' : ''}</span>
        <span class="expires">${s.versions.length} autosaves${live ? '' : ` · deleted in ${days} day${days === 1 ? '' : 's'}`}</span>
      </summary>
      ${s.versions.map((v, i) => `<details class="ver" data-vi="${i}"><summary>${fmtTime(v.t)} · ${esc(v.label)} · ${words(v.text)} words</summary><div class="vbody"></div></details>`).join('')}
    </details>`;
  }).join('');
}

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(text, action, onAction) {
  const el = $('#toast'), btn = $('#toastAction');
  $('#toastText').textContent = text;
  btn.hidden = !action; btn.textContent = action || '';
  btn.onclick = () => { el.hidden = true; onAction && onAction(); };
  el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3000);
}

/* ---------- copy and download ---------- */
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch (e) { const ta = $('#docText'); setView(true); ta.focus(); ta.select(); btn.textContent = 'Selected, copy it'; }
  setTimeout(() => { btn.textContent = btn.dataset.label || 'Copy text'; }, 1800);
}
function download(name, text, type) {
  const blob = new Blob([text], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileBase = () => (S.doc.title || 'draft').replace(/[^\w\- ]+/g, '').trim() || 'draft';

/* ---------- appearance ---------- */
const effectiveMode = () => S.settings.appearance === 'light' || S.settings.appearance === 'dark' ? S.settings.appearance
  : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
export function applyLook() {
  const r = document.documentElement, st = S.settings;
  r.setAttribute('data-palette', paletteById(st.palette).id);
  if (st.appearance === 'light' || st.appearance === 'dark') r.setAttribute('data-theme', st.appearance); else r.removeAttribute('data-theme');
  if (st.textSize && st.textSize !== 'normal') r.setAttribute('data-size', st.textSize); else r.removeAttribute('data-size');
  lsSet('zephyr-look', JSON.stringify({palette: st.palette, appearance: st.appearance, textSize: st.textSize}));
  const bg = paletteById(st.palette)[effectiveMode()].bg;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
  renderSwatches();
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === (st.appearance || 'auto'))));
  document.querySelectorAll('#sizeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === (st.textSize || 'normal'))));
}
function renderSwatches() {
  const mode = effectiveMode(), cur = paletteById(S.settings.palette).id;
  $('#swatches').innerHTML = PALETTES.map(p => `<button type="button" class="swatch" role="radio" aria-checked="${p.id === cur}" tabindex="${p.id === cur ? 0 : -1}" data-palette="${p.id}">
      <span class="preview"><i data-c="accent"></i><i data-c="listen"></i><i data-c="speak"></i><i class="bar" data-c="panel"></i></span>
      <span class="name">${esc(p.name)}</span></button>`).join('');
  // colours are set through the style object (the page's security policy does not allow inline style attributes)
  document.querySelectorAll('#swatches .swatch').forEach(b => {
    const t = paletteById(b.dataset.palette)[mode];
    b.querySelector('.preview').style.background = t.bg;
    b.querySelectorAll('[data-c]').forEach(i => { i.style.background = t[i.dataset.c]; });
    b.querySelector('.bar').style.border = `1px solid ${t.line}`;
  });
}

/* ---------- settings ---------- */
function renderSettingsState() {
  const k = $('#stClaude'); if (!k) return;
  k.textContent = S.settings.apiKey ? 'Key added' : 'Not set up'; k.dataset.ok = String(!!S.settings.apiKey);
  const b = $('#stBackup');
  b.textContent = !backupOn() ? 'Off' : BK.error && !/^waiting/i.test(BK.error) ? 'Problem' : 'On';
  b.dataset.ok = !backupOn() ? '' : String(!(BK.error && !/^waiting/i.test(BK.error)));
  if (!backupOn()) delete b.dataset.ok;
}
function renderSetupNotice() {
  const later = +(lsGet('zephyr-setup-later') || 0);
  const show = !S.settings.apiKey && Date.now() - later > WEEK;
  $('#setupNotice').hidden = !show;
  if (show) $('#setupText').textContent = 'Dictation and read-back work now. Add your Claude API key to turn on edit, feedback, explain and automatic punctuation.';
}
export function goToSettings(sectionId, focusSel) {
  document.querySelector('.tabs button[data-view="v-settings"]').click();
  const sec = $('#' + sectionId); if (sec) { sec.open = true; sec.scrollIntoView({block: 'start'}); }
  if (focusSel) setTimeout(() => $(focusSel).focus(), 50);
}
async function renderStorage() {
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#storageNote').textContent = persisted
    ? 'Your documents are stored on this device, and the browser has agreed to keep them.'
    : 'Your documents are stored in this browser on this device. Export a copy now and then, or set up Drive backup.';
  const note = $('#installNote');
  note.hidden = standalone || !ios;
  if (!note.hidden) note.textContent = 'On iPhone, tap Share › Add to Home Screen. Safari can clear data for websites you haven’t opened in a week; Home Screen apps keep theirs.';
  const st = $('#stData');
  st.textContent = persisted || standalone ? 'Kept on this device' : 'In this browser';
  if (persisted || standalone) st.dataset.ok = 'true'; else delete st.dataset.ok;
}
function bindSettings() {
  const st = S.settings;
  $('#apiKey').value = st.apiKey; $('#model').value = st.model; $('#lang').value = st.lang;
  $('#rate').value = st.rate; $('#rateVal').textContent = (+st.rate).toFixed(2).replace(/0$/, ''); $('#lwt').checked = st.listenWhileTalking;
  $('#autoPunct').checked = st.autoPunct !== false;
  $('#lenientWake').checked = st.lenientWake !== false;
  $('#bkUrl').value = st.backupUrl; $('#bkSecret').value = st.backupSecret;
  const keyChanged = e => { st.apiKey = e.target.value.trim(); saveSettings(); renderSettingsState(); renderSetupNotice(); $('#keyStatus').textContent = ''; delete $('#keyStatus').dataset.state; };
  $('#apiKey').addEventListener('change', keyChanged);
  $('#apiKey').addEventListener('paste', () => setTimeout(() => keyChanged({target: $('#apiKey')}), 0));
  $('#btnTestKey').addEventListener('click', async e => {
    const b = e.currentTarget, el = $('#keyStatus');
    keyChanged({target: $('#apiKey')});
    if (!st.apiKey) { el.textContent = 'Paste your key first.'; el.dataset.state = 'error'; return; }
    b.disabled = true; el.textContent = 'Checking…'; delete el.dataset.state;
    try { await testKey(); el.textContent = 'Your key works. Edit, feedback and explain are ready.'; el.dataset.state = 'ok'; }
    catch (x) { el.textContent = x.message; el.dataset.state = 'error'; }
    b.disabled = false;
  });
  $('#model').addEventListener('change', e => { st.model = e.target.value; saveSettings(); });
  $('#lang').addEventListener('change', e => { st.lang = e.target.value; saveSettings(); restartRec(); });
  $('#voice').addEventListener('change', e => { st.voice = e.target.value; saveSettings(); });
  $('#rate').addEventListener('input', e => { st.rate = +e.target.value; $('#rateVal').textContent = st.rate.toFixed(2).replace(/0$/, ''); saveSettings(); });
  $('#lwt').addEventListener('change', e => { st.listenWhileTalking = e.target.checked; saveSettings(); });
  $('#autoPunct').addEventListener('change', e => { st.autoPunct = e.target.checked; saveSettings(); });
  $('#lenientWake').addEventListener('change', e => { st.lenientWake = e.target.checked; saveSettings(); });
  const bkChanged = () => { st.backupUrl = $('#bkUrl').value.trim(); st.backupSecret = $('#bkSecret').value.trim(); saveSettings(); BK.error = ''; renderBackup(); };
  $('#bkUrl').addEventListener('change', bkChanged);
  $('#bkSecret').addEventListener('change', bkChanged);
  $('#btnBkTest').addEventListener('click', async e => {
    bkChanged();
    const b = e.currentTarget, el = $('#bkStatus');
    if (!backupOn()) { el.textContent = 'Fill in both the URL and the secret first.'; el.dataset.state = 'error'; return; }
    if (!/^https:\/\/script\.google(?:usercontent)?\.com\//.test(st.backupUrl)) { el.textContent = 'That doesn’t look like an Apps Script web app URL. It should start with https://script.google.com/macros/s/'; el.dataset.state = 'error'; return; }
    b.disabled = true; el.textContent = 'Testing…'; delete el.dataset.state;
    try { await postBackup({action: 'ping'}); el.textContent = 'Connected. Zephyr can save to your Google Drive.'; el.dataset.state = 'ok'; BK.error = ''; renderSession(); }
    catch (x) { el.textContent = x.message; el.dataset.state = 'error'; }
    b.disabled = false;
  });
  $('#btnBkNow').addEventListener('click', () => { bkChanged(); backupNow(); });
  $('#btnCopyScript').addEventListener('click', async e => {
    const b = e.currentTarget;
    try { const code = await (await fetch('apps-script/Code.gs')).text(); await copyText(code, b); }
    catch (x) { b.textContent = 'Couldn’t load it'; setTimeout(() => { b.textContent = b.dataset.label; }, 1800); }
  });
  $('#btnTestVoice').addEventListener('click', () => say('Hello. I am Zephyr. Say Zephyr please, compose when you are ready to write.'));
  // appearance
  $('#swatches').addEventListener('click', e => { const b = e.target.closest('[data-palette]'); if (!b) return; st.palette = b.dataset.palette; saveSettings(); applyLook(); $(`#swatches [data-palette="${st.palette}"]`).focus(); });
  $('#swatches').addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = PALETTES.findIndex(p => p.id === paletteById(st.palette).id), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    st.palette = PALETTES[(i + d + PALETTES.length) % PALETTES.length].id; saveSettings(); applyLook(); $(`#swatches [data-palette="${st.palette}"]`).focus();
  });
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; st.appearance = b.dataset.mode; saveSettings(); applyLook(); });
  $('#sizeSeg').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (!b) return; st.textSize = b.dataset.size; saveSettings(); applyLook(); });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyLook());
  // data
  $('#btnExport').addEventListener('click', exportAll);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importAll(f); });
}

/* ---------- export / import ---------- */
async function exportAll() {
  flushTyping();
  const docs = await DB.all('docs');
  // the open document's latest words, even mid-session
  const live = docs.map(d => S.doc && d.id === S.doc.id ? Object.assign({}, d, {text: S.text}) : d);
  const st = Object.assign({}, S.settings); delete st.apiKey; delete st.backupSecret;
  const data = {app: 'zephyr', version: 1, exportedAt: new Date().toISOString(), docs: live, settings: st};
  const d = new Date(), name = `zephyr-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  download(name, JSON.stringify(data, null, 2), 'application/json');
  lsSet('zephyr-last-export', String(Date.now()));
  $('#dataStatus').textContent = `Exported ${live.length} document${live.length === 1 ? '' : 's'}. Keep the file somewhere safe; it does not include your API key or backup secret.`;
  $('#dataStatus').dataset.state = 'ok';
}
async function importAll(file) {
  const el = $('#dataStatus');
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { el.textContent = 'That file isn’t a Zephyr export.'; el.dataset.state = 'error'; return; }
  if (!data || data.app !== 'zephyr' || !Array.isArray(data.docs)) { el.textContent = 'That file isn’t a Zephyr export.'; el.dataset.state = 'error'; return; }
  const existing = new Map((await DB.all('docs')).map(d => [d.id, d]));
  let added = 0, updated = 0, kept = 0;
  for (const raw of data.docs) {
    if (!raw || typeof raw.text !== 'string') continue;
    const d = {id: String(raw.id || uid()), title: String(raw.title || 'Imported draft'), text: raw.text, createdAt: +raw.createdAt || Date.now(), updatedAt: +raw.updatedAt || Date.now()};
    const cur = existing.get(d.id);
    if (S.doc && d.id === S.doc.id && S.session) { if (d.text !== S.text) { d.id = uid(); d.title += ' (imported)'; await DB.put('docs', d); added++; } else kept++; continue; }
    if (!cur) { await DB.put('docs', d); added++; }
    else if (d.updatedAt > cur.updatedAt && d.text !== cur.text) { await DB.put('docs', d); updated++; }
    else kept++;
  }
  if (data.settings && typeof data.settings === 'object') {
    for (const k of ['palette', 'appearance', 'textSize']) if (data.settings[k]) S.settings[k] = data.settings[k];
    saveSettings(); applyLook();
  }
  await refreshTitles(); renderDocs();
  if (S.doc && !S.session) { const d = await DB.get('docs', S.doc.id); if (d) { S.doc = d; S.text = d.text; render(); } }
  el.textContent = `Imported: ${added} new, ${updated} updated, ${kept} already up to date.`; el.dataset.state = 'ok';
}

/* ---------- wiring ---------- */
export function initUI() {
  bindSettings();
  applyLook();
  renderSetupNotice();
  renderStorage();
  if ('speechSynthesis' in window) {
    const fill = vs => { const sel = $('#voice'), cur = S.settings.voice; sel.innerHTML = '<option value="">Phone default</option>' + vs.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join(''); sel.value = cur; };
    loadVoices(fill); speechSynthesis.onvoiceschanged = () => loadVoices(fill);
  }
  $('#setupGo').addEventListener('click', () => goToSettings('setClaude', '#apiKey'));
  $('#setupLater').addEventListener('click', () => { lsSet('zephyr-setup-later', String(Date.now())); renderSetupNotice(); });
  $('#mic').addEventListener('click', () => { if (S.listening) { stopListening(); stopSpeaking(); showZephyr('Stopped listening.'); } else startListening(); });
  $('#typeCmd').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#cmdInput').value.trim(); if (!v) return;
    $('#cmdInput').value = '';
    if (wakeMatch(v, {lenient: S.settings.lenientWake !== false, isCommand})) handleFinal(v, true); else { stopSpeaking(); runCommand(v); }
  });
  $('#viewFormatted').addEventListener('click', () => setView(false));
  $('#viewRaw').addEventListener('click', () => setView(true));
  $('#docText').addEventListener('input', () => {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => { typeTimer = null; setText($('#docText').value, 'Typed change', {coalesce: true, fromTextarea: true}); }, 900);
  });
  $('#docText').addEventListener('blur', flushTyping);
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    flushTyping();
    document.querySelectorAll('.tabs button').forEach(x => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'page');
    document.querySelectorAll('main > .view').forEach(v => { v.hidden = v.id !== b.dataset.view; });
    if (b.dataset.view === 'v-docs') renderDocs();
    if (b.dataset.view === 'v-archive') renderArchive();
    if (b.dataset.view === 'v-settings') { renderStorage(); if (!S.settings.apiKey) $('#setClaude').open = true; }
    window.scrollTo(0, 0);
  }));
  $('#titleInput').addEventListener('change', async e => { const v = e.target.value.trim(); if (v && v !== S.doc.title) await setTitle(v); });
  $('#btnEnd').addEventListener('click', () => endSession({announce: true, stop: true}));
  $('#btnFromCurrent').addEventListener('click', () => createNew(false));
  $('#btnBlank').addEventListener('click', () => createNew(true));
  $('#btnCopy').addEventListener('click', e => { flushTyping(); copyText(exportText(S.text), e.currentTarget); });
  $('#btnCopyFmt').addEventListener('click', async e => {
    flushTyping();
    const b = e.currentTarget, html = renderDocHTML(S.text).replace(/<span class="pending">[^<]*<\/span>/g, '');
    try {
      await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}), 'text/plain': new Blob([exportText(S.text)], {type: 'text/plain'})})]);
      b.textContent = 'Copied';
    } catch (x) { return copyText(exportText(S.text), b); }
    setTimeout(() => { b.textContent = b.dataset.label; }, 1800);
  });
  $('#btnTxt').addEventListener('click', () => { flushTyping(); download(fileBase() + '.txt', exportText(S.text), 'text/plain'); });
  $('#btnMd').addEventListener('click', () => { flushTyping(); download(fileBase() + '.md', exportMarkdown(S.text), 'text/markdown'); });
  $('#docList').addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
    if (o) { const doc = await DB.get('docs', o.dataset.open); if (doc) { await openDoc(doc); showZephyr(`Opened ${doc.title}.`); } }
    if (d) {
      const id = d.dataset.del;
      if (confirmDel === id) {
        const gone = await DB.get('docs', id);
        await DB.del('docs', id); confirmDel = null;
        if (gone) toast(`Deleted ${gone.title}.`, 'Undo', async () => { await DB.put('docs', gone); await refreshTitles(); renderDocs(); });
        await refreshTitles();
      } else { confirmDel = id; setTimeout(() => { if (confirmDel === id) { confirmDel = null; renderDocs(); } }, 4000); }
      renderDocs();
    }
  });
  $('#archiveList').addEventListener('toggle', e => {
    const ver = e.target.closest && e.target.closest('details.ver');
    if (!ver || !ver.open) return;
    const body = ver.querySelector('.vbody'); if (body.childElementCount) return;
    const s = archiveCache.find(x => x.id === ver.closest('details.sess').dataset.sid);
    const v = s && s.versions[+ver.dataset.vi]; if (!v) return;
    body.innerHTML = `<pre></pre><div class="row"><button class="btn small" data-act="copy" type="button" data-label="Copy">Copy</button><button class="btn small" data-act="restore" type="button">Open as new document</button></div>`;
    body.querySelector('pre').textContent = v.text;
  }, true);
  $('#archiveList').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const ver = b.closest('details.ver'), s = archiveCache.find(x => x.id === ver.closest('details.sess').dataset.sid);
    const v = s.versions[+ver.dataset.vi];
    if (b.dataset.act === 'copy') return copyText(v.text, b);
    const d = await createDoc(`${s.docTitle} (restored ${fmtTime(v.t)})`, v.text);
    await openDoc(d);
    document.querySelector('.tabs button[data-view="v-write"]').click();
    showZephyr(`Restored that version as ${d.title}.`);
  });
  // Save everything when the page is hidden or closed (phones may kill a background tab without warning).
  const flushAll = () => { flushTyping(); flushSave(); if (backupOn() && Object.keys(BK.queue).length) flushBackups(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
}
