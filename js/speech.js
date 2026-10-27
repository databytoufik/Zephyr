// Speech out (text-to-speech, tones) and speech in (the phone's speech recognition).
import {S} from './state.js';
import {norm} from './util.js';
import {plain} from './markup.js';
import {showZephyr, renderStatus} from './ui.js';
import {handleFinal} from './commands.js';

/* ---------- speech output ---------- */
let speakGen = 0, voices = [];
export const getVoices = () => voices;
export function loadVoices(onChange) {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  if (onChange) onChange(voices);
}
const pickVoice = () => voices.find(v => v.voiceURI === S.settings.voice) || null;
function speechChunks(text) {
  const out = [];
  for (const p of String(text).split(/\n+/)) {
    const sents = p.match(/[^.!?…]+[.!?…]+["”’)\]]*\s*|[^.!?…]+$/g) || [];
    let buf = '';
    for (const s of sents) { if (buf && (buf + s).length > 220) { out.push(buf.trim()); buf = ''; } buf += s; }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}
export function speak(text, {remember = true} = {}) {
  return new Promise(resolve => {
    const gen = ++speakGen;
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    if (remember) S.lastSpoken = text;
    S.echo = text;
    const chunks = speechChunks(text);
    if (!chunks.length) return resolve();
    S.speaking = true; pauseRecIfNeeded(); renderStatus();
    let i = 0, guard = null, current = null;
    const finish = () => { clearTimeout(guard); if (gen !== speakGen) return resolve(); speakGen++; S.speaking = false; S.speechEnd = Date.now(); renderStatus(); resumeRec(); resolve(); };
    const next = u => {
      if (u && u !== current) return; // a late "end" from an utterance we already moved past
      clearTimeout(guard);
      if (gen !== speakGen) return resolve();
      if (i >= chunks.length) return finish();
      const chunk = chunks[i++];
      const utt = new SpeechSynthesisUtterance(chunk);
      current = utt;
      utt.rate = +S.settings.rate || 1;
      const v = pickVoice(); if (v) utt.voice = v;
      utt.lang = v ? v.lang : S.settings.lang;
      utt.onend = () => next(utt); utt.onerror = () => next(utt);
      speechSynthesis.speak(utt);
      // phones sometimes never report the end of speech; move on anyway so listening never stalls
      guard = setTimeout(() => next(utt), 2500 + chunk.length * 110 / (utt.rate || 1));
    };
    setTimeout(() => next(null), 60);
  });
}
export function stopSpeaking() {
  speakGen++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (S.speaking) { S.speaking = false; S.speechEnd = Date.now(); renderStatus(); resumeRec(); }
}
export function say(text) { showZephyr(text); return speak(text); }
export function readAloud(text) { S.lastRead = text; showZephyr('Reading aloud…'); return speak(plain(text)); }

let actx = null;
export function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'wake' ? [660, 990] : kind === 'down' ? [700, 440] : [880];
    tones.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.13;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.13);
    });
  } catch (e) {}
}

// Did the microphone just pick up Zephyr's own voice?
//   during: Zephyr is still talking. window: how long after it stopped to keep checking.
//   fuzzy: also count near-matches (most words in common), for phrases of three words or more.
//   minWords: ignore shorter phrases entirely (a short answer to a question often repeats its words).
export function isEcho(t, {during = false, fuzzy = true, window = 2500, minWords = 1} = {}) {
  if (!S.echo) return false;
  if (!during && Date.now() - S.speechEnd > window) return false;
  const n = norm(t), said = norm(S.echo);
  const heard = n.split(' ').filter(w => w.length > 1);
  if (heard.length < minWords) return false;
  if (n.length > 3 && said.includes(n)) return true;
  if (!fuzzy || heard.length < 3) return false;
  const set = new Set(said.split(' '));
  return heard.filter(w => set.has(w)).length / heard.length >= 0.75;
}

/* ---------- speech input ---------- */
export const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recRunning = false, recPaused = false, wakeLock = null, greeted = false, lastRecStart = 0;
let hearTimer = null;
function hearing() { if (S.heard) return; S.heard = true; renderStatus(); clearTimeout(hearTimer); hearTimer = setTimeout(() => { S.heard = false; renderStatus(); }, 1500); }
const committed = {};
let stallTimer = null, pendingParts = [];
const wordsOf = t => String(t).trim().split(/\s+/).filter(Boolean);
function commitPart(i, txt) {
  const prev = committed[i] || '';
  committed[i] = txt;
  if (!prev) return handleFinal(txt);
  const pw = wordsOf(prev), tw = wordsOf(txt);
  // only the words beyond what was already written; if the phone revised an earlier word, still keep the new ones
  if (tw.length > pw.length) handleFinal(tw.slice(pw.length).join(' '));
}
function flushPending() {
  clearTimeout(stallTimer);
  const p = pendingParts; pendingParts = [];
  p.forEach(([i, txt]) => commitPart(i, txt));
}
function makeRec() {
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = S.settings.lang || 'en-US'; r.maxAlternatives = 1;
  r.onstart = () => { recRunning = true; lastRecStart = Date.now(); for (const k in committed) delete committed[k]; pendingParts = []; renderStatus(); };
  r.onresult = e => {
    const pending = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], txt = res[0].transcript;
      if (res.isFinal) commitPart(i, txt); else pending.push([i, txt]);
    }
    clearTimeout(stallTimer);
    pendingParts = pending;
    if (pending.length) { hearing(); stallTimer = setTimeout(flushPending, 1200); }
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      S.listening = false; renderStatus();
      showZephyr('Microphone access is blocked. Allow the microphone for this page in your browser settings, then tap Start listening.');
    }
  };
  r.onend = () => {
    recRunning = false; flushPending(); renderStatus();
    if (S.listening && !recPaused) setTimeout(() => { if (S.listening && !recRunning && !recPaused) startRec(); }, 300);
  };
  return r;
}
function startRec() { if (!rec) rec = makeRec(); try { rec.start(); } catch (e) { if (Date.now() - lastRecStart > 8000 && !recRunning) { try { rec.abort(); } catch (x) {} rec = null; } } }
function pauseRecIfNeeded() { if (!S.settings.listenWhileTalking && S.listening && rec) { recPaused = true; try { rec.abort(); } catch (e) {} } }
function resumeRec() { if (recPaused) { recPaused = false; if (S.listening) setTimeout(startRec, 250); } }
export function restartRec() { if (rec) { try { rec.abort(); } catch (x) {} rec = null; if (S.listening) setTimeout(startRec, 400); } }
// If the microphone has gone quiet on its own, start it again.
setInterval(() => { if (S.listening && !recPaused && !recRunning) startRec(); }, 3000);

export async function startListening() {
  if (!SR) { say('This browser cannot listen. On iPhone use Safari, on Android use Chrome.'); return; }
  S.listening = true; S.mode = 'draft'; startRec(); renderStatus(); keepAwake();
  if (!greeted) { greeted = true; say(S.session ? `Picking up your session on ${S.doc.title}. Go ahead.` : 'Ready. Everything you say goes into the manuscript. To give a command, start with Zephyr please.'); }
  else beep('ok');
}
export function stopListening() {
  S.listening = false; recPaused = false; S.awaiting = null;
  if (rec) { try { rec.abort(); } catch (e) {} }
  releaseAwake(); renderStatus();
}
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
function releaseAwake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.listening) { keepAwake(); if (!recRunning && !recPaused) startRec(); } });
