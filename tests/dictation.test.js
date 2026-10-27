import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatDictation, applyDictation, joinText, lineBreak, removeLastSentence} from '../js/dictation.js';

const dictate = (text, said, wrap) => applyDictation(text, formatDictation(said), wrap);

test('spoken punctuation', () => {
  assert.equal(dictate('', 'hello comma world period how are you question mark'), 'Hello, world. How are you?');
  assert.equal(dictate('', 'he said open quote hi close quote'), 'He said “hi”');
});

test('punctuation words stay words after a determiner', () => {
  assert.equal(dictate('', 'a dash of salt and the period was long'), 'A dash of salt and the period was long');
  assert.equal(dictate('', 'it was the end period'), 'It was the end.');
  assert.equal(dictate('', 'she drew a new line in the sand'), 'She drew a new line in the sand');
  assert.equal(dictate('', 'stop period new paragraph go'), 'Stop.\n\nGo');
});

test('names keep their capital mid-sentence; common words do not', () => {
  assert.equal(joinText('We waited and then', 'Sarah walked in'), 'We waited and then Sarah walked in');
  assert.equal(joinText('We waited', 'And then she left'), 'We waited and then she left');
  assert.equal(joinText('Then', 'I left'), 'Then I left');
});

test('a dictated number at the start of a line is not turned into a list', () => {
  assert.equal(dictate('', '3. Then she left'), '\\3. Then she left');
  assert.equal(dictate('', '1990. That was the year'), '1990. That was the year');
});

test('lists continue and end', () => {
  assert.equal(lineBreak('- one', 'para'), '- one\n- ');
  assert.equal(lineBreak('1. one', 'para'), '1. one\n2. ');
  assert.equal(lineBreak('- one\n- ', 'para'), '- one\n\n');
});

test('inline formatting while talking', () => {
  assert.equal(dictate('Hello.', 'big news', {b: true, i: false, u: false}), 'Hello. **Big news**');
});

test('remove last sentence', () => {
  assert.equal(removeLastSentence('One. Two. Three.'), 'One. Two.');
  assert.equal(removeLastSentence('Only'), '');
});
