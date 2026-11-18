// save.js — persistence for Solmar Bay (W4).
// The ONLY module that touches localStorage. Key 'solmar-bay-save-v1'.
// Shape is DESIGN §5.1: version 1, seed, cash, missionsDone (array),
// activeMission, flags, player, stats, muted, savedClock in SIM seconds.
// loadGame() rejects version !== 1 or bad field types and returns null.
// Storage failures are swallowed: saveGame() returns false, the game keeps
// an in-memory copy, and save.saveUnavailable flags the HUD warning.

export const SAVE_KEY = 'solmar-bay-save-v1';
export const AUTOSAVE_INTERVAL = 30; // sim seconds between autosaves

// HUD reads this flag to show "Save unavailable — progress kept for this
// session" once (see hud.js / main.js). lastSavedClock is the sim clock of
// the last successful write, so the HUD can show a "Saved" note.
export const save = { saveUnavailable: false, lastSavedClock: 0 };

let memoryCopy = null;
let autosaveClock = 0;

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch (err) {
    return null;
  }
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBool(v) {
  return typeof v === 'boolean';
}

function isStr(v) {
  return typeof v === 'string';
}

function validFlags(f) {
  return f && typeof f === 'object'
    && isBool(f.metRosa) && isBool(f.harbourOpen) && isBool(f.ownsPistol);
}

function validPlayer(p) {
  return p && typeof p === 'object'
    && isNum(p.health) && isNum(p.armour)
    && isStr(p.weapon) && isNum(p.ammo);
}

function validStats(s) {
  return s && typeof s === 'object'
    && isNum(s.carsStolen) && isNum(s.distanceDriven)
    && isNum(s.copsEvaded) && isNum(s.shotsFired) && isNum(s.bestCash);
}

export function validateSave(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== 1) return false;
  if (!isNum(data.seed) || !isNum(data.cash)) return false;
  if (!Array.isArray(data.missionsDone)
    || !data.missionsDone.every(isStr)) return false;
  if (data.activeMission !== null && !isStr(data.activeMission)) return false;
  if (!validFlags(data.flags)) return false;
  if (!validPlayer(data.player)) return false;
  if (!validStats(data.stats)) return false;
  if (!isBool(data.muted) || !isNum(data.savedClock)) return false;
  return true;
}

export function buildSaveData(world) {
  const done = Array.isArray(world.mission.doneIds)
    ? [...world.mission.doneIds] : [];
  return {
    version: 1,
    seed: world.seed,
    cash: world.player.cash,
    missionsDone: done,
    activeMission: world.mission.activeId || null,
    flags: {
      metRosa: !!world.flags.metRosa,
      harbourOpen: !!world.flags.harbourOpen,
      ownsPistol: !!world.flags.ownsPistol,
      debtCleared: !!world.flags.debtCleared,
    },
    player: {
      health: world.player.health,
      armour: world.player.armour,
      weapon: world.player.weapon,
      ammo: world.player.ammo,
    },
    stats: {
      carsStolen: world.stats.carsStolen,
      distanceDriven: world.stats.distanceDriven,
      copsEvaded: world.stats.copsEvaded,
      shotsFired: world.stats.shotsFired,
      bestCash: world.stats.bestCash,
    },
    muted: !!world.muted,
    savedClock: world.clock,
  };
}

export function saveGame(world) {
  const data = buildSaveData(world);
  memoryCopy = data;
  const store = storage();
  if (!store) {
    save.saveUnavailable = true;
    return false;
  }
  try {
    store.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    save.saveUnavailable = true;
    return false;
  }
  save.saveUnavailable = false;
  save.lastSavedClock = data.savedClock;
  world.saveDirty = false;
  return true;
}

// Mark the world dirty so the next autosave window (or a forced save)
// persists it. Used by missions on completion and by main on pause.
export function markSaveDirty(world) {
  world.saveDirty = true;
}

export function loadGame() {
  const store = storage();
  let raw = null;
  if (store) {
    try {
      raw = store.getItem(SAVE_KEY);
    } catch (err) {
      raw = null;
    }
  }
  if (raw === null || raw === undefined) {
    return memoryCopy && validateSave(memoryCopy) ? memoryCopy : null;
  }
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!validateSave(data)) return null;
  memoryCopy = data;
  return data;
}

export function clearSave() {
  memoryCopy = null;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch (err) {
    // Swallowed: a missing store is not a game error.
  }
}

export function hasSave() {
  const store = storage();
  if (store) {
    try {
      if (store.getItem(SAVE_KEY) !== null) return true;
    } catch (err) {
      // Fall through to the in-memory copy.
    }
  }
  return memoryCopy !== null;
}

// Called once per fixed step by main.js. Autosaves every 30 sim seconds
// when the world is dirty; pass force=true on pause / mission completion.
export function autosaveIfDue(world, dt, force) {
  autosaveClock += dt;
  if (force) {
    autosaveClock = 0;
    return saveGame(world);
  }
  if (world.saveDirty && autosaveClock >= AUTOSAVE_INTERVAL) {
    autosaveClock = 0;
    return saveGame(world);
  }
  return false;
}

// Events drained by main.js after each fixed step. Mission completion and
// pausing save immediately, on top of the 30-second autosave window.
export function handleEvents(world, events) {
  for (const event of events) {
    if (event.type === 'mission-done') {
      saveGame(world);
    } else if (event.type === 'screen-changed'
      && event.payload && event.payload.screen === 'pause') {
      saveGame(world);
    }
  }
}
