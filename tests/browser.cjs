// End-to-end checks in a real browser (Chromium via Playwright), with Claude and Google Drive stubbed out.
// Run: python3 -m http.server 8766 & node tests/browser.cjs http://localhost:8766/
// Needs Playwright with Chromium installed (npm i -g playwright && npx playwright install chromium).
const {chromium} = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8766/';

const sse = (text, stop = 'end_turn') => [
  {type: 'message_start', message: {id: 'm', type: 'message', role: 'assistant', content: []}},
  {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
  ...text.match(/[\s\S]{1,40}/g).map(t => ({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: t}})),
  {type: 'content_block_stop', index: 0},
  {type: 'message_delta', delta: {stop_reason: stop}},
  {type: 'message_stop'}
].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}});
  // Instant fake speech so read-backs don't wait on real audio.
  await ctx.addInitScript(() => {
    if (!window.speechSynthesis) return;
    window.__spoken = [];
    speechSynthesis.speak = u => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
    speechSynthesis.cancel = () => {};
  });
  const replies = [];      // queue of [body, stop] for Claude
  const requests = [];
  await ctx.route('https://api.anthropic.com/**', async r => {
    const body = JSON.parse(r.request().postData()); requests.push(body);
    const [text, stop] = replies.shift() || ['<text>ok</text>', 'end_turn'];
    if (stop === 'http401') return r.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}})});
    await r.fulfill({status: 200, contentType: 'text/event-stream', body: sse(text || ' ', stop)});
  });
  const backups = [];
  await ctx.route('https://script.google.com/**', async r => { const b = JSON.parse(r.request().postData()); backups.push(b); await r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(b.secret === 's3cret' ? {ok: true} : {ok: false, error: 'Wrong secret'})}); });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());

  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE); await page.waitForTimeout(800);
  const run = fn => page.evaluate(fn);
  const prep = `const {S} = await import('./js/state.js'); const C = await import('./js/commands.js'); const D = await import('./js/doc.js');
    const reset = t => { S.text = t; S.lastChunk = null; S.mode = 'draft'; S.awaiting = null; S.busy = false; S.speaking = false; S.lastFinal = ''; S.unsaved = []; S.recover = null; S.settings.autoPunct = false; };
    const hear = (t, start = '') => { reset(start); C.handleFinal(t); return S.text; };`;
  const ev = body => run(new Function(`return (async () => { ${prep} ${body} })()`));

  // 1. dialogue that sounds like the wake word stays writing
  const wake = await ev(`return {
    saveHer: hear('Save her, please! Help!'), soFar: hear("We've come so far. Please help me."), safer: hear("I'd rather be safer, please stop"),
    sapphire: hear('Sapphire, please open the door.'), superC: hear('Super, please tell me more.') };`);
  check('wake: "Save her, please! Help!" is written', wake.saveHer === 'Save her, please! Help!', wake.saveHer);
  check('wake: "so far. Please help me." is written', /so far\. Please help me\./i.test(wake.soFar), wake.soFar);
  check('wake: "safer, please stop" is written', /safer, please stop/i.test(wake.safer), wake.safer);
  check('wake: "Sapphire, please open the door." is written', /Sapphire, please open the door/.test(wake.sapphire), wake.sapphire);
  check('wake: "Super, please tell me more." is written', /Super, please tell me more/.test(wake.superC), wake.superC);

  // 2. a misheard command is not written; "add that" brings it back
  const mis = await ev(`hear('Zephyr please reed the last paragraph', 'Hello there.'); const after = S.text;
    await new Promise(r => setTimeout(r, 1300)); C.handleFinal('Zephyr please add that'); return {after, recovered: S.text};`);
  check('misheard command is not dictated', mis.after === 'Hello there.', mis.after);
  check('"add that" recovers it', /reed the last paragraph/.test(mis.recovered), mis.recovered);

  // 3. real commands still work, sound-alike included
  const cmds = await ev(`hear('Zephyr please bold that', 'It was cold.'); const bold = S.text;
    hear('Suffer please undo'); return {bold, undone: S.text};`);
  check('Zephyr please bold that', cmds.bold === 'It was **cold**.' || cmds.bold === '**It was cold**.', cmds.bold);

  // 4. names, spoken punctuation, numbers
  const dict = await ev(`hear('Sarah walked in', 'We waited and then'); const name = S.text;
    hear('a dash of salt period'); const dash = S.text; hear('1990. That was the year.'); const year = S.text;
    return {name, dash, year, html: document.querySelector('#docView').innerHTML};`);
  check('names keep capitals', dict.name === 'We waited and then Sarah walked in', dict.name);
  check('"a dash of" stays words', dict.dash === 'A dash of salt.', dict.dash);
  check('1990. is not a list', !/<ol/.test(dict.html), dict.html);

  // 5. clarifying question → answer → edit applied
  await ev(`S.settings.apiKey = 'test';`);
  replies.push(['<question>Which sentence do you mean, the first or the second?</question>']);
  replies.push(['<summary>Cut the second sentence.</summary><change><find> Two.</find><replace></replace></change>']);
  const q = await ev(`reset('One. Two. Three.'); await (await import('./js/ai.js')).runEdit('cut that sentence');
    const awaiting = S.awaiting; C.handleFinal('the second one'); await new Promise(r => setTimeout(r, 400)); return {awaiting, text: S.text};`);
  check('clarifying question waits for an answer', q.awaiting === 'edit-answer', q.awaiting);
  check('answer is used, not written into the manuscript', q.text === 'One. Three.', q.text);
  check('second request carries the question and answer', /The writer answered: "the second one"/.test(requests[requests.length - 1].messages[0].content), requests[requests.length - 1].messages[0].content.slice(-200));

  // 6. refusal is reported, not "Done."
  replies.push(['', 'refusal']);
  const ref = await ev(`reset('A dark scene.'); window.__spoken = []; await (await import('./js/ai.js')).runEdit('make the fight more brutal');
    return {text: S.text, said: window.__spoken.join(' ')};`);
  check('refusal is explained', /declined/i.test(ref.said) && !/^Done/.test(ref.said), ref.said);
  check('refusal leaves text alone', ref.text === 'A dark scene.', ref.text);

  // 7. bad key message
  replies.push(['', 'http401']);
  const bad = await ev(`reset('x'); window.__spoken = []; await (await import('./js/ai.js')).runEdit('fix it'); return window.__spoken.join(' ');`);
  check('rejected key is explained', /API key was rejected/.test(bad), bad);

  // 8. streaming request shape
  const last = requests[requests.length - 1];
  check('requests stream', last.stream === true, last);

  // 9. typing is not lost when a voice result lands
  const typing = await ev(`reset('First line.'); D.setText('First line.', 'x');
    document.querySelector('#viewRaw').click(); const ta = document.querySelector('#docText');
    ta.value = 'First line. I typed this by hand'; ta.dispatchEvent(new Event('input'));
    D.dictate('and spoke this'); await new Promise(r => setTimeout(r, 1100)); document.querySelector('#viewFormatted').click(); return S.text;`);
  check('typing survives a voice result', typing === 'First line. I typed this by hand and spoke this', typing);

  // 10. speaking over Zephyr is held, then recoverable
  const over = await ev(`reset('Start.'); S.speaking = true; S.echo = 'Here is your last paragraph.'; C.handleFinal('and this sentence matters');
    S.speaking = false; const held = S.text; C.handleFinal('Zephyr please add that'); return {held, after: S.text};`);
  check('speech over read-back is held', over.held === 'Start.', over.held);
  check('"add that" puts it in', /this sentence matters/.test(over.after), over.after);

  // 11. rename
  const ren = await ev(`await D.rename("don't stop believing"); return S.doc.title;`);
  check('rename keeps apostrophes', ren === "Don't Stop Believing", ren);

  // 12. long manuscript performance
  const perf = await ev(`const big = Array.from({length: 6000}, (_, i) => 'Sentence number ' + i + ' goes on for a little while here.').join(' ');
    reset(big); D.startSession(); for (let i = 0; i < 400; i++) S.session.versions.push({t: i, label: 'Bold', text: big});
    let t0 = performance.now(); D.dictate('one more line'); const ms = performance.now() - t0; return {ms, versions: S.session.versions.length};`);
  check(`long manuscript dictation is fast (${Math.round(perf.ms)} ms)`, perf.ms < 300, perf);
  check('session versions are capped', perf.versions <= 150, perf.versions);

  // 13. export / import round trip
  await ev(`reset('Short draft.'); await D.endSession({announce: false, stop: false});`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(async () => {
    document.querySelector('.tabs button[data-view="v-settings"]').click(); document.querySelector('#btnExport').click(); })]);
  const file = await dl.path();
  const exported = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  check('export has documents and no secrets', exported.app === 'zephyr' && exported.docs.length >= 1 && !('apiKey' in exported.settings), Object.keys(exported));
  await page.setInputFiles('#importFile', file); await page.waitForTimeout(400);
  check('import reports', /Imported:/.test(await page.textContent('#dataStatus')), await page.textContent('#dataStatus'));

  // 14. Drive backup with a stubbed Apps Script
  await page.click('#setBackup > summary');
  await page.fill('#bkUrl', 'https://script.google.com/macros/s/abc/exec');
  await page.fill('#bkSecret', 'wrong'); await page.click('#btnBkTest'); await page.waitForTimeout(300);
  check('wrong secret is explained', /secret does not match/.test(await page.textContent('#bkStatus')), await page.textContent('#bkStatus'));
  await page.fill('#bkSecret', 's3cret'); await page.click('#btnBkTest'); await page.waitForTimeout(300);
  check('backup test connects', /Connected/.test(await page.textContent('#bkStatus')), await page.textContent('#bkStatus'));
  await page.click('#btnBkNow'); await page.waitForTimeout(400);
  check('back up now sends the document', backups.some(b => b.action === 'saveDoc'), backups.map(b => b.action));

  // 15. theme choice survives a reload
  await page.click('#setLook summary'); await page.click('#swatches [data-palette="fairy"]'); await page.click('#modeSeg [data-mode="dark"]');
  await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(800);
  const look = await page.evaluate(() => [document.documentElement.dataset.palette, document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  check('theme persists', look[0] === 'fairy' && look[1] === 'dark' && look[2] === 'rgb(27, 17, 32)', look);

  // 16. delete with undo
  const delOk = await ev(`const d = await D.createDoc('Throwaway', 'x'); return d.id;`);
  await page.click('.tabs button[data-view="v-docs"]'); await page.waitForTimeout(200);
  await page.click(`[data-del="${delOk}"]`); await page.click(`[data-del="${delOk}"]`); await page.waitForTimeout(200);
  await page.click('#toastAction'); await page.waitForTimeout(300);
  check('deleted document can be restored', await page.isVisible(`[data-open="${delOk}"]`), 'not restored');

  // 17. works offline after the first visit
  await page.waitForTimeout(1500);
  await ctx.setOffline(true); await page.reload(); await page.waitForTimeout(1000);
  check('loads offline', (await page.textContent('#docTitle')).length > 0 && await page.isVisible('#mic'), 'offline load failed');
  await ctx.setOffline(false);

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();
