// Documents, sessions, autosave, undo, dictation and formatting.
import {S} from './state.js';
import {DB} from './db.js';
import {uid, WEEK, escRe, short, num, tag, titleCase, nextTitle} from './util.js';
import {plain, words, blockOf, LIST_ITEM, BLOCK_RE} from './markup.js';
import {formatDictation, applyDictation, lineBreak, capFirst, removeLastSentence} from './dictation.js';
import {callClaude, POLISH_SYS} from './claude.js';
import {say, beep, stopListening} from './speech.js';
import {showZephyr, render, renderDocs, renderArchive, renderStatus, renderSuggestions, flushTyping} from './ui.js';
import {queueBackup, docPayload, sessionPayload, backupOn, flushBackups} from './backup.js';

/* ---------- saving ---------- */
// Session saves are batched: at most one write every half second, and always on the way out (see ui.js).
let saveTimer = null, saveQ = Promise.resolve();
export function saveSession(now) {
  if (!S.session) return saveQ;
  clearTimeout(saveTimer);
  const write = () => { saveTimer = null; if (!S.session) return saveQ; const snap = structuredClone(S.session); saveQ = saveQ.then(() => DB.put('sessions', snap)).catch(() => {}); return saveQ; };
  if (now) return write();
  saveTimer = setTimeout(write, 500);
  return saveQ;
}
export const flushSave = () => saveTimer ? saveSession(true) : saveQ;
export function saveSettings() { DB.put('kv', structuredClone(S.settings), 'settings').catch(() => {}); }
export async function refreshTitles() { S.docTitles = (await DB.all('docs')).map(d => d.title); }

/* ---------- sessions & documents ---------- */
const MAX_VERSIONS = 150;
export function startSession() {
  S.session = {id: uid(), docId: S.doc.id, docTitle: S.doc.title, startedAt: Date.now(), endedAt: null,
    versions: [{t: Date.now(), label: 'Session start', text: S.text}]};
  S.undo = []; S.redo = [];
  saveSession(true);
  saveQ = saveQ.then(() => DB.put('kv', S.session.id, 'activeSession')).catch(() => {});
}
const COALESCE = new Set(['Dictation', 'Typed change']);
function autosave(label) {
  if (!S.session) return;
  const v = S.session.versions, last = v[v.length - 1], now = Date.now();
  if (last && label === 'Punctuation') { last.text = S.text; }
  else if (last && COALESCE.has(label) && last.label === label && now - last.t < 60000) { last.text = S.text; last.t = now; }
  else v.push({t: now, label, text: S.text});
  // keep the session start and the most recent versions so long sessions stay fast
  if (v.length > MAX_VERSIONS) v.splice(1, v.length - MAX_VERSIONS);
  saveSession();
  queueBackup('s_' + S.session.id, sessionPayload(false));
}
export function setText(next, label, opts = {}) {
  if (!opts.fromTextarea) flushTyping();
  if (next === S.text) return;
  if (!S.session) startSession();
  if (opts.undoable !== false) {
    const top = S.undo[S.undo.length - 1];
    if (opts.coalesce && top && top.label === label && Date.now() - top.t < 5000) top.t = Date.now();
    else S.undo.push({text: S.text, label, t: Date.now()});
    if (S.undo.length > 300) S.undo.shift();
    S.redo = [];
  }
  S.text = next;
  autosave(label);
  render(opts.fromTextarea);
}
export async function endSession({announce = true, stop = true} = {}) {
  flushTyping();
  if (!S.session) {
    if (announce) await say('There is no open session. Your saved draft is safe.');
    if (stop) stopListening();
    return;
  }
  S.doc.text = S.text; S.doc.updatedAt = Date.now();
  await DB.put('docs', S.doc);
  const n = S.session.versions.length;
  S.session.endedAt = Date.now(); S.session.docTitle = S.doc.title; S.session.finalWords = words(S.text);
  await saveSession(true);
  queueBackup('d_' + S.doc.id, docPayload(S.doc), 0);
  queueBackup('s_' + S.session.id, sessionPayload(true), 0);
  const backupDone = backupOn() ? flushBackups() : null;
  await DB.put('kv', null, 'activeSession');
  S.session = null; S.undo = []; S.redo = []; S.mode = 'draft';
  render(); renderDocs(); renderArchive();
  if (announce) await say(`Session ended. I saved ${words(S.text)} words to ${S.doc.title}. ${n} autosave${n === 1 ? '' : 's'} are archived for one week.`);
  if (backupDone) { const ok = await backupDone; if (announce) await say(ok ? 'Backed up to Google Drive.' : 'The Google Drive backup will finish once you have signal.'); }
  if (stop) stopListening();
}
export async function createDoc(title, text) {
  const d = {id: uid(), title, text: text || '', createdAt: Date.now(), updatedAt: Date.now()};
  await DB.put('docs', d);
  S.docTitles.push(title);
  queueBackup('d_' + d.id, docPayload(d), 5000);
  return d;
}
export async function openDoc(doc) {
  flushTyping();
  if (S.session && S.session.docId !== doc.id) await endSession({announce: false, stop: false});
  S.doc = doc; S.text = doc.text || ''; S.suggestions = []; S.lastChunk = null;
  DB.put('kv', doc.id, 'lastDoc').catch(() => {});
  renderSuggestions(); render(); renderDocs();
}
export async function createNew(blank) {
  flushTyping();
  const base = S.doc.title, text = S.text;
  await endSession({announce: false, stop: false});
  await refreshTitles();
  const d = await createDoc(blank ? nextTitle('Untitled draft', S.docTitles.concat('Untitled draft')) : nextTitle(base, S.docTitles), blank ? '' : text);
  await openDoc(d);
  say(blank ? `Saved ${base}. Started a blank document.`
            : `Saved ${base}, and made a new document from it called ${d.title}. You're working in the new one now.`);
}
export async function setTitle(name) {
  S.doc.title = name;
  await DB.put('docs', S.doc);
  await refreshTitles();
  queueBackup('d_' + S.doc.id, docPayload(S.doc), 5000);
  if (S.session) { S.session.docTitle = name; saveSession(); }
  render(); renderDocs();
}
export async function rename(name) {
  name = String(name).replace(/[.!?]+$/, '').trim();
  if (!name) return say('What should I call it?');
  name = titleCase(name);
  await setTitle(name);
  say(`Renamed to ${name}.`);
}
export async function purgeArchives() {
  const all = await DB.all('sessions');
  const now = Date.now();
  for (const s of all) if (s.endedAt && now - s.endedAt > WEEK) await DB.del('sessions', s.id);
}

