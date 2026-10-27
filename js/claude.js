// Talking to Claude. Responses stream, so a long edit keeps the connection alive instead of hitting a fixed timeout.
import {S} from './state.js';

const API = 'https://api.anthropic.com/v1/messages';
const IDLE_MS = 45000;      // give up if nothing arrives for this long
const FIRST_BYTE_MS = 60000;

export class ClaudeError extends Error {}

// Reads a server-sent-event stream and returns {text, stopReason}.
async function readStream(res, onActivity) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', stopReason = null;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    onActivity();
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') text += ev.delta.text;
      else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new ClaudeError(friendlyError(0, ev.error));
    }
  }
  return {text, stopReason};
}

function friendlyError(status, err) {
  const type = err && err.type, msg = err && err.message;
  if (status === 401 || type === 'authentication_error') return 'Your API key was rejected. Check it in Settings when you are parked.';
  if (status === 403 || type === 'permission_error') return 'Your API key is not allowed to use that model. Pick another model in Settings.';
  if (status === 429 || status === 529 || type === 'rate_limit_error' || type === 'overloaded_error') return 'Claude is busy right now. Try again in a moment.';
  if (status === 402 || /credit|billing/i.test(msg || '')) return 'Your Anthropic account is out of credit. Add credit in the Anthropic console.';
  return 'Claude returned an error: ' + (msg || status);
}

