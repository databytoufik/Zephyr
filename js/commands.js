// Routing what was heard: writing goes into the manuscript, anything after "Zephyr please" is a command.
import {S} from './state.js';
import {DB} from './db.js';
import {norm, num, paragraphs, sentences} from './util.js';
import {words} from './markup.js';
import {wakeMatch, afterWake, STOPRE} from './wake.js';
import {say, speak, beep, readAloud, stopSpeaking, isEcho} from './speech.js';
import {showZephyr, renderStatus} from './ui.js';
import {dictate, endSession, scratch, undo, redo, undoAll, createNew, rename, openDoc, setBlock, breakCmd, inlineCmd, unformat, takeUnsaved} from './doc.js';
import {backupNow} from './backup.js';
import {runEdit, answerEdit, runFeedback, runExplain, applyCmd} from './ai.js';

export const HELP = 'Everything you say goes into the manuscript. To give a command, start with Zephyr please. Pause, to stop writing for a while. Compose, to start again. Add to manuscript, to keep what you just said. If I ever mistake your words for a command, say Zephyr please, add that. Back up, to save to Google Drive. Scratch that. Read, or read last paragraph. Edit, then what to change. Feedback. Apply suggestion, and a number. Explain, then your question. Undo, or redo. Create new. Rename, then a name. Open, then a document name. Formatting help, for titles, headings, lists, bold, italic and underline. Word count. Repeat. Stop, to silence me. And end session, to save your draft.';
export const FORMAT_HELP = 'Formatting commands. Say Zephyr please, then: Title. Heading one, two, three or four. Normal text. Bulleted list. Numbered list. End list. New paragraph. New line. Bold, italic or underline, followed by that, last sentence, last word, or the words you want. Say bold on, then bold off, to format as you talk. Remove bold, or remove formatting, to undo it. You can add words right after a style, like: Zephyr please heading two, chapter one.';

/* ---------- waiting for a follow-up ---------- */
let awaitTimer = null;
export function setAwait(kind, ms) { S.awaiting = kind; clearTimeout(awaitTimer); awaitTimer = setTimeout(() => { S.awaiting = null; S.awaitCtx = null; renderStatus(); }, ms || 10000); renderStatus(); }
export function clearAwait() { S.awaiting = null; clearTimeout(awaitTimer); renderStatus(); }