/* ---------- undo / scratch ---------- */
export function undo() {
  flushTyping();
  const top = S.undo.pop();
  if (!top) return say('Nothing to undo this session.');
  S.redo.push({text: S.text, label: top.label});
  S.text = top.text; autosave('Undo'); render();
  say(`Undid ${top.label.toLowerCase()}.`);
}
export function redo() {
  flushTyping();
  const top = S.redo.pop();
  if (!top) return say('Nothing to redo.');
  S.undo.push({text: S.text, label: top.label, t: Date.now()});
  S.text = top.text; autosave('Redo'); render();
  say(`Redid ${top.label.toLowerCase()}.`);
}
export function undoAll() {
  if (!S.session) return say('Nothing to undo this session.');
  const start = S.session.versions[0].text;
  if (start === S.text) return say('The document already matches the start of this session.');
  setText(start, 'Undo all');
  say('Back to how the document was at the start of this session. Say Zephyr please, undo to bring the changes back.');
}
export function scratch() {
  flushTyping();
  if (S.lastChunk && S.text === S.lastChunk.after) {
    setText(S.lastChunk.before, 'Scratch that'); S.lastChunk = null; beep('down'); return;
  }
  if (!S.text.trim()) return say('Nothing to scratch.');
  setText(removeLastSentence(S.text), 'Scratch that');
  say('Removed the last sentence.');
}

/* ---------- dictation ---------- */
export const activeInline = () => (S.inline.b || S.inline.i || S.inline.u) ? S.inline : null;
export function dictate(raw) {
  flushTyping();
  const s = formatDictation(raw);
  if (!s.trim()) return;
  const before = S.text;
  const t = applyDictation(before, s, activeInline());
  if (t === before) return;
  setText(t, 'Dictation');
  S.lastChunk = {before, after: t};
  schedulePolish();
}