// opts: model, signal (null to ignore the shared cancel button), effort
export async function callClaude(system, user, maxTokens, opts = {}) {
  const outer = 'signal' in opts ? opts.signal : (S.abort ? S.abort.signal : null);
  const ctl = new AbortController();
  let why = null, timer = null;
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { why = 'timeout'; ctl.abort(); }, ms); };
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => { why = 'cancel'; ctl.abort(); }, {once: true}); }
  const body = {model: opts.model || S.settings.model, max_tokens: maxTokens, system, stream: true, messages: [{role: 'user', content: user}]};
  if (opts.effort) body.output_config = {effort: opts.effort};
  arm(FIRST_BYTE_MS);
  try {
    let res;
    try {
      res = await fetch(API, {
        method: 'POST', signal: ctl.signal,
        headers: {'content-type': 'application/json', 'x-api-key': S.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (why === 'cancel') throw e;
      if (why === 'timeout') throw new ClaudeError('Claude took too long to answer. Try again, or try a smaller request.');
      throw new ClaudeError("I couldn't reach Claude. You may be out of signal. Try again in a minute.");
    }
    if (!res.ok) {
      let j = {}; try { j = await res.json(); } catch (e) {}
      throw new ClaudeError(friendlyError(res.status, j.error));
    }
    arm(IDLE_MS);
    let out;
    try { out = await readStream(res, () => arm(IDLE_MS)); }
    catch (e) {
      if (e instanceof ClaudeError || why === 'cancel') throw e;
      if (why === 'timeout') throw new ClaudeError('Claude stopped answering partway through. Nothing was changed. Try again.');
      throw new ClaudeError('The connection dropped while Claude was answering. Nothing was changed. Try again when you have signal.');
    }
    if (out.stopReason === 'refusal') throw new ClaudeError("Claude declined that request, so nothing was changed. Try wording it differently, or pick another model in Settings.");
    if (out.stopReason === 'max_tokens') throw new ClaudeError('That response ran too long for me to finish. Nothing was changed. Try a smaller request.');
    return out.text;
  } finally { clearTimeout(timer); }
}

// A cheap request to confirm the key works.
export async function testKey() {
  await callClaude('Reply with OK.', 'Say OK.', 16, {model: 'claude-haiku-5-5', signal: null});
}

/* ---------- prompts ---------- */
export const MARKUP_NOTE = 'The document uses formatting marks: a line starting with "% " is the title, "# " to "#### " are headings one to four, "- " is a bullet, "1. " is a numbered item, **bold**, *italic*, ++underline++. A line starting with a backslash is ordinary text. Keep these marks unless the instruction is about formatting; use them when it is. Never read the marks aloud or mention them by name.';
export const VOICE_RULES = 'Everything you say is read aloud by text-to-speech to a writer who is driving. Use plain spoken sentences. No markdown, no bullet symbols, no emoji, no headings.';
export const COMMAND_LIST = 'Every command starts with Zephyr please. Commands the writer can say: Zephyr please compose (everything they say then goes into the manuscript), Zephyr please pause, Zephyr please scratch that, Zephyr please read (or read last paragraph, read paragraph three), Zephyr please edit followed by the change, Zephyr please feedback, Zephyr please apply suggestion and a number, Zephyr please explain followed by a question, Zephyr please undo, Zephyr please redo, Zephyr please create new, Zephyr please rename, Zephyr please open, Zephyr please end session. Formatting: Zephyr please title, Zephyr please heading one to four, Zephyr please normal text, Zephyr please bulleted list, Zephyr please numbered list, Zephyr please new paragraph, Zephyr please bold or italic or underline followed by that, last sentence or the words, Zephyr please remove formatting.';

export const POLISH_SYS = `You fix punctuation, capitalization and spacing in text a writer dictated by voice.
Never add, remove, replace or reorder words. You may change capital letters, add or change punctuation, and split run-on sentences.
Capitalize names and the first word of each sentence. Lowercase words that were capitalized by mistake in the middle of a sentence.
The text uses formatting marks: a line starting with "% " is a title, "# " to "#### " are headings, "- " is a bullet, "1. " is a numbered item, **bold**, *italic*, ++underline++, and a leading backslash keeps a line ordinary. Keep every mark and every line break exactly where it is.
The final sentence may be unfinished because the writer is still talking, so add no punctuation at the very end.
Reply with only the corrected text inside <text></text>.`;

export function editSystem(forceFull) {
  return `You are the editing engine inside Zephyr, a voice writing assistant. Apply the writer's spoken edit instruction to their document.
Change only what the instruction requires and keep every other character exactly as it is. Preserve the writer's voice and style. The instruction was transcribed from speech, so read past obvious mishearings. Phrases like "that sentence" or "what I just said" usually point to the most recent dictation or the passage most recently read aloud, both provided.
Respond in exactly this format:
<summary>One or two plain spoken sentences saying what you changed. If the change is short, quote the new wording.</summary>
${forceFull ? '<full_document>the complete revised document</full_document>' : `Then EITHER one or more blocks of
<change><find>text copied character for character from the document, long enough to appear exactly once</find><replace>the new text</replace></change>
OR, only when the change rewrites most of the document or the document is empty, a single
<full_document>the complete revised document</full_document>`}
If the instruction is unclear or cannot be applied, reply with only a <question> containing one short clarifying question, and make no changes.
${MARKUP_NOTE}
${VOICE_RULES}`;
}
export const FEEDBACK_SYS = `You are Zephyr, a sharp and warm editor giving feedback a writer can absorb by ear while driving.
Respond in exactly this format:
<spoken>Two to four sentences: what is working, and the most important thing to improve.</spoken>
Then up to four blocks, most important first:
<suggestion><say>Under 45 words. Say where in the piece by quoting a few of its words, what to change, and why.</say><instruction>A precise edit instruction an editor could apply to the document without seeing this conversation.</instruction></suggestion>
${MARKUP_NOTE}
${VOICE_RULES}`;
export const EXPLAIN_SYS = `You are Zephyr, a writing teacher talking with a writer while they drive. Answer their question about writing, revising or editing in under 150 words of plain spoken prose. Be concrete. When their document is relevant, refer to it by quoting a few of its words. When it helps, tell them exactly what to say to make the change, for example: say Zephyr please, edit, then cut the first sentence of the opening.
${COMMAND_LIST}
${MARKUP_NOTE}
${VOICE_RULES}`;
