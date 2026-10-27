// Small helpers with no DOM or app-state dependencies.
export const WEEK = 7 * 24 * 3600 * 1000;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const fmtTime = t => new Date(t).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
export const fmtDate = t => new Date(t).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'});
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const short = s => { s = String(s).trim(); return s.length > 60 ? s.slice(0, 57) + '…' : s; };
export const NUMS = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, to: 2, too: 2, for: 4, won: 1};
export const num = w => { if (!w) return null; const n = parseInt(w, 10); if (!isNaN(n)) return n; return NUMS[String(w).toLowerCase()] || null; };
export const paragraphs = t => String(t).split(/\n+/).map(p => p.trim()).filter(Boolean);
export const sentences = t => (String(t).replace(/\n+/g, ' ').match(/[^.!?…]+[.!?…]+["”’)\]]*|[^.!?…]+$/g) || []).map(s => s.trim()).filter(Boolean);
export const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim();
export function tag(s, name) { const m = String(s).match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')); return m ? m[1].trim() : null; }
export const trimNL = s => s.replace(/^\n/, '').replace(/\n$/, '');
export function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export const pad = n => String(n).padStart(2, '0');
export function stamp(t) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`; }
// Title Case for spoken names: capitalise the first letter of each word, leave the rest ("don't" stays "Don't").
export const titleCase = s => String(s).replace(/(^|[\s(“"-])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
// Next free "Name (2)", "Name (3)"… among existing titles.
export function nextTitle(base, titles) {
  const root = String(base).replace(/\s+\((?:new|\d+)\)$/i, '');
  const taken = new Set(titles.map(t => t.toLowerCase()));
  for (let n = 2; ; n++) { const t = `${root} (${n})`; if (!taken.has(t.toLowerCase())) return t; }
}
