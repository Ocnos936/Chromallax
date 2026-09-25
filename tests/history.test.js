import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.js';

test('undo and redo walk back and forth through committed steps', () => {
  const history = new History({ depth: 1 });
  assert.equal(history.commit({ depth: 2 }), true);
  assert.equal(history.commit({ depth: 3 }), true);
  assert.deepEqual(history.undo(), { depth: 2 });
  assert.deepEqual(history.undo(), { depth: 1 });
  assert.equal(history.undo(), null);
  assert.deepEqual(history.redo(), { depth: 2 });
  assert.deepEqual(history.redo(), { depth: 3 });
  assert.equal(history.redo(), null);
});

test('an unchanged snapshot is not a step', () => {
  const history = new History({ panels: [{ x: 0.5 }] });
  assert.equal(history.commit({ panels: [{ x: 0.5 }] }), false);
  assert.equal(history.canUndo, false);
});

test('a new step after undoing drops the redo steps', () => {
  const history = new History({ depth: 1 });
  history.commit({ depth: 2 });
  history.undo();
  assert.equal(history.canRedo, true);
  history.commit({ depth: 5 });
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo(), { depth: 1 });
});

test('the oldest steps fall off past the limit', () => {
  const history = new History({ n: 0 }, { limit: 3 });
  for (let n = 1; n <= 5; n++) history.commit({ n });
  const back = [];
  for (let s; (s = history.undo()); ) back.push(s.n);
  assert.deepEqual(back, [4, 3, 2]);
});

test('reset forgets every step', () => {
  const history = new History({ n: 0 });
  history.commit({ n: 1 });
  history.undo();
  history.reset({ n: 9 });
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.commit({ n: 9 }), false);
});
