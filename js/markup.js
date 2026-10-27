// The manuscript is plain text with light marks:
//   "% " title, "# " to "#### " headings, "- " bullet, "1. " numbered item (1-3 digits),
//   **bold**, *italic*, ++underline++. A leading "\" keeps a line from being read as a mark.
// Inline marks only count when they pair up and hug words, so "C++", "5 * 3" and "a*b" stay literal.
import {esc} from './util.js';

export const BLOCK_RE = /^(%|#{1,4}|[-*]|\d{1,3}[.)])(?:[ \t]+|$)/;
// The text ends with a bare block mark (cursor sits right after "- ", "# " and so on).
export const MARK_END = /(?:^|\n)(?:%|#{1,4}|[-*]|\d{1,3}[.)])[ \t]*$/;
// A bare list mark on its own line ("-", "1.").
export const BARE_LIST = /^(?:[-*]|\d{1,3}[.)])$/;
export const LIST_ITEM = /^(?:[-*]|\d{1,3}[.)])[ \t]/;

// Parse one line into {kind, level, marker, content}. kind: title | heading | bullet | number | para.
export function blockOf(line) {
  const raw = String(line);
  if (raw.startsWith('\\') && BLOCK_RE.test(raw.slice(1))) return {kind: 'para', level: 0, marker: '\\', content: raw.slice(1)};
  const m = raw.match(BLOCK_RE);
  if (!m) return {kind: 'para', level: 0, marker: '', content: raw};
  const mk = m[1], content = raw.slice(m[0].length);
  if (mk === '%') return {kind: 'title', level: 0, marker: m[0], content};
  if (mk[0] === '#') return {kind: 'heading', level: mk.length, marker: m[0], content};
  if (mk === '-' || mk === '*') {
    // "*" alone at line start followed by text could be an italic opener ("*word* ..."): only a bullet when followed by space.
    if (mk === '*' && !/^\*[ \t]/.test(raw)) return {kind: 'para', level: 0, marker: '', content: raw};
    return {kind: 'bullet', level: 0, marker: m[0], content};
  }
  return {kind: 'number', level: +mk.slice(0, -1), marker: m[0], content};
}
export const stripBlock = line => blockOf(line).content;