/* ---------- the command table ---------- */
const KEEP = true;
// Rules marked strict are not accepted after a sound-alike wake word ("Sapphire, please, what…"), only after a clear "Zephyr please".
const titleKnown = name => { const q = norm(name).replace(/^(?:the|my)\s+/, ''); return S.docTitles.some(t => { t = norm(t); return t === q || (q.length > 2 && t.includes(q)); }); };
const COMMANDS = [
  {re: /^(?:end|finish|close|save and end)\s+(?:the\s+|my\s+|this\s+)?session\b/i, fn: () => endSession()},
  {re: /^(?:back ?up|backup|save to drive|sync)\b/i, fn: () => backupNow()},
  {re: /^(?:add|put|keep|save)\s+(?:that|it|this|what i (?:just )?said)?\s*(?:to|in|into|on)?\s*(?:the\s+)?(?:manuscript|document|draft)\b[\s,:]*(.*)$/i, fn: m => addToManuscript(m[1])},
  {re: /^(?:add|keep|save) (?:that|it|this)$/i, fn: () => addToManuscript('')},
  {re: /^(?:that was writing|that was my writing|that's writing)$/i, fn: () => addToManuscript('')},
  {re: /^(?:help|commands|list commands|what can (?:i|you) (?:say|do))$/i, fn: () => say(HELP)},
  {re: /^(?:formatting|format|style|styles)(?: help| commands)?$/i, fn: () => say(FORMAT_HELP)},
  {re: /^(?:new|next) (?:paragraph|para)$/i, fn: () => breakCmd('para'), keep: KEEP},
  {re: /^(?:new|next) (?:line|item|bullet|point)$/i, fn: () => breakCmd('line'), keep: KEEP},
  {re: /^(?:remove|take off|clear|undo|no more)\s+(?:the\s+)?(bold|italics?|underline|underlining|formatting)\b\s*(?:from|on|in)?\s*(.*)$/i, fn: m => unformat(m[1], m[2]), keep: KEEP},
  {re: /^(?:end|stop|turn off|no)\s+(bold|italics?|underline|underlining)$/i, fn: m => inlineCmd(m[1], '', true), keep: KEEP},
  {re: /^make (.+?) (bold|italics?|italic|underlined)$/i, fn: m => inlineCmd(m[2], /^(?:it|that|this)$/i.test(m[1]) ? 'that' : m[1], false), keep: KEEP},
  {re: /^(?:make (?:it |this |that )?(?:a |the )?)?title\b[\s,:]*(.*)$/i, fn: m => setBlock('title', 0, m[1]), keep: KEEP},
  {re: /^(?:make (?:it |this |that )?(?:a )?)?(?:heading|header|headline|subheading)(?:\s+(?:level\s+)?(one|two|three|four|won|to|too|for|1|2|3|4)\b)?[\s,:]*(.*)$/i, fn: m => setBlock('heading', Math.min(4, num(m[1]) || 1), m[2]), keep: KEEP},
  {re: /^(?:make (?:it |this |that )?)?(?:normal|plain|body|regular)(?: text| paragraph)?\b[\s,:]*(.*)$/i, fn: m => setBlock('normal', 0, m[1]), keep: KEEP},
  {re: /^(?:end|stop|exit|finish) (?:the )?(?:list|bullets|numbering)$/i, fn: () => setBlock('normal', 0, ''), keep: KEEP},
  {re: /^(?:make (?:it |this |that )?(?:a )?)?(?:numbered|number|numbering)(?: list)?\b[\s,:]*(.*)$/i, fn: m => setBlock('number', 0, m[1]), keep: KEEP},
  {re: /^(?:make (?:it |this |that )?(?:a )?)?(?:bulleted|bullet|bullets)(?: points?| list)?\b[\s,:]*(.*)$/i, fn: m => setBlock('bullet', 0, m[1]), keep: KEEP},
  {re: /^(?:turn on |start )?(bold|italics?|italicize|underline|underlined)\b[\s,:]*(.*)$/i, fn: m => inlineCmd(m[1], m[2], false), keep: KEEP},
  {re: /^(?:pause|stop composing|done composing|stop drafting|done drafting|stop writing|stop dictating|stop dictation)\b/i, fn: () => { S.mode = 'idle'; renderStatus(); say('Paused. Say Zephyr please, compose to continue.'); }},
  {re: STOPRE, fn: () => { stopSpeaking(); beep('down'); }},
  {re: /^(?:scratch that|delete that|strike that|scratch it)\b/i, fn: () => scratch()},
  {re: /^undo\s+(?:all|everything|every change)\b/i, fn: () => undoAll()},
  {re: /^undo\b/i, fn: () => undo()},
  {re: /^redo\b/i, fn: () => redo()},
  {re: /^(?:read|read back|read me|read it)\b\s*(.*)$/i, fn: m => readCmd(m[1])},
  {re: /^(?:repeat|say that again|what did you say|again)\b/i, fn: () => speak(S.lastSpoken || "I haven't said anything yet.")},
  {re: /^(?:word count|how long is it|how many words)\b/i, fn: () => say(`${words(S.text)} words.`)},
  {re: /^(?:apply|accept)\b\s*(?:the\s+)?(?:suggestions?|number)?\s*(.*)$/i, fn: m => applyCmd(m[1])},
  {re: /^(?:edit|revise|rewrite|change|fix|replace|cut|move|add|insert|delete|remove)\b/i, fn: (m, c) => runEdit(c.replace(/^(?:edit|revise)\b[\s,:]*/i, ''))},
  {re: /^(?:feedback|critique|give me (?:some )?feedback|suggest(?:ions| edits| changes)?|review(?: it| this| the draft)?)\b\s*(?:on|about|for)?\s*(.*)$/i, fn: m => runFeedback(m[1])},
  {re: /^(?:explain|teach me|help me understand)\b[\s,:]*(.*)$/i, fn: m => runExplain(m[1])},
  {re: /^(?:create|make|start)\s+(?:a\s+)?new\b\s*(.*)$/i, fn: m => createNew(/blank|empty|scratch|fresh/i.test(m[1]))},
  {re: /^(?:rename|re-name|call (?:it|this|the document)|name (?:it|this|the document))\b\s*(?:this|it|the document|the doc|this document)?\s*(?:to|as)?\s*(.*)$/i, fn: m => { if (m[1].trim()) return rename(m[1]); setAwait('title', 15000); return say('What should I call it?'); }},
  {re: /^(?:list|what are)\s+(?:my\s+|the\s+)?(?:documents|docs|drafts|files)\b/i, fn: () => listDocs()},
  {re: /^(?:open|switch to|go to|load)\s+(.+)$/i, fn: m => openByName(m[1]), strict: m => !titleKnown(m[1])},
  {re: /^(?:how|why|what|when|where|should|is|are|can|could|does|do|would|which)\b/i, fn: (m, c) => runExplain(c), strict: () => true},
  {re: /^(?:compose|composing|start composing|draft|drafting|dictate|dictation|write|start writing|start drafting|resume|continue|keep going)\b[\s,:]*(.*)$/i, keep: KEEP, fn: m => {
    S.mode = 'draft'; renderStatus();
    const said = takeUnsaved('');
    if (said) dictate(said);
    if (m[1].trim()) { beep('ok'); dictate(m[1]); } else say('Composing.');
  }}
];
const cleanCmd = raw => String(raw).trim().replace(/^[\s,.:;!?-]+/, '').replace(/[.!?]+$/, '').trim();
function findCommand(c, soft) {
  for (const rule of COMMANDS) {
    const m = c.match(rule.re);
    if (m) { if (soft && rule.strict && rule.strict(m)) return null; return {rule, m}; }
  }
  return null;
}
// Used by the wake matcher: is the rest of a sound-alike phrase a complete, known command?
export const isCommand = rest => !!findCommand(cleanCmd(rest), true);
const wakeOpts = () => ({lenient: S.settings.lenientWake !== false, isCommand});

// Remember words that might have been writing, so "Zephyr please add that" can bring them back.
function remember(text) { S.recover = {text: String(text).trim(), t: Date.now()}; }

export function addToManuscript(extra) {
  const parts = S.unsaved.slice();
  if (extra && extra.trim()) parts.push(extra.trim());
  S.unsaved = [];
  if (!parts.length && S.recover && Date.now() - S.recover.t < 180000) { parts.push(S.recover.text); }
  S.recover = null;
  if (!parts.length) return say('There is nothing new to add. Say it again, then say Zephyr please, add to manuscript.');
  dictate(parts.join(' '));
  beep('ok');
  showZephyr(`Added ${words(parts.join(' '))} words to the manuscript.`);
}
export function runCommand(raw, original) {
  const c = cleanCmd(raw);
  const hit = findCommand(c, false);
  if (hit) {
    if (!hit.rule.keep && !/^(?:add|put|keep|save|that was)\b/i.test(c)) S.unsaved = [];
    return hit.rule.fn(hit.m, c);
  }
  if (original) {
    // Not a command I know. Keep the words safe rather than writing "Zephyr please …" into the manuscript.
    remember(original);
    return say(`I didn't catch a command in, ${c}. If that was writing, say Zephyr please, add that. For the list of commands, say Zephyr please, help.`);
  }
  say(`I heard, ${c}. That isn't a command I know. Say Zephyr please, help.`);
}

export function handleFinal(raw, typed) {
  const t = String(raw).trim();
  if (!t) return;
  const now = Date.now();
  const m = wakeMatch(t, wakeOpts());
  if (!typed) {
    if (t === S.lastFinal && now - S.lastFinalAt < 2000) return;
    S.lastFinal = t; S.lastFinalAt = now;
    if (S.speaking) {
      if (m && STOPRE.test(afterWake(t, m))) { stopSpeaking(); beep('down'); return; }
      if (isEcho(t, {during: true})) return;          // Zephyr hearing itself
      if (m) stopSpeaking();                             // a real command interrupts the read-back
      else { S.unsaved.push(t); showZephyr('You spoke while I was talking, so I held that back. Say “Zephyr please add that” to put it in the manuscript.'); return; }
    // Echo arrives within about a second of Zephyr finishing; a real reply (often repeating Zephyr's words) comes later.
    } else if (isEcho(t, m || S.awaiting ? {fuzzy: false, window: 1200, minWords: 4} : {})) return;
  } else if (S.speaking) stopSpeaking();
  if (S.busy) {
    if (m && STOPRE.test(afterWake(t, m))) { S.abort && S.abort.abort(); return; }
    if (!m) S.heldWhileBusy.push(t);   // written in as soon as Claude's change lands
    else showZephyr('Still working on the last request. Say that again when I’m done, or say Zephyr please stop to cancel.');
    return;
  }
  if (S.awaiting && !m) {
    const k = S.awaiting; clearAwait();
    if (k === 'edit') return runEdit(t);
    if (k === 'edit-answer') return answerEdit(t);
    if (k === 'explain') return runExplain(t);
    if (k === 'title') return rename(t);
    return runCommand(t, t);
  }
  if (!m) {
    if (S.mode === 'draft') dictate(t);
    else { S.unsaved.push(t); showZephyr('Paused, so that wasn’t added. Say “Zephyr please compose” to keep writing, or “Zephyr please add to manuscript” to add it.'); }
    return;
  }
  const before = t.slice(0, m.index), after = afterWake(t, m);
  if (before.trim()) { if (S.mode === 'draft') dictate(before); else S.unsaved.push(before.trim()); }
  clearAwait();
  if (!after.trim()) { setAwait('command', 9000); beep('wake'); return; }
  if (m.soft) remember(t.slice(m.index));
  runCommand(after, t.slice(m.index));
}

/* ---------- reading ---------- */
export function readCmd(arg) {
  const a = norm(arg);
  if (!S.text.trim()) return say('The document is empty. Just start talking.');
  const paras = paragraphs(S.text);
  let m;
  if (/\btitle\b/.test(a)) return say(`The title is ${S.doc.title}.`);
  if (/last sentence/.test(a)) { const s = sentences(S.text); return readAloud(s[s.length - 1]); }
  if ((m = a.match(/last (\w+) (?:paragraphs|paras)/))) { const n = num(m[1]) || 2; return readAloud(paras.slice(-n).join('\n')); }
  if ((m = a.match(/last (\w+) sentences/))) { const n = num(m[1]) || 2; return readAloud(sentences(S.text).slice(-n).join(' ')); }
  if (/^last( paragraph| para| bit| part)?$/.test(a) || /last paragraph/.test(a)) return readAloud(paras[paras.length - 1]);
  if (/(?:first paragraph|opening|first para)/.test(a)) return readAloud(paras[0]);
  if ((m = a.match(/paragraph (\w+)/))) {
    const n = num(m[1]);
    if (!n || !paras[n - 1]) return say(`There ${paras.length === 1 ? 'is one paragraph' : 'are ' + paras.length + ' paragraphs'}.`);
    return readAloud(paras[n - 1]);
  }
  return readAloud(S.text);
}

/* ---------- documents by voice ---------- */
async function listDocs() {
  const docs = (await DB.all('docs')).sort((a, b) => b.updatedAt - a.updatedAt);
  const names = docs.slice(0, 8).map(d => d.title);
  say(`You have ${docs.length} document${docs.length === 1 ? '' : 's'}: ${names.join(', ')}. Say Zephyr please, open, and a name.`);
}
async function openByName(name) {
  const q = norm(name).replace(/^(?:the|my)\s+/, '').replace(/\s+(?:document|doc|draft|essay|story)$/, '');
  const docs = await DB.all('docs');
  let best = null, score = 0;
  for (const d of docs) {
    const t = norm(d.title);
    let s = t === q ? 100 : t.includes(q) ? 50 : 0;
    for (const w of q.split(' ')) if (w.length > 2 && t.includes(w)) s += 5;
    if (s > score) { score = s; best = d; }
  }
  if (!best) return say(`I couldn't find a document called ${name}. Say Zephyr please, list documents.`);
  if (S.doc && best.id === S.doc.id) return say(`You're already in ${best.title}.`);
  const had = !!S.session;
  await openDoc(best);
  say(`Opened ${best.title}. ${words(best.text)} words.${had ? ' Your previous draft was saved.' : ''}`);
}
