// Applying Claude's find/replace edits to the manuscript.
import {escRe} from './util.js';

// Apply find/replace blocks. Returns null when a find is missing or matches more than one place.
export function applyChanges(text, changes) {
  let out = text;
  for (const c of changes) {
    if (!c.find) return null;
    const i = out.indexOf(c.find);
    if (i >= 0) {
      if (out.indexOf(c.find, i + 1) >= 0) return null;
      out = out.slice(0, i) + c.replace + out.slice(i + c.find.length); continue;
    }
    const pat = escRe(c.find.trim()).replace(/\s+/g, '\\s+').replace(/["“”]/g, '["“”]').replace(/['‘’]/g, "['‘’]");
    const all = [...out.matchAll(new RegExp(pat, 'g'))];
    if (all.length !== 1) return null;
    const m = all[0];
    out = out.slice(0, m.index) + c.replace + out.slice(m.index + m[0].length);
  }
  return out;
}
