import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {titleCase, nextTitle} from '../js/util.js';
import {applyChanges} from '../js/edits.js';
import {buildCSS, checkContrast} from '../tools/build-themes.mjs';

test('rename keeps apostrophes intact', () => {
  assert.equal(titleCase("don't stop believing"), "Don't Stop Believing");
  assert.equal(titleCase('the long road north'), 'The Long Road North');
});

test('new copies get numbered names instead of (new) (new)', () => {
  assert.equal(nextTitle('Story', ['Story']), 'Story (2)');
  assert.equal(nextTitle('Story (2)', ['Story', 'Story (2)']), 'Story (3)');
  assert.equal(nextTitle('Story (new)', ['Story (new)']), 'Story (2)');
});

test('edits apply only when the find text is unique', () => {
  assert.equal(applyChanges('It was cold. Very cold.', [{find: 'It was cold', replace: 'It was bitter'}]), 'It was bitter. Very cold.');
  assert.equal(applyChanges('cold and cold', [{find: 'cold', replace: 'x'}]), null);
  assert.equal(applyChanges('She said “hi”', [{find: 'She said "hi"', replace: 'ok'}]), 'ok');
  assert.equal(applyChanges('abc', [{find: 'zzz', replace: 'x'}]), null);
});

test('every palette meets the contrast checks', () => {
  assert.deepEqual(checkContrast(), []);
});

test('css/themes.css matches js/palettes.js', () => {
  assert.equal(readFileSync(new URL('../css/themes.css', import.meta.url), 'utf8'), buildCSS());
});

test('service worker caches every app file', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['ai', 'app', 'backup', 'claude', 'commands', 'db', 'dictation', 'doc', 'edits', 'markup', 'palettes', 'speech', 'state', 'theme-boot', 'ui', 'util', 'wake']) {
    assert.ok(sw.includes(`'js/${f}.js'`), `sw.js is missing js/${f}.js`);
  }
});
