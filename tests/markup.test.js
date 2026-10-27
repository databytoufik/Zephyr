import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderDocHTML, plain, words, exportText, exportMarkdown, inlineHTML, blockOf} from '../js/markup.js';

test('pairs of marks format; stray characters stay literal', () => {
  assert.equal(inlineHTML('a **bold** and *it* and ++u++.'), 'a <strong>bold</strong> and <em>it</em> and <u>u</u>.');
  assert.equal(inlineHTML('I write C++ and C++ daily, 5 * 3 = 15, a*b.'), 'I write C++ and C++ daily, 5 * 3 = 15, a*b.');
  assert.equal(inlineHTML('***both***'), '<strong><em>both</em></strong>');
  assert.equal(inlineHTML('“**quoted**”'), '“<strong>quoted</strong>”');
  assert.equal(inlineHTML('<script>'), '&lt;script&gt;');
});

test('plain text keeps literal symbols', () => {
  assert.equal(plain('I write C++ and use 5 * 3 in notes, a*b too.'), 'I write C++ and use 5 * 3 in notes, a*b too.');
  assert.equal(plain('% Title\n# Head\n- item **b**'), 'Title\nHead\nitem b');
});

test('years and long numbers are not list items', () => {
  assert.equal(blockOf('1990. That was the year.').kind, 'para');
  assert.equal(renderDocHTML('1990. That was the year everything changed.'), '<p>1990. That was the year everything changed.</p>');
  assert.equal(plain('1990. That was the year.'), '1990. That was the year.');
  assert.equal(blockOf('3. Third').kind, 'number');
});

test('a backslash keeps a line ordinary', () => {
  assert.equal(renderDocHTML('\\3. Then she left.'), '<p>3. Then she left.</p>');
  assert.equal(plain('\\- not a bullet'), '- not a bullet');
});

test('blocks render as before', () => {
  assert.equal(renderDocHTML('% T\n\n## H\n\n- a\n- b\n\n1. x\n2. y\n\npara\nline2'),
    '<h1 class="m-title">T</h1><h3 class="m-h">H</h3><ul><li>a</li><li>b</li></ul><ol start="1"><li>x</li><li>y</li></ol><p>para<br>line2</p>');
  assert.match(renderDocHTML('- '), /Bullet: your next words go here/);
});

test('exports keep the shape', () => {
  assert.equal(exportText('% T\n\n- a **b**\n1. c\n\nC++ rocks'), 'T\n\n• a b\n1. c\n\nC++ rocks');
  assert.equal(exportMarkdown('% T\n# H\n- a ++u++'), '# T\n## H\n- a <u>u</u>');
});

test('word count ignores marks', () => {
  assert.equal(words('% A title\n- **one** two'), 4);
});
