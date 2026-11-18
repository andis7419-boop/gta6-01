// Input never reads `world` — it only reports what the player did.
// main.js / vehicles.js decide what an action means.
//
// Actions are the keys of KEY_BINDINGS (config.js). Keyboard is read via
// `code` (not `key`) so the layout does not matter; arrow keys mirror WASD.
// Mouse look uses pointer lock on the canvas while playing: click to lock,
// Esc unlocks (which the game treats as pause).
//
// The returned object exposes a public `scripted` field (null in normal
// play). When the shots autopilot assigns a scripted action set, isDown /
// wasPressed answer from it instead of the physical keys, and getLookDelta
// returns its deltas. A scripted set looks like:
//   { down: ['forward', 'sprint'], pressed: ['enterCar'],
//     lookDx: 0.4, lookDy: -0.1 }
// where `down` / `pressed` may be an Array, a Set, or an object map of
// action -> true. A scripted press fires for exactly one tick, like a
// physical key: updateInput snapshots it, then clears it.

const ARROW_TO_ACTION = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const MOUSE_BUTTON_TO_CODE = {
  0: 'MouseLeft',
  1: 'MouseMiddle',
  2: 'MouseRight',
};

// True when `container` (Array, Set, or plain object map) holds `action`.
function _holds(container, action) {
  if (!container) return false;
  if (typeof container.has === 'function') return container.has(action);
  if (Array.isArray(container)) return container.indexOf(action) !== -1;
  return container[action] === true;
}

// Remove `action` from a scripted container, whatever its shape.
function _drop(container, action) {
  if (!container) return;
  if (typeof container.delete === 'function') {
    container.delete(action);
    return;
  }
  if (Array.isArray(container)) {
    const i = container.indexOf(action);
    if (i !== -1) container.splice(i, 1);
    return;
  }
  if (container[action]) delete container[action];
}

// Empty a scripted `pressed` container after it has been snapshotted.
function _clearPressed(container) {
  if (!container) return;
  if (typeof container.clear === 'function') {
    container.clear();
    return;
  }
  if (Array.isArray(container)) {
    container.length = 0;
    return;
  }
  for (const k of Object.keys(container)) delete container[k];
}

export function createInput(canvas, keyBindings) {
  const bindings = keyBindings || {};
  // Reverse map: physical code ('KeyW', 'MouseLeft', ...) -> action name.
  const codeToAction = new Map();
  for (const action of Object.keys(bindings)) {
    codeToAction.set(bindings[action], action);
  }

  const input = {
    canvas,
    bindings,
    // True while the game is on the play screen; main.js sets this.
    // Pointer lock and preventDefault only apply while playing.
    playing: false,
    // True while the pointer is locked to the canvas.
    locked: false,
    // Public scripted-action override; null in normal play (see header).
    scripted: null,
    down: new Set(),
    pressed: new Set(),
    pressedTick: new Set(),
    lookDx: 0,
    lookDy: 0,
    lookTickDx: 0,
    lookTickDy: 0,
    mouseX: 0,
    mouseY: 0,
  };

  function actionForCode(code) {
    return codeToAction.get(code) || ARROW_TO_ACTION[code] || null;
  }

  function press(action) {
    if (!input.down.has(action)) input.pressed.add(action);
    input.down.add(action);
  }

  function release(action) {
    input.down.delete(action);
  }

  function onKeyDown(event) {
    const action = actionForCode(event.code);
    if (!action) return;
    if (input.playing) event.preventDefault();
    if (!event.repeat) press(action);
  }

  function onKeyUp(event) {
    const action = actionForCode(event.code);
    if (!action) return;
    if (input.playing) event.preventDefault();
    release(action);
  }

  function onMouseDown(event) {
    const code = MOUSE_BUTTON_TO_CODE[event.button];
    const action = code ? actionForCode(code) : null;
    if (action) press(action);
    if (input.playing && event.button === 0 && canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }

  function onMouseUp(event) {
    const code = MOUSE_BUTTON_TO_CODE[event.button];
    const action = code ? actionForCode(code) : null;
    if (action) release(action);
  }

  function onMouseMove(event) {
    input.mouseX = event.clientX;
    input.mouseY = event.clientY;
    if (input.locked) {
      input.lookDx += event.movementX || 0;
      input.lookDy += event.movementY || 0;
    }
  }

  function onPointerLockChange() {
    input.locked = typeof document !== 'undefined'
      && document.pointerLockElement === canvas;
  }

  function onBlur() {
    input.down.clear();
    input.pressed.clear();
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);
  }
  if (canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);
  }

  // Lets main.js detach every listener (teardown / hot restart).
  input._detach = function detachInput() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    }
    if (canvas) {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
    }
  };

  return input;
}

// Move this frame's fresh presses into the tick snapshot and clear the
// queue; mouse-look deltas are snapshotted the same way. Called once per
// fixed step, first in the update order (DESIGN section 2.3).
export function updateInput(input) {
  input.pressedTick = new Set(input.pressed);
  input.pressed.clear();
  input.lookTickDx = input.lookDx;
  input.lookTickDy = input.lookDy;
  input.lookDx = 0;
  input.lookDy = 0;
  // A scripted press fires for exactly one tick, like a physical key.
  if (input.scripted && input.scripted.pressed) {
    const sp = input.scripted.pressed;
    const names = typeof sp.has === 'function'
      ? Array.from(sp)
      : Array.isArray(sp) ? sp : Object.keys(sp).filter((k) => sp[k]);
    for (const action of names) input.pressedTick.add(action);
    _clearPressed(input.scripted.pressed);
  }
}

export function isDown(input, action) {
  if (input.scripted) return _holds(input.scripted.down, action);
  return input.down.has(action);
}

export function wasPressed(input, action) {
  // Scripted presses assigned after the last updateInput are merged into
  // pressedTick by the next updateInput, so they fire exactly once, on
  // the following tick — the same as a physical key pressed mid-tick.
  return input.pressedTick.has(action);
}

// Mouse-look deltas for this tick (pixels). Scripted deltas are consumed
// once, like physical movement; the physical snapshot is readable by every
// consumer inside the tick and is replaced by the next updateInput.
export function getLookDelta(input) {
  if (input.scripted && (input.scripted.lookDx || input.scripted.lookDy)) {
    const delta = { dx: input.scripted.lookDx || 0, dy: input.scripted.lookDy || 0 };
    input.scripted.lookDx = 0;
    input.scripted.lookDy = 0;
    return delta;
  }
  return { dx: input.lookTickDx, dy: input.lookTickDy };
}

export function getAimPoint(input) {
  return { x: input.mouseX, y: input.mouseY };
}

export function consumeAction(input, action) {
  input.down.delete(action);
  input.pressedTick.delete(action);
  input.pressed.delete(action);
  if (input.scripted) _drop(input.scripted.down, action);
}
