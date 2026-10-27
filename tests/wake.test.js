import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wakeMatch, afterWake} from '../js/wake.js';

// stand-in for the app's command table
const isCommand = rest => /^(?:help|stop|continue|compose|read\b|open \w+|undo|pause)/i.test(rest) && !/^open the door/i.test(rest);
const opts = {isCommand};

test('exact wake word works anywhere', () => {
  const t = 'it was late Zephyr please read last paragraph';
  const m = wakeMatch(t, opts);
  assert.ok(m && !m.soft);
  assert.equal(afterWake(t, m), 'read last paragraph');
  assert.ok(wakeMatch('Zefir please stop', opts));
});

test('sound-alikes only at the start and before a real command', () => {
  assert.ok(wakeMatch('Suffer please read', opts)?.soft);
  assert.ok(wakeMatch('Sapphire please stop', opts));
  assert.equal(wakeMatch('We have come so far. Please help me.', opts), null);
  assert.equal(wakeMatch("I'd rather be safer, please stop", opts), null);
  assert.equal(wakeMatch('Sapphire, please open the door.', opts), null);
  assert.equal(wakeMatch('Save her, please! Help!', opts), null);
  assert.equal(wakeMatch('Super, please tell me more.', opts), null);
});

test('sound-alikes can be turned off', () => {
  assert.equal(wakeMatch('Suffer please read', {isCommand, lenient: false}), null);
  assert.ok(wakeMatch('Zephyr please read', {isCommand, lenient: false}));
});

test('a bare wake phrase waits for the command', () => {
  const m = wakeMatch('Zephyr please', opts);
  assert.ok(m);
  assert.equal(afterWake('Zephyr please', m), '');
});
