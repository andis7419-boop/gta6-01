export const SAVE_KEY = 'solmar-bay-save-v1';
export const SAVE_VERSION = 1;
export const AUTOSAVE_INTERVAL = 30;
const SAFEHOUSE_FALLBACK = { x: -252, z: -120 };
let _memoryCopy = null;
let _saveUnavailable = false;
let _lastAutosaveClock = 0;
let _lastCmpJson = '';
const _isBool = (v) => typeof v === 'boolean';
const _isNum = (v) => typeof v === 'number' && isFinite(v);
const _isStr = (v) => typeof v === 'string';
function _storage() { try { return (typeof localStorage === 'undefined' || localStorage === null)
      ? null : localStorage;
  } catch (e) { return null; }
}
export function getSafehousePos(world) { const districts = world && world.city && world.city.districts;
  if (districts) { for (let i = 0; i < districts.length; i++) { const d = districts[i];
      if (d.name === 'Marina Quarter') { return { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 };
      }
    }
  }
  return { x: SAFEHOUSE_FALLBACK.x, z: SAFEHOUSE_FALLBACK.z };
}
export function buildSaveData(world) { const p = world.player || {};
  const s = world.stats || {};
  const f = world.flags || {};
  const m = world.mission || {};
  return { version: SAVE_VERSION, seed: _isNum(world.seed) ? world.seed : 1, cash: _isNum(p.cash) ? Math.floor(p.cash) : 0,
    missionsDone: Array.isArray(m.doneIds) ? m.doneIds.slice() : [], activeMission: m.activeId || null,
    flags: { metRosa: !!f.metRosa, harbourOpen: !!f.harbourOpen, ownsPistol: !!f.ownsPistol,
      debtCleared: !!f.debtCleared, }, player: { health: _isNum(p.health) ? Math.round(p.health) : 100,
      armour: _isNum(p.armour) ? Math.round(p.armour) : 0, weapon: _isStr(p.weapon) ? p.weapon : 'fists',
      ammo: _isNum(p.ammo) ? Math.floor(p.ammo) : 0, }, stats: { carsStolen: _isNum(s.carsStolen) ? s.carsStolen : 0,
      distanceDriven: _isNum(s.distanceDriven) ? Math.round(s.distanceDriven) : 0,
      copsEvaded: _isNum(s.copsEvaded) ? s.copsEvaded : 0, shotsFired: _isNum(s.shotsFired) ? s.shotsFired : 0,
      bestCash: _isNum(s.bestCash) ? Math.floor(s.bestCash) : 0, }, muted: !!world.muted, savedClock: _isNum(world.clock) ? Math.floor(world.clock) : 0, };
}
const _nums = (o, ks) => !!o && ks.every((k) => _isNum(o[k]));
const _bools = (o, ks) => !!o && ks.every((k) => _isBool(o[k]));
export function validateSave(d) { if (!d || typeof d !== 'object' || d.version !== SAVE_VERSION) return null;
  if (!_isNum(d.seed) || !_isNum(d.cash) || !Array.isArray(d.missionsDone)) return null;
  if (d.missionsDone.some((m) => !_isStr(m))) return null;
  if (d.activeMission !== null && !_isStr(d.activeMission)) return null;
  if (!_bools(d.flags, ['metRosa', 'harbourOpen', 'ownsPistol'])) return null;
  if (!_nums(d.player, ['health', 'armour', 'ammo']) || !_isStr(d.player.weapon)) return null;
  if (!_nums(d.stats, ['carsStolen', 'distanceDriven', 'copsEvaded', 'shotsFired', 'bestCash'])) return null;
  if (!_isBool(d.muted) || !_isNum(d.savedClock)) return null;
  return d;
}
export function saveGame(world) { let data;
  try { data = buildSaveData(world); } catch (e) { return false; }
  const json = JSON.stringify(data);
  _memoryCopy = json;
  _lastCmpJson = JSON.stringify({ ...data, savedClock: 0 });
  _lastAutosaveClock = world.clock || 0;
  const store = _storage();
  if (!store) { _saveUnavailable = true; return false; }
  try { store.setItem(SAVE_KEY, json); } catch (e) { _saveUnavailable = true;
    return false;
  }
  return true;
}
export function loadGame() { const store = _storage();
  let json = null;
  if (store) { try { json = store.getItem(SAVE_KEY); } catch (e) { json = null; }
    if (json == null) return null;
  } else { json = _memoryCopy;
    if (json == null) return null;
  }
  let data;
  try { data = JSON.parse(json); } catch (e) { return null; }
  return validateSave(data);
}
export function hasSave() { return loadGame() !== null; }
export function clearSave() { _memoryCopy = null;
  _lastCmpJson = '';
  const store = _storage();
  if (store) { try { store.removeItem(SAVE_KEY); } catch (e) {  }
  }
}
export function applySaveToWorld(world, saved) { const data = saved || loadGame();
  if (!data) return false;
  if (!world.player) world.player = {};
  if (!world.stats) world.stats = {};
  if (!world.flags) world.flags = {};
  if (!world.mission) world.mission = {};
  if (!world.police) world.police = {};
  world.seed = data.seed;
  const safe = getSafehousePos(world);
  Object.assign(world.player, { cash: data.cash, health: data.player.health, armour: data.player.armour,
    weapon: data.player.weapon, ammo: data.player.ammo, onFoot: true,
    vehicleId: null, wantedHeat: 0, heading: 0, speed: 0, pos: { x: safe.x, y: 0, z: safe.z }, });
  Object.assign(world.mission, { doneIds: data.missionsDone.slice(), activeId: null, stage: 0, objectives: [], briefing: '', timer: null, reward: 0, });
  Object.assign(world.flags, { metRosa: data.flags.metRosa, harbourOpen: data.flags.harbourOpen,
    ownsPistol: data.flags.ownsPistol, debtCleared: !!data.flags.debtCleared, });
  Object.assign(world.stats, { carsStolen: data.stats.carsStolen, distanceDriven: data.stats.distanceDriven,
    copsEvaded: data.stats.copsEvaded, shotsFired: data.stats.shotsFired, bestCash: data.stats.bestCash, });
  Object.assign(world.police, { wanted: 0, heat: 0, escapeTimer: 0, bustTimer: 0 });
  world.muted = data.muted;
  return true;
}
export function autosaveIfDue(world, dt) { if (!world || world.screen === 'title') return false;
  const clock = world.clock || 0;
  if (clock - _lastAutosaveClock < AUTOSAVE_INTERVAL) return false;
  let data;
  try { data = buildSaveData(world); } catch (e) { return false; }
  if (JSON.stringify({ ...data, savedClock: 0 }) === _lastCmpJson) { _lastAutosaveClock = clock;
    return false;
  }
  return saveGame(world);
}
export function _resetAutosaveForTests() { _lastAutosaveClock = 0;
  _lastCmpJson = '';
  _memoryCopy = null;
  _saveUnavailable = false;
}
