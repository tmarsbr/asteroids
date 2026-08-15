import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HIGH_SCORE_STORAGE_KEY,
  normalizeHighScore,
  loadHighScore,
  saveHighScore,
} from '../src/high-score.js';

function makeStorage(initialValue = null) {
  let value = initialValue;
  const writes = [];
  return {
    writes,
    getItem(key) {
      assert.equal(key, HIGH_SCORE_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, HIGH_SCORE_STORAGE_KEY);
      value = nextValue;
      writes.push(nextValue);
    },
    current() {
      return value;
    },
  };
}

test('high score: storage key is explicitly versioned', () => {
  assert.match(HIGH_SCORE_STORAGE_KEY, /(?:^|[.\-_:])v\d+$/i);
});

test('high score: normalization accepts only non-negative safe integers', () => {
  assert.equal(normalizeHighScore(0), 0);
  assert.equal(normalizeHighScore(321), 321);
  assert.equal(normalizeHighScore(' 0042 '), 42);
  assert.equal(
    normalizeHighScore(String(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER,
  );

  for (const invalid of [
    null,
    undefined,
    true,
    '',
    '   ',
    'not-a-score',
    -1,
    '-1',
    1.5,
    '1.5',
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.equal(normalizeHighScore(invalid), 0, `expected ${String(invalid)} to be rejected`);
  }
});

test('high score: load handles missing, malformed, and throwing storage', () => {
  assert.equal(loadHighScore(null), 0);
  assert.equal(loadHighScore({}), 0);
  assert.equal(loadHighScore(makeStorage(null)), 0);
  assert.equal(loadHighScore(makeStorage('invalid')), 0);
  assert.equal(loadHighScore(makeStorage('9001')), 9001);

  const throwingMethod = {
    getItem() {
      throw new Error('storage denied');
    },
  };
  assert.equal(loadHighScore(throwingMethod), 0);

  const throwingProperty = Object.defineProperty({}, 'getItem', {
    get() {
      throw new Error('storage getter denied');
    },
  });
  assert.equal(loadHighScore(throwingProperty), 0);
});

test('high score: save persists only a strictly greater safe record', () => {
  const storage = makeStorage('500');

  assert.equal(saveHighScore(499, storage), 500);
  assert.equal(saveHighScore(500, storage), 500);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.current(), '500');

  assert.equal(saveHighScore(750, storage), 750);
  assert.deepEqual(storage.writes, ['750']);
  assert.equal(storage.current(), '750');

  assert.equal(saveHighScore(100, storage), 750);
  assert.deepEqual(storage.writes, ['750']);
  assert.equal(storage.current(), '750');
});

test('high score: invalid candidates never replace a valid record', () => {
  const storage = makeStorage('4321');

  for (const invalid of [
    -1,
    3.14,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    'invalid',
  ]) {
    assert.equal(saveHighScore(invalid, storage), 4321);
  }

  assert.deepEqual(storage.writes, []);
  assert.equal(storage.current(), '4321');
});

test('high score: save remains useful when storage is absent or throws', () => {
  assert.equal(saveHighScore(1234, null), 1234);
  assert.equal(saveHighScore(Number.MAX_SAFE_INTEGER, null), Number.MAX_SAFE_INTEGER);
  assert.equal(saveHighScore(Number.MAX_SAFE_INTEGER + 1, null), 0);

  let writes = 0;
  const unreadable = {
    getItem() {
      throw new Error('read denied');
    },
    setItem() {
      writes++;
    },
  };
  assert.equal(saveHighScore(600, unreadable), 600);
  assert.equal(writes, 0, 'an unreadable record must not be overwritten with a possibly lower value');

  const unwritable = {
    getItem() {
      return '250';
    },
    setItem() {
      throw new Error('write denied');
    },
  };
  assert.equal(saveHighScore(600, unwritable), 600);
  assert.equal(loadHighScore(unwritable), 250);
});