/* ---------- automatic punctuation (Claude) ---------- */
let polishTimer = null, polishing = false;
const letters = t => plain(t).toLowerCase().replace(/[^a-z0-9]/g, '');
const markup = t => String(t).replace(/[^*+#%\\\n]/g, '');
export function schedulePolish() {
  if (!S.settings.autoPunct || !S.settings.apiKey) return;
  clearTimeout(polishTimer);
  polishTimer = setTimeout(polishTail, 3500);
}
function tailStart(t) {
  const i = t.lastIndexOf('\n\n'), j = i > 0 ? t.lastIndexOf('\n\n', i - 1) : -1;
  let st = j >= 0 ? j + 2 : 0;
  if (t.length - st > 1500) { const k = t.indexOf('. ', t.length - 1200); st = k > 0 ? k + 2 : t.length - 1200; }
  return st;
}
async function polishTail() {
  if (polishing || S.busy || !navigator.onLine) { if (S.settings.autoPunct && navigator.onLine) schedulePolish(); return; }
  const text = S.text, st = tailStart(text), seg = text.slice(st);
  if (words(seg) < 3 || seg === S.lastPolished) return;
  polishing = true;
  try {
    const out = await callClaude(POLISH_SYS, `<text>${seg}</text>`, 2000, {model: 'claude-haiku-5-5', signal: null, effort: 'low'});
    let fixed = tag(out, 'text');
    if (fixed === null) return;
    fixed = seg.match(/^\s*/)[0] + fixed.trim() + seg.match(/\s*$/)[0];
    if (!/[.?!…]["”’)]?\s*$/.test(seg)) fixed = fixed.replace(/[.?!…]+(["”’)]?\s*)$/, '$1');
    if (letters(fixed) !== letters(seg) || markup(fixed) !== markup(seg)) return;
    if (fixed === seg || !S.text.startsWith(text) || S.busy) return;
    const next = text.slice(0, st) + fixed + S.text.slice(text.length);
    const chunk = S.lastChunk && S.lastChunk.after === S.text ? S.lastChunk : null;
    setText(next, 'Punctuation', {undoable: false});
    S.lastChunk = chunk && next.startsWith(chunk.before) ? {before: chunk.before, after: next} : null;
    S.lastPolished = fixed;
  } catch (e) { /* punctuation is a nicety; never interrupt the writer */ }
  finally { polishing = false; }
}
window.addEventListener('online', () => schedulePolish());

/* ---------- formatting ---------- */
const STYLE_NAMES = {title: 'Title', heading: 'Heading', normal: 'Normal text', bullet: 'Bulleted list', number: 'Numbered list'};
export function takeUnsaved(extra) {
  const parts = S.unsaved.slice();
  if (extra && extra.trim()) parts.push(extra.trim());
  S.unsaved = [];
  return parts.join(' ');
}
const numberAfter = line => { const b = blockOf(line); return (b.kind === 'number' ? b.level + 1 : 1) + '. '; };
export function setBlock(kind, level, extra) {
  flushTyping();
  const said = takeUnsaved(extra);
  const t = S.text.replace(/[ \t]+$/, '');
  const i = t.lastIndexOf('\n') + 1, line = t.slice(i);
  const prevLine = (() => { const p = t.slice(0, Math.max(0, i - 1)); return p.slice(p.lastIndexOf('\n') + 1); })();
  const content = blockOf(line).content;
  const inList = LIST_ITEM.test(line) && content.trim();
  const single = kind === 'title' || kind === 'heading';
  const markerFor = ref => kind === 'title' ? '% ' : kind === 'heading' ? '#'.repeat(level) + ' ' : kind === 'bullet' ? '- ' : kind === 'number' ? numberAfter(ref) : '';
  let next;
  if (said) {
    const body = capFirst(formatDictation(said).replace(/[]/g, ' ').replace(/\s+/g, ' ').trim());
    const listCont = inList && (kind === 'bullet' || kind === 'number');
    const base = content.trim() ? t + (listCont ? '\n' : '\n\n') : t.slice(0, i);
    next = base + markerFor(content.trim() ? line : prevLine) + body + (single ? '\n\n' : '');
  } else if (content.trim()) {
    // turning a line back into normal text: keep it from looking like a mark
    const keep = kind === 'normal' && BLOCK_RE.test(content) ? '\\' + content : content;
    next = t.slice(0, i) + markerFor(prevLine) + keep + (single ? '\n\n' : '');
  } else if (kind === 'normal') {
    next = t.slice(0, i).replace(/\n+$/, '');
    next = next ? next + '\n\n' : '';
  } else {
    next = t.slice(0, i) + markerFor(prevLine);
  }
  const name = kind === 'heading' ? `Heading ${level}` : STYLE_NAMES[kind];
  setText(next, name);
  S.lastChunk = null;
  beep('ok');
  showZephyr(said || content.trim() ? `${name}.` : `${name}. Your next words will use it.`);
}
export function breakCmd(kind) {
  const said = takeUnsaved('');
  if (said) dictate(said);
  const next = lineBreak(S.text, kind);
  if (next === S.text) return beep('down');
  setText(next, kind === 'para' ? 'New paragraph' : 'New line');
  S.lastChunk = null;
  beep('ok');
}
export const INLINE = {bold: ['b', '**', 'Bold'], italic: ['i', '*', 'Italic'], italics: ['i', '*', 'Italic'], italicize: ['i', '*', 'Italic'],
  underline: ['u', '++', 'Underline'], underlined: ['u', '++', 'Underline'], underlining: ['u', '++', 'Underline']};
