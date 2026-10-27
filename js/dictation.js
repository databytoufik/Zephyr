// Turning what the phone heard into manuscript text. Pure functions: they take the text so far and return new text.
import {escRe} from './util.js';
import {MARK_END, BARE_LIST, BLOCK_RE} from './markup.js';

export const PARA = '', LINE = '';
// Spoken punctuation is left as a word after "a", "the", "this"… ("a dash of salt", "the Victorian period", "a new line").
const DETERMINERS = new Set('a an the this that these those each every any no one same whole his her its their our my your another which what'.split(' '));
const literalAfterDeterminer = rep => (m, offset, str) => {
  const prev = (str.slice(0, offset).match(/([A-Za-z'’]+)[\s,]*$/) || [])[1];
  return prev && DETERMINERS.has(prev.toLowerCase()) ? m : rep;
};
const PUNCT = [
  [/\s*\b(?:new|next) paragraph\b[\s,.]*/gi, ' ' + PARA + ' ', true],
  [/\s*\b(?:new|next) line\b[\s,.]*/gi, ' ' + LINE + ' ', true],
  [/\s*\b(?:period|full stop)\b/gi, '.', true],
  [/\s*\bcomma\b/gi, ',', true],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bexclamation (?:point|mark)\b/gi, '!'],
  [/\s*\bsemicolon\b/gi, ';', true],
  [/\s*\bcolon\b/gi, ':', true],
  [/\s*\b(?:em dash|dash)\b\s*/gi, ' — ', true],
  [/\s*\b(?:ellipsis|dot dot dot)\b/gi, '…'],
  [/\bopen quote\b\s*/gi, '“'],
  [/\s*\b(?:close|end) quote\b/gi, '”']
];
export function formatDictation(raw) {
  let s = ' ' + raw + ' ';
  for (const [re, rep, guarded] of PUNCT) s = s.replace(re, guarded ? literalAfterDeterminer(rep) : rep);
  s = s.replace(/[ \t]+/g, ' ').replace(/ +([.,;:?!…”])/g, '$1').replace(/“ +/g, '“');
  s = s.replace(/([.?!…]["”’]?\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return s.trim();
}

export const sentenceStart = prev => !prev.trim() || /([.?!…]["”’)]?|\n)\s*$/.test(prev) || MARK_END.test(prev);
export const capFirst = s => s.replace(/^([“"(]*)([a-z])/, (m, a, b) => a + b.toUpperCase());

// Phones capitalise the first word of every phrase. Mid-sentence, a capitalised common word ("And", "Then") is
// lowered; anything else (likely a name: "Sarah", "Paris") is kept.
const COMMON = new Set(('a about above after again against all almost also although always am an and another any anyone anything are ' +
  'around as at away back be because been before being below between both but by came can could did do does doing done down during each ' +
  'either else even ever every everything few for from further get gets getting go goes going gone got had has have having he her here ' +
  'hers herself him himself his how however i if in into is it its itself just know last later least less let like little look made make ' +
  'many may maybe me might more most much must my myself never next no nobody none nor not nothing now of off often on once one only or ' +
  'other others our ours ourselves out over own perhaps please quite rather really right said same say says see seem she should since so ' +
  'some somehow someone something sometimes soon still such than that the their theirs them themselves then there these they thing ' +
  'things this those though through thus till to today together too toward towards under unless until up upon us very was we well were ' +
  'what whatever when whenever where whether which while who whoever whole whom whose why will with within without would yes yet you ' +
  'your yours yourself yourselves okay oh ah well anyway actually also besides finally first second third suddenly meanwhile instead ' +
  'otherwise therefore yesterday tomorrow tonight').split(' '));
export function keepCap(prev, w) {
  if (/^I(?:['’]|$)/.test(w)) return true;
  if (new RegExp('[a-z0-9,;:—]\\s+' + escRe(w) + '\\b').test(prev)) return true;
  return !COMMON.has(w.toLowerCase());
}

export function wrapInline(add, f) {
  const open = (f.b ? '**' : '') + (f.i ? '*' : '') + (f.u ? '++' : '');
  const close = (f.u ? '++' : '') + (f.i ? '*' : '') + (f.b ? '**' : '');
  const m = add.match(/^([\s\S]*?)([.,;:?!…”"]*)$/);
  return m[1] ? open + m[1] + close + m[2] : add;
}
export const mergeRuns = t => t.replace(/\+\+ \+\+/g, ' ').replace(/\*\*\* \*\*\*/g, ' ').replace(/\*\* \*\*/g, ' ').replace(/([^*])\* \*(?!\*)/g, '$1 ');

export function joinText(prev, add, wrap) {
  if (!add) return prev;
  const punctOnly = /^[.,;:?!…”]/.test(add);
  if (sentenceStart(prev)) add = capFirst(add);
  else if (!punctOnly) {
    const w = (add.match(/^[“"(]*([A-Za-z'’]+)/) || [])[1] || '';
    if (/^[A-Z][a-z'’]*$/.test(w) && !keepCap(prev, w)) add = add.replace(w, w[0].toLowerCase() + w.slice(1));
  }
  if (wrap && !punctOnly) add = wrapInline(add, wrap);
  const atLineStart = !prev.trim() || /\n[ \t]*$/.test(prev);
  // Dictated words that happen to look like a mark ("3. Then…") must stay words.
  if (atLineStart && BLOCK_RE.test(add)) add = '\\' + add;
  if (!prev.trim()) return add;
  if (punctOnly) return prev.replace(/[ \t]+$/, '') + add;
  return /\n$/.test(prev) || /[ \t]$/.test(prev) && MARK_END.test(prev) ? prev.replace(/[ \t]*$/, () => /\n$/.test(prev) ? '' : ' ') + add
       : prev.replace(/[ \t]+$/, '') + ' ' + add;
}

// New paragraph / new line. Inside a list it starts the next item; on an empty item it ends the list.
export function lineBreak(text, kind) {
  const t = text.replace(/[ \t]+$/, '');
  if (!t.trim()) return text;
  const line = t.slice(t.lastIndexOf('\n') + 1);
  let m;
  if (BARE_LIST.test(line)) return t.slice(0, t.length - line.length).replace(/\n+$/, '') + '\n\n';
  if ((m = line.match(/^([-*])[ \t]+\S/))) return t + '\n' + m[1] + ' ';
  if ((m = line.match(/^(\d{1,3})([.)])[ \t]+\S/))) return t + '\n' + (+m[1] + 1) + m[2] + ' ';
  if (/^(?:%|#{1,4})$/.test(line)) return t;
  return t + (kind === 'para' ? '\n\n' : '\n');
}

// Apply one dictated phrase (already formatted) to the text.
export function applyDictation(text, formatted, wrap) {
  let t = text;
  for (const piece of formatted.split(/([])/)) {
    if (piece === PARA) t = lineBreak(t, 'para');
    else if (piece === LINE) t = lineBreak(t, 'line');
    else if (piece.trim()) t = joinText(t, piece.trim(), wrap);
  }
  return wrap ? mergeRuns(t) : t;
}

export function removeLastSentence(t) {
  const trimmed = t.replace(/\s+$/, '');
  const body = trimmed.replace(/[.!?…]["”’)\]]*$/, '');
  const i = Math.max(body.lastIndexOf('. '), body.lastIndexOf('? '), body.lastIndexOf('! '), body.lastIndexOf('\n'));
  if (i < 0) return '';
  return trimmed.slice(0, i + 1).replace(/\s+$/, '');
}
