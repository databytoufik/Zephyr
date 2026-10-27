// Spotting "Zephyr please" in what the phone heard.
// "Zephyr" is rare, so phones often mishear it. The word "please" right after it is the anchor.
// Exact hits ("Zephyr", "Zefir"…) count anywhere. Sound-alikes that are real words ("suffer", "sapphire", "safer") only
// count at the very start of what you said AND when the rest is a complete command, so dialogue such as
// "We've come so far. Please help me." or "Save her, please! Help!" mid-sentence stays writing.
export const WAKE_EXACT = /^(?:zephyr(?:'s|s)?|zephyre|zephir|zephere|zepher|zephur|zefir|zeffir|zefer|zeffer|zefur|zafir|zafer|zaffer|zeph|xephyr)$/i;
export const WAKE_SOFT = /^(?:suffer|suffers|sufferer|sofer|safer|saffer|sulfur|sulphur|sapphire|sapphires|safire|saffire|sephora|sefer|seffer|zephyrus|super|cipher|sever|the fur|z fur|zee fur|zed fur|zeph ear|zeph her|zef her|sef her|safe her|so far|sofa)$/i;
export const STOPRE = /^(?:stop|quiet|hush|shush|enough|cancel|be quiet|stop talking|shut up)\b/i;

const soundsLikeZephyr = w => {
  const k = w.toLowerCase().replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/th/g, 's').replace(/[pv]/g, 'f').replace(/[zxc]/g, 's')
    .replace(/[aeiouyhw]/g, '').replace(/(.)\1+/g, '$1');
  return k === 'sfr';
};

// Returns null or {index, length, soft} for the wake phrase, including a leading "hey"/"okay".
// opts.isCommand(rest) decides whether the words after a sound-alike form a complete command; opts.lenient=false
// turns sound-alikes off entirely.
export function wakeMatch(t, opts = {}) {
  const str = String(t), lenient = opts.lenient !== false, isCommand = opts.isCommand || (() => false);
  for (const p of str.matchAll(/\bpleas(?:e|ed)?\b[\s,.:;!?-]*/gi)) {
    const before = str.slice(0, p.index).replace(/[\s,.:;!?-]+$/, '');
    const ws = [...before.matchAll(/[A-Za-z'’]+/g)];
    if (!ws.length) continue;
    const after = str.slice(p.index + p[0].length);
    for (const n of [1, 2]) {
      if (ws.length < n) break;
      const first = ws[ws.length - n], phrase = ws.slice(-n).map(x => x[0]).join(' ');
      const exact = n === 1 && (WAKE_EXACT.test(phrase) || (/^[zx]/i.test(phrase) && soundsLikeZephyr(phrase)));
      if (!exact) {
        if (!lenient || !WAKE_SOFT.test(phrase)) continue;
        const lead = str.slice(0, first.index);
        const atStart = /^\s*(?:(?:hey|okay|ok)[\s,]+)?$/i.test(lead);
        const rest = after.replace(/^[\s,.:;!?-]+/, '').replace(/[\s.!?]+$/, '');
        if (!atStart || (rest && !isCommand(rest))) continue;
      }
      const lead = str.slice(0, first.index).match(/(?:\b(?:hey|okay|ok)[\s,]+)?$/i)[0];
      const start = first.index - lead.length;
      return {index: start, length: p.index + p[0].length - start, soft: !exact};
    }
  }
  return null;
}
export function afterWake(t, m) { return m ? String(t).slice(m.index + m.length).replace(/^[\s,.:;!?-]+/, '') : ''; }
