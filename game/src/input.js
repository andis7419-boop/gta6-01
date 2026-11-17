import { ARROW_MIRRORS } from './config.js';
const MOUSE_ACTIONS = { 0: 'shoot', 2: 'aim' };
export function createInput(canvas, keyBindings, hooks = {}) { const bindings = keyBindings;
  const codeToAction = {};
  for (const [action, code] of Object.entries(bindings)) { if (typeof code === 'string' && !code.startsWith('Mouse')) { codeToAction[code] = action;
    }
  }
  const input = { canvas, bindings, hooks, down: new Set(), pressed: new Set(), pressedTick: new Set(), lookDx: 0,
    lookDy: 0, lookTickDx: 0, lookTickDy: 0, mouseX: 0, mouseY: 0, pointerLocked: false, };
  function actionForCode(code) { if (codeToAction[code]) return codeToAction[code];
    return ARROW_MIRRORS[code] || null;
  }
  function isGameKey(code) { return actionForCode(code) !== null || code === 'Space' || code.startsWith('Arrow');
  }
  function onKeyDown(e) { if (!isGameKey(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    const action = actionForCode(e.code);
    if (!action) return;
    if (!input.down.has(action)) input.pressed.add(action);
    input.down.add(action);
  }
  function onKeyUp(e) { const action = actionForCode(e.code);
    if (action) input.down.delete(action);
  }
  function onMouseDown(e) { const action = MOUSE_ACTIONS[e.button];
    if (action === undefined) return;
    e.preventDefault();
    if (!input.down.has(action)) input.pressed.add(action);
    input.down.add(action);
    if (canvas && canvas.requestPointerLock && !input.pointerLocked) { try { canvas.requestPointerLock();
      } catch (err) { }
    }
  }
  function onMouseUp(e) { const action = MOUSE_ACTIONS[e.button];
    if (action !== undefined) input.down.delete(action);
  }
  function onMouseMove(e) { input.mouseX = e.clientX;
    input.mouseY = e.clientY;
    if (input.pointerLocked) { input.lookDx += e.movementX || 0;
      input.lookDy += e.movementY || 0;
    }
  }
  function onContextMenu(e) { e.preventDefault();
  }
  function onPointerLockChange() { const locked = document.pointerLockElement === canvas;
    const wasLocked = input.pointerLocked;
    input.pointerLocked = locked;
    if (wasLocked && !locked && hooks.onLockLost) hooks.onLockLost();
  }
  function onBlur() { input.down.clear();
    input.pressed.clear();
    input.pressedTick.clear();
  }
  if (typeof window !== 'undefined') { window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);
  }
  if (canvas && canvas.addEventListener) { canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('contextmenu', onContextMenu);
  }
  input.destroy = function () { if (typeof window !== 'undefined') { window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    }
    if (canvas && canvas.removeEventListener) { canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('contextmenu', onContextMenu);
    }
  };
  return input;
}
export function updateInput(input) { input.pressedTick = new Set(input.pressed);
  input.pressed.clear();
  input.lookTickDx = input.lookDx;
  input.lookTickDy = input.lookDy;
  input.lookDx = 0;
  input.lookDy = 0;
}
export function isDown(input, action) { return input.down.has(action);
}
export function wasPressed(input, action) { return input.pressedTick.has(action);
}
export function getLookDelta(input) { return { dx: input.lookTickDx, dy: input.lookTickDy };
}
export function getAimPoint(input) { return { x: input.mouseX, y: input.mouseY };
}
export function consumeAction(input, action) { input.down.delete(action);
  input.pressed.delete(action);
  input.pressedTick.delete(action);
}
