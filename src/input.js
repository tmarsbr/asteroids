// input.js — keyboard handling, blur cleanup, edge actions.
// Translates keyboard events into a clean input state object.

// Keys that have a continuous game function while playing.
const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space',
  'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyF',
  'KeyK',
]);

/**
 * Create an input manager bound to window.
 * `onAction(action)` is called for edge events: 'start', 'pause', 'restart'.
 * `getInput()` returns continuous state plus queued edge presses. The caller
 * acknowledges edge presses with `consumePresses()` after a simulation step,
 * so high-refresh frames with no fixed update never lose an ability input.
 */
export function createInputManager(window, onAction = () => {}) {
  const keys = {};
  const presses = {
    dash: false,
    shieldBurst: false,
    hyperspace: false,
    emp: false,
    nuke: false,
  };

  function isLeft()  { return !!(keys['ArrowLeft'] || keys['KeyA']); }
  function isRight() { return !!(keys['ArrowRight'] || keys['KeyD']); }
  function isThrust(){ return !!(keys['ArrowUp'] || keys['KeyW']); }
  function isBrake() { return !!(keys['ArrowDown'] || keys['KeyS']); }
  function isFire()  { return !!keys['Space']; }

  function getInput() {
    return {
      rotLeft: isLeft(),
      rotRight: isRight(),
      thrust: isThrust(),
      brake: isBrake(),
      fire: isFire(),
      dash: presses.dash,
      shieldBurst: presses.shieldBurst,
      hyperspace: presses.hyperspace,
      emp: presses.emp,
      nuke: presses.nuke,
    };
  }

  function consumePresses() {
    presses.dash = false;
    presses.shieldBurst = false;
    presses.hyperspace = false;
    presses.emp = false;
    presses.nuke = false;
  }

  function clear() {
    for (const k of Object.keys(keys)) delete keys[k];
    presses.dash = false;
    presses.shieldBurst = false;
    presses.hyperspace = false;
    presses.emp = false;
    presses.nuke = false;
  }

  function onKeyDown(e) {
    // Prevent default for game keys only while a session is active,
    // so arrow/space scrolling still works on the start/game-over screens.
    if (GAME_KEYS.has(e.code) && onAction.__active) {
      e.preventDefault();
    }

    // Edge actions: fire once on keydown, not repeat
    if (e.repeat) return;

    if (e.code === 'Enter') {
      onAction('start');
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      onAction('pause');
      return;
    }
    if (e.code === 'KeyR') {
      onAction('restart');
      return;
    }

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      presses.dash = true;
      return;
    }
    if (e.code === 'KeyE') {
      presses.shieldBurst = true;
      return;
    }
    if (e.code === 'KeyQ') {
      presses.hyperspace = true;
      return;
    }
    if (e.code === 'KeyF') {
      presses.emp = true;
      return;
    }
    if (e.code === 'KeyK') {
      presses.nuke = true;
      return;
    }

    keys[e.code] = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onBlur() {
    clear();
    onAction('blur');
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    getInput,
    consumePresses,
    clear,
    /** Let the input manager know whether a game session is active,
     *  so it can decide whether to preventDefault on movement keys. */
    setActive(active) { onAction.__active = !!active; },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