function tidyRange(s, e) {
  const t = S.text;
  while (s < e && /[\s“"‘(]/.test(t[s])) s++;
  while (e > s && /[\s.,;:!?…"”’)]/.test(t[e - 1])) e--;
  const ls = t.lastIndexOf('\n', s - 1) + 1, b = blockOf(t.slice(ls, t.indexOf('\n', ls) < 0 ? t.length : t.indexOf('\n', ls)));
  if (b.marker && s < ls + b.marker.length) s = ls + b.marker.length;
  return e > s ? [s, e] : null;
}
export function findTarget(arg) {
  const t = S.text, a = String(arg || '').trim().replace(/[.!?]+$/, '');
  const L = a.toLowerCase().replace(/^the\s+/, '');
  let m;
  if (!L || /^(?:that|it|this|what i (?:just )?said|last bit)$/.test(L)) {
    if (S.lastChunk && S.lastChunk.after === t) return tidyRange(S.lastChunk.before.length, t.length);
    const body = t.replace(/\s+$/, ''); return tidyRange(removeLastSentence(body).length, body.length);
  }
  if (/^(?:last |this )?sentence$/.test(L)) { const body = t.replace(/\s+$/, ''); return tidyRange(removeLastSentence(body).length, body.length); }
  if ((m = L.match(/^last (?:(\w+) )?words?$/))) {
    const ms = [...t.matchAll(/\S+/g)]; if (!ms.length) return null;
    const n = m[1] ? num(m[1]) || 1 : 1, a0 = ms[Math.max(0, ms.length - n)], z = ms[ms.length - 1];
    return tidyRange(a0.index, z.index + z[0].length);
  }
  if (/^(?:last |this |current )?(?:paragraph|line|item|bullet)$/.test(L)) { const body = t.replace(/\s+$/, ''); return tidyRange(body.lastIndexOf('\n') + 1, body.length); }
  const phrase = a.replace(/^(?:the\s+)?(?:words?|phrase)\s+/i, '');
  const ws = phrase.match(/[A-Za-z0-9'’]+/g);
  if (!ws) return null;
  // whole words only, so "cold" does not hit "scold"
  const re = new RegExp('(?<![A-Za-z0-9])' + ws.map(w => escRe(w).replace(/['’]/g, "['’]")).join('[^A-Za-z0-9]+') + '(?![A-Za-z0-9])', 'gi');
  let last = null;
  for (const x of t.matchAll(re)) last = x;
  return last ? tidyRange(last.index, last.index + last[0].length) : null;
}
export function inlineCmd(word, arg, off) {
  const [k, mk, name] = INLINE[word.toLowerCase()];
  const a = String(arg || '').trim().replace(/[.!?]+$/, '');
  if (off || /^(?:off|stop|end|done|finished)$/i.test(a)) { S.inline[k] = false; renderStatus(); beep('down'); showZephyr(`${name} off.`); return; }
  if (!a || /^(?:on|start)$/i.test(a)) { S.inline[k] = true; renderStatus(); say(`${name} on. Say Zephyr please ${name.toLowerCase()} off when you're done.`); return; }
  flushTyping();
  const r = findTarget(a);
  if (!r) return say(`I couldn't find ${a} in the manuscript.`);
  const t = S.text, [s0, e0] = r;
  setText(t.slice(0, s0) + mk + t.slice(s0, e0) + mk + t.slice(e0), name);
  S.lastChunk = null; beep('ok');
  showZephyr(`${name}: “${short(plain(t.slice(s0, e0)))}”`);
}
const countMk = (str, mk) => (mk === '*' ? str.replace(/\*\*/g, '') : str).split(mk).length - 1;
const stripMk = (str, mk) => mk === '*' ? str.replace(/\*\*/g, '').replace(/\*/g, '').replace(//g, '**') : str.split(mk).join('');
export function unformat(word, arg) {
  flushTyping();
  const w = word.toLowerCase(), marks = w === 'formatting' ? ['**', '++', '*'] : [INLINE[w][1]];
  const r = findTarget(arg);
  if (!r) return say(`I couldn't find ${arg || 'that'} in the manuscript.`);
  const t = S.text, [s0, e0] = r;
  let before = t.slice(0, s0), mid = t.slice(s0, e0), after = t.slice(e0);
  const endsMk = (str, mk) => mk === '*' ? /(^|[^*])\*$/.test(str) : str.endsWith(mk);
  const startsMk = (str, mk) => mk === '*' ? /^\*(?!\*)/.test(str) : str.startsWith(mk);
  for (const mk of marks) {
    const inStart = countMk(before, mk) % 2 === 1, inEnd = countMk(before + mid, mk) % 2 === 1;
    mid = stripMk(mid, mk);
    if (inStart) { if (endsMk(before, mk)) before = before.slice(0, -mk.length); else mid = mk + mid; }
    if (inEnd) { if (startsMk(after, mk)) after = after.slice(mk.length); else mid = mid + mk; }
  }
  const next = before + mid + after;
  if (next === t) return say('That text has no formatting to remove.');
  setText(next, 'Remove formatting');
  S.lastChunk = null; beep('down');
}
