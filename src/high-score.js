// high-score.js — fault-tolerant, versioned browser persistence.

export const HIGH_SCORE_STORAGE_KEY = 'asteroids.high-score.v1';

/**
 * Convert an external value into a non-negative, safe integer score.
 * Invalid values are represented by zero so callers never expose NaN,
 * Infinity, fractions, or unsafe integers to the game state.
 */
export function normalizeHighScore(value) {
  let number;

  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    number = Number(value);
  } else {
    return 0;
  }

  if (!Number.isSafeInteger(number) || number < 0) return 0;
  return number === 0 ? 0 : number;
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readHighScore(storage) {
  if (!storage) return { readable: false, value: 0 };

  try {
    if (typeof storage.getItem !== 'function') {
      return { readable: false, value: 0 };
    }
    return {
      readable: true,
      value: normalizeHighScore(
        storage.getItem(HIGH_SCORE_STORAGE_KEY)
      ),
    };
  } catch {
    return { readable: false, value: 0 };
  }
}

/** Load the persisted record, returning zero when storage is unavailable. */
export function loadHighScore(storage) {
  return readHighScore(resolveStorage(storage)).value;
}

/**
 * Persist a record only when it is greater than the readable stored value.
 * The returned value is the best known record even when persistence fails.
 */
export function saveHighScore(value, storage) {
  const candidate = normalizeHighScore(value);
  const target = resolveStorage(storage);
  const stored = readHighScore(target);

  if (!stored.readable) return candidate;

  const best = Math.max(stored.value, candidate);
  if (best === stored.value) return best;

  try {
    if (typeof target.setItem === 'function') {
      target.setItem(HIGH_SCORE_STORAGE_KEY, String(best));
    }
  } catch {
    // Persistence is best-effort; gameplay must continue in restricted modes.
  }

  return best;
}
