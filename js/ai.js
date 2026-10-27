// Edit, feedback and explain: the requests that go to Claude.
import {S} from './state.js';
import {tag, trimNL, short, clean, num} from './util.js';
import {applyChanges} from './edits.js';
import {callClaude, editSystem, FEEDBACK_SYS, EXPLAIN_SYS} from './claude.js';
import {say, beep} from './speech.js';
import {showZephyr, renderStatus, renderSuggestions, flushTyping} from './ui.js';
import {setText} from './doc.js';
import {setAwait, handleFinal} from './commands.js';

export function guardAI() {
  if (S.busy) { say("I'm still working on the last request."); return false; }
  if (!S.settings.apiKey) { say('I need your Claude API key first. Add it in Settings when you are parked.'); return false; }
  return true;
}
async function withBusy(label, fn) {
  flushTyping();
  S.busy = true; S.abort = new AbortController(); showZephyr(label); renderStatus(); beep('ok');
  try { await fn(); }
  catch (e) { S.busy = false; renderStatus(); await say(e.name === 'AbortError' ? 'Cancelled.' : e.message); }
  finally {
    S.busy = false; S.abort = null; renderStatus();
    const held = S.heldWhileBusy; S.heldWhileBusy = [];
    held.forEach(t => handleFinal(t, true));
  }
}
function editUser(instruction) {
  return `<document>\n${S.text || '(empty)'}\n</document>\n<recent_dictation>${S.lastChunk ? S.lastChunk.after.slice(S.lastChunk.before.length).trim() : '(none)'}</recent_dictation>\n<last_read_aloud>${S.lastRead ? S.lastRead.slice(0, 2000) : '(none)'}</last_read_aloud>\n<instruction>${instruction}</instruction>`;
}
export async function runEdit(instruction) {
  instruction = String(instruction || '').trim();
  if (!instruction) { setAwait('edit', 20000); return say('What should I change?'); }
  if (!guardAI()) return;
  await withBusy('Editing…', async () => {
    let out = await callClaude(editSystem(false), editUser(instruction), 16000);
    let summary = tag(out, 'summary');
    let full = tag(out, 'full_document');
    const question = tag(out, 'question');
    const changes = [...out.matchAll(/<change>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/change>/g)]
      .map(x => ({find: trimNL(x[1]), replace: trimNL(x[2])}));
    // Claude needs more detail: wait for the answer instead of writing it into the manuscript.
    const asked = question || (full === null && !changes.length && summary && /\?\s*$/.test(summary) ? summary : null);
    if (asked) {
      S.busy = false; renderStatus();
      S.awaitCtx = {instruction, question: clean(asked)};
      await say(clean(asked));
      setAwait('edit-answer', 30000);
      return;
    }
    let next = null;
    if (full !== null) next = full;
    else if (changes.length) {
      next = applyChanges(S.text, changes);
      if (next === null) {
        out = await callClaude(editSystem(true), editUser(instruction), 16000);
        full = tag(out, 'full_document');
        if (full === null) throw new Error("I couldn't match that edit to your text. Nothing was changed. Try saying it a different way.");
        next = full; summary = tag(out, 'summary') || summary;
      }
    }
    S.busy = false; renderStatus();
    if (next !== null && next !== S.text) {
      setText(next, 'Edit: ' + short(instruction));
      await say(clean(summary || 'Done.'));
    } else {
      await say(clean(summary) ? `${clean(summary)} The text did not change.` : "I didn't change anything.");
    }
  });
}
export function answerEdit(answer) {
  const ctx = S.awaitCtx; S.awaitCtx = null;
  if (!ctx) return runEdit(answer);
  return runEdit(`${ctx.instruction}\n(You asked: "${ctx.question}" The writer answered: "${answer}")`);
}
export async function runFeedback(focus) {
  if (!S.text.trim()) return say('There is nothing to give feedback on yet. Just start talking.');
  if (!guardAI()) return;
  await withBusy('Reading your draft…', async () => {
    const out = await callClaude(FEEDBACK_SYS, `<document>\n${S.text}\n</document>` + (focus && focus.trim() ? `\n<focus>${focus.trim()}</focus>` : ''), 3000);
    const spoken = tag(out, 'spoken') || '';
    S.suggestions = [...out.matchAll(/<suggestion>([\s\S]*?)<\/suggestion>/g)]
      .map(x => ({say: tag(x[1], 'say'), instruction: tag(x[1], 'instruction')}))
      .filter(s => s.say && s.instruction);
    renderSuggestions();
    let speech = clean(spoken);
    S.suggestions.forEach((s, i) => { speech += ` Suggestion ${i + 1}. ${clean(s.say)}`; });
    if (S.suggestions.length) speech += ' To use one, say Zephyr please, apply suggestion, and its number. Or say Zephyr please, apply all.';
    S.busy = false; renderStatus();
    await say(speech || clean(out));
  });
}
export function applyCmd(arg) {
  if (!S.suggestions.length) return say('There are no suggestions yet. Say Zephyr please, feedback first.');
  const a = String(arg || '').toLowerCase();
  let picks;
  if (/\b(all|everything|every|them)\b/.test(a)) picks = S.suggestions.map((_, i) => i + 1);
  else picks = a.split(/[\s,]+|\band\b/).map(num).filter(n => n && S.suggestions[n - 1]);
  picks = [...new Set(picks)];
  if (!picks.length) { return say(`I have suggestions one through ${S.suggestions.length}. Say Zephyr please, apply suggestion, and a number.`); }
  const instr = picks.length === 1 ? S.suggestions[picks[0] - 1].instruction
    : 'Make all of these changes:\n' + picks.map(n => `${n}. ${S.suggestions[n - 1].instruction}`).join('\n');
  return runEdit(instr);
}
export async function runExplain(q) {
  q = String(q || '').trim();
  if (!q) { setAwait('explain', 20000); return say('What would you like to know?'); }
  if (!guardAI()) return;
  await withBusy('Thinking…', async () => {
    const out = await callClaude(EXPLAIN_SYS, `<document>\n${S.text || '(empty)'}\n</document>\n<last_read_aloud>${S.lastRead ? S.lastRead.slice(0, 2000) : '(none)'}</last_read_aloud>\n<question>${q}</question>`, 1200);
    S.busy = false; renderStatus();
    await say(clean(out));
  });
}