const MARK_CH = /[*+]/;
const OPEN_BEFORE = /[\s“"‘'(\[—–-]/;
const CLOSE_AFTER = /[\s.,;:!?…”"’')\]—–-]/;

// Find inline delimiters that actually pair up. Returns tokens: {t:'text', s} | {t:'open'|'close', k:'b'|'i'|'u'}.
export function parseInline(s) {
  s = String(s);
  const delims = [];
  for (let k = 0; k < s.length;) {
    if (!MARK_CH.test(s[k])) { k++; continue; }
    let rs = k, re = k; while (re < s.length && MARK_CH.test(s[re])) re++;
    const prev = rs > 0 ? s[rs - 1] : '', next = re < s.length ? s[re] : '';
    const canOpen = !!next && !/\s/.test(next) && (!prev || OPEN_BEFORE.test(prev));
    const canClose = !!prev && !/\s/.test(prev) && (!next || CLOSE_AFTER.test(next));
    // Split the run into ** / ++ / * pieces. A closing run is split from the right so "***" closes as "*" then "**"
    // and the tags nest properly.
    const pieces = [];
    if (canClose && !canOpen) {
      for (let p = re; p > rs;) {
        if (p - 2 >= rs && s.startsWith('**', p - 2)) { pieces.unshift({pos: p - 2, len: 2, k: 'b'}); p -= 2; }
        else if (p - 2 >= rs && s.startsWith('++', p - 2)) { pieces.unshift({pos: p - 2, len: 2, k: 'u'}); p -= 2; }
        else if (s[p - 1] === '*') { pieces.unshift({pos: p - 1, len: 1, k: 'i'}); p -= 1; }
        else p -= 1; // lone "+": literal
      }
    } else {
      for (let p = rs; p < re;) {
        if (s.startsWith('**', p)) { pieces.push({pos: p, len: 2, k: 'b'}); p += 2; }
        else if (s.startsWith('++', p)) { pieces.push({pos: p, len: 2, k: 'u'}); p += 2; }
        else if (s[p] === '*') { pieces.push({pos: p, len: 1, k: 'i'}); p += 1; }
        else p += 1;
      }
    }
    for (const pc of pieces) delims.push(Object.assign(pc, {canOpen, canClose}));
    k = re;
  }
  const open = {b: [], i: [], u: []}, role = new Map();
  for (const d of delims) {
    if (d.canClose && open[d.k].length) { const o = open[d.k].pop(); role.set(o.pos, {d: o, r: 'open'}); role.set(d.pos, {d, r: 'close'}); }
    else if (d.canOpen) open[d.k].push(d);
  }
  const out = [];
  let buf = '';
  for (let k = 0; k < s.length;) {
    const hit = role.get(k);
    if (hit) { if (buf) { out.push({t: 'text', s: buf}); buf = ''; } out.push({t: hit.r, k: hit.d.k}); k += hit.d.len; continue; }
    buf += s[k]; k++;
  }
  if (buf) out.push({t: 'text', s: buf});
  return out;
}
const TAG = {b: 'strong', i: 'em', u: 'u'};
export function inlineHTML(s) {
  return parseInline(s).map(x => x.t === 'text' ? esc(x.s) : `<${x.t === 'close' ? '/' : ''}${TAG[x.k]}>`).join('');
}
export const inlinePlain = s => parseInline(s).filter(x => x.t === 'text').map(x => x.s).join('');

// Text without any marks: for word counts, reading aloud and the AI's view of the words.
export const plain = t => String(t || '').split('\n').map(l => inlinePlain(stripBlock(l))).join('\n');
export const words = t => (plain(t).match(/\S+/g) || []).length;

// Plain text for export: keeps the shape (bullets, numbers, blank lines) but drops the marks.
export function exportText(t) {
  return String(t || '').split('\n').map(l => {
    const b = blockOf(l), c = inlinePlain(b.content);
    if (b.kind === 'bullet') return '• ' + c;
    if (b.kind === 'number') return b.marker.trim() + ' ' + c;
    return c;
  }).join('\n');
}
// Markdown for export.
export function exportMarkdown(t) {
  return String(t || '').split('\n').map(l => {
    const b = blockOf(l);
    const c = parseInline(b.content).map(x => x.t === 'text' ? x.s : x.k === 'b' ? '**' : x.k === 'i' ? '*' : (x.t === 'open' ? '<u>' : '</u>')).join('');
    if (b.kind === 'title') return '# ' + c;
    if (b.kind === 'heading') return '#'.repeat(b.level + 1) + ' ' + c;
    if (b.kind === 'bullet') return '- ' + c;
    if (b.kind === 'number') return b.marker.trim() + ' ' + c;
    return /^(?:#|[-*+] |\d+[.)] |>)/.test(c) ? '\\' + c : c;
  }).join('\n');
}

export function renderDocHTML(text) {
  let html = '', list = null, para = [];
  const flush = () => { if (para.length) { html += `<p>${para.map(inlineHTML).join('<br>')}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const pending = label => `<span class="pending">${label}: your next words go here</span>`;
  const body = c => c && c.trim() ? inlineHTML(c) : null;
  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) { flush(); closeList(); continue; }
    const b = blockOf(raw);
    if (b.kind === 'title') { flush(); closeList(); html += `<h1 class="m-title">${body(b.content) || pending('Title')}</h1>`; continue; }
    if (b.kind === 'heading') { flush(); closeList(); html += `<h${b.level + 1} class="m-h">${body(b.content) || pending('Heading ' + b.level)}</h${b.level + 1}>`; continue; }
    if (b.kind === 'bullet') {
      flush(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${body(b.content) || pending('Bullet')}</li>`; continue;
    }
    if (b.kind === 'number') {
      flush(); if (list !== 'ol') { closeList(); html += `<ol start="${b.level}">`; list = 'ol'; }
      html += `<li>${body(b.content) || pending('Item')}</li>`; continue;
    }
    closeList(); para.push(b.content);
  }
  flush(); closeList();
  return html;
}
