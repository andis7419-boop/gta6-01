import { createRng } from './random.js';
import { addHeat } from './police.js';
import { spawnEnemies, enemyCount } from './combat.js';
import { MISSION_LIST } from './config.js';
export { MISSION_LIST };
const MARINA = ['Marina Quarter', -54, 42];
const MARKET = ['Market Mile', -12, -12];
const PALM = ['Palm Row', 24, -18];
const HARBOUR = ['Harbour Yards', 0, 0];
const HILLS = ['North Hills', 0, 0];
const MISSION_LOCATIONS = { m1: [MARINA, MARKET], m2: [PALM, HARBOUR], m3: [['Market Mile', 0, -40], MARINA],
  m4: [['Palm Row', -30, 30], MARINA], m5: [HILLS], m6: [MARINA, MARINA], m7: [HILLS, MARINA], };
const MISSION_TIMERS = { m5: 150 };
const MISSION_ORDER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
let _rt = null;
function _emit(emit, type, payload) { if (typeof emit === 'function') emit(type, payload);
}
function _dist2(ax, az, bx, bz) { const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
function _districtCentre(world, name) { const districts = world.city && world.city.districts;
  if (!districts) return null;
  for (let i = 0; i < districts.length; i++) { const d = districts[i];
    if (d.name === name) return { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 };
  }
  return null;
}
function _resolveLoc(world, loc) { const name = Array.isArray(loc) ? loc[0] : loc.district;
  const dx = Array.isArray(loc) ? (loc[1] || 0) : (loc.dx || 0);
  const dz = Array.isArray(loc) ? (loc[2] || 0) : (loc.dz || 0);
  if (name) { const c = _districtCentre(world, name);
    if (c) return { x: c.x + dx, z: c.z + dz };
  }
  return { x: loc.x || 0, z: loc.z || 0 };
}
function _resolveTarget(world, def, index) { const loc = (MISSION_LOCATIONS[def.id] || [])[index];
  if (loc) return _resolveLoc(world, loc);
  return _resolveLoc(world, def.objectives[index] || {});
}
function _ensureMissionState(world) { if (!world.mission) world.mission = {};
  if (!Array.isArray(world.mission.doneIds)) world.mission.doneIds = [];
  if (!Array.isArray(world.mission.objectives)) world.mission.objectives = [];
  if (world.mission.activeId === undefined) world.mission.activeId = null;
  if (world.mission.stage === undefined) world.mission.stage = 0;
  if (world.mission.briefing === undefined) world.mission.briefing = '';
  if (world.mission.timer === undefined) world.mission.timer = null;
  if (world.mission.reward === undefined) world.mission.reward = 0;
}
function _missionDef(id) { for (let i = 0; i < MISSION_LIST.length; i++) { if (MISSION_LIST[i].id === id) return MISSION_LIST[i];
  }
  return null;
}
function _spawnMissionVehicle(world, missionId, tag, kind, make, model, x, z, heading, colour) { const v = {
    id: 'mission-' + missionId + '-' + tag, make: make, model: model, kind: kind, pos: { x: x, y: 0, z: z }, heading: heading, speed: 0, steer: 0,
    colour: colour, state: 'mission', health: 100, stolen: false, driver: 'mission', lightsOn: false, };
  if (!world.vehicles) world.vehicles = [];
  const existing = world.vehicles.find((veh) => veh.id === v.id);
  if (!existing) world.vehicles.push(v);
  return existing || v;
}
function _vehicleById(world, id) { if (!id || !world.vehicles) return null;
  for (let i = 0; i < world.vehicles.length; i++) { if (world.vehicles[i].id === id) return world.vehicles[i];
  }
  return null;
}
function _stageForObjective(world, def, index) { const obj = world.mission.objectives[index];
  if (!obj) return;
  const target = obj.target || { x: 0, z: 0 };
  if (obj.type === 'shootout') { const count = obj.count || 3;
    spawnEnemies(world, target.x, target.z, count);
    obj.armed = true;
    obj.remaining = count;
    return;
  }
  if (def.id === 'm1' && index === 0) { const taxi = _spawnMissionVehicle(world, 'm1', 'taxi', 'taxi', 'Veltor', 'Cab', target.x, target.z, 0, 0xf2c14e);
    if (world.mission.objectives[1]) world.mission.objectives[1].vehicleId = taxi.id;
  } else if (def.id === 'm2' && index === 0) { const comet = _spawnMissionVehicle(world, 'm2', 'comet', 'sport', 'Veltor', 'Comet',
      target.x, target.z, 0, 0xc0392b);
    obj.vehicleId = comet.id;
    if (world.mission.objectives[1]) world.mission.objectives[1].vehicleId = comet.id;
  } else if (def.id === 'm3' && index === 0) {
    const van = _spawnMissionVehicle(world, 'm3', 'van', 'van', 'Harbour', 'Hauler', target.x, target.z, 0, 0x7f8c8d);
    _rt.vanId = van.id;
    const rng = createRng((world.seed || 1) + 303);
    const cx = target.x;
    const cz = target.z;
    const loop = [ { x: cx - 60, z: cz - 60 }, { x: cx + 60, z: cz - 60 }, { x: cx + 60, z: cz + 60 }, { x: cx - 60, z: cz + 60 }, ];
    _rt.vanRoute = rng.chance(0.5) ? loop : loop.slice().reverse();
    _rt.vanWp = 0;
    _rt.followTime = 0;
    _rt.spottedTime = 0;
  } else if (def.id === 'm5' && index === 0) { const start = _resolveLoc(world, HARBOUR);
    const van = _spawnMissionVehicle(world, 'm5', 'van', 'van', 'Harbour', 'Hauler', start.x, start.z, 0, 0x2e86c1);
    obj.vehicleId = van.id;
  } else if (def.id === 'm7' && index === 0) { const car = _spawnMissionVehicle(world, 'm7', 'getaway', 'sport', 'Veltor', 'Comet',
      target.x, target.z, 0, 0x1a1a1a);
    _rt.chaseId = car.id;
  }
}
export function getActiveMission(world) { _ensureMissionState(world);
  if (!world.mission.activeId) return null;
  return _missionDef(world.mission.activeId);
}
export function nextMissionId(world) { _ensureMissionState(world);
  for (let i = 0; i < MISSION_ORDER.length; i++) { if (world.mission.doneIds.indexOf(MISSION_ORDER[i]) === -1) return MISSION_ORDER[i];
  }
  return null;
}
export function getNextMissionMarker(world) { _ensureMissionState(world);
  if (world.mission.activeId) { const obj = world.mission.objectives[world.mission.stage];
    if (obj && obj.target) return { x: obj.target.x, z: obj.target.z, kind: 'objective' };
  }
  const next = nextMissionId(world);
  if (!next) return null;
  return { x: -252, z: -120, kind: 'phone', missionId: next };
}
export function awardCash(world, amount, emit) { if (!world.player) world.player = { cash: 0 };
  world.player.cash = (world.player.cash || 0) + amount;
  if (!world.stats) world.stats = {};
  if (typeof world.stats.bestCash !== 'number') world.stats.bestCash = 0;
  if (world.player.cash > world.stats.bestCash) world.stats.bestCash = world.player.cash;
  _emit(emit, 'cash-changed', { cash: world.player.cash, delta: amount });
  return world.player.cash;
}
export function startMission(world, missionId, emit, startStage) { _ensureMissionState(world);
  if (world.mission.activeId) return false;
  const def = _missionDef(missionId);
  if (!def) return false;
  const stage = (typeof startStage === 'number' && startStage >= 0 && startStage < def.objectives.length) ? startStage : 0;
  world.mission.activeId = def.id;
  world.mission.stage = stage;
  world.mission.briefing = def.briefing;
  world.mission.reward = def.reward;
  world.mission.timer = MISSION_TIMERS[def.id] || (typeof def.timer === 'number' ? def.timer : null);
  world.mission.lastFailed = null;
  world.mission.objectives = def.objectives.map((o, i) => { const defRadius = o.type === 'follow' ? 45 : (o.type === 'chase' ? 60 : 8);
    const copy = { type: o.type, label: o.label, target: _resolveTarget(world, def, i), radius: o.radius || defRadius, done: false, timer: null, };
    const opt = ['timer', 'followSeconds', 'spotDist', 'spotSeconds', 'count'];
    for (let j = 0; j < opt.length; j++) { if (typeof o[opt[j]] === 'number') copy[opt[j]] = o[opt[j]];
    }
    return copy;
  });
  _rt = { vanId: null, vanRoute: null, vanWp: 0, followTime: 0, spottedTime: 0, chaseId: null, escapeElapsed: 0, stageElapsed: 0, };
  if (!world.flags) world.flags = {};
  if (def.id === 'm1') world.flags.metRosa = true;
  if (def.id === 'm6') addHeat(world, 55);
  _stageForObjective(world, def, stage);
  _emit(emit, 'mission-started', { missionId: def.id, label: def.title, reward: def.reward, });
  return true;
}
export function completeObjective(world, index, emit) { _ensureMissionState(world);
  const obj = world.mission.objectives[index];
  if (!obj || obj.done) return false;
  obj.done = true;
  _emit(emit, 'objective-done', { missionId: world.mission.activeId, label: obj.label, stage: index, });
  const def = _missionDef(world.mission.activeId);
  world.mission.stage = index + 1;
  if (_rt) { _rt.stageElapsed = 0; _rt.escapeElapsed = 0; }
  if (world.mission.stage >= world.mission.objectives.length) { _completeMission(world, emit);
    return true;
  }
  if (def) _stageForObjective(world, def, world.mission.stage);
  return true;
}
function _completeMission(world, emit) { const def = _missionDef(world.mission.activeId);
  if (!def) return;
  awardCash(world, def.reward, emit);
  if (!world.stats) world.stats = {};
  world.stats.missionsDone = (world.stats.missionsDone || 0) + 1;
  world.mission.doneIds.push(def.id);
  if (!world.flags) world.flags = {};
  if (def.id === 'm4') { world.flags.ownsPistol = true;
    world.player.weapon = 'pistol';
    world.player.ammo = (world.player.ammo || 0) + 48;
  }
  if (def.id === 'm7') { world.flags.debtCleared = true;
    world.flags.harbourOpen = true;
  }
  _emit(emit, 'mission-done', { missionId: def.id, label: def.title, reward: def.reward, });
  world.mission.activeId = null;
  world.mission.stage = 0;
  world.mission.objectives = [];
  world.mission.briefing = '';
  world.mission.timer = null;
  world.mission.reward = 0;
  _rt = null;
}
export function failMission(world, reason, emit) { _ensureMissionState(world);
  if (!world.mission.activeId) return false;
  const id = world.mission.activeId;
  const stage = world.mission.stage;
  world.mission.lastFailed = { missionId: id, stage: stage, reason: reason };
  _emit(emit, 'mission-failed', { missionId: id, label: reason, reward: 0 });
  world.mission.activeId = null;
  world.mission.stage = 0;
  world.mission.objectives = [];
  world.mission.briefing = '';
  world.mission.timer = null;
  world.mission.reward = 0;
  _rt = null;
  return true;
}
export function retryMission(world, emit) { _ensureMissionState(world);
  const last = world.mission.lastFailed;
  if (!last) return false;
  return startMission(world, last.missionId, emit, last.stage);
}
function _moveVehicleToward(world, vehicle, tx, tz, speed, dt) { const dx = tx - vehicle.pos.x;
  const dz = tz - vehicle.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.5) return true;
  const step = Math.min(d, speed * dt);
  vehicle.pos.x += (dx / d) * step;
  vehicle.pos.z += (dz / d) * step;
  vehicle.heading = Math.atan2(dx, -dz);
  vehicle.speed = speed;
  return d - step < 0.5;
}
export function updateMission(world, dt, emit) { _ensureMissionState(world);
  if (!world.mission.activeId) return;
  if (world.screen && world.screen !== 'play') return;
  if (!_rt) { _rt = { vanId: null, vanRoute: null, vanWp: 0, followTime: 0, spottedTime: 0, chaseId: null, escapeElapsed: 0, stageElapsed: 0 };
  }
  _rt.stageElapsed += dt;
  if (typeof world.mission.timer === 'number') { world.mission.timer -= dt;
    if (world.mission.timer <= 0) { world.mission.timer = 0;
      failMission(world, 'Time ran out', emit);
      return;
    }
  }
  const def = _missionDef(world.mission.activeId);
  if (!def) return;
  for (let i = 0; i < world.mission.objectives.length; i++) { const vid = world.mission.objectives[i].vehicleId;
    const veh = vid ? _vehicleById(world, vid) : null;
    if (veh && veh.health <= 0) { failMission(world, 'The car was wrecked', emit);
      return;
    }
  }
  const obj = world.mission.objectives[world.mission.stage];
  if (!obj) return;
  if (typeof obj.timer === 'number') { obj.timer -= dt;
    if (obj.timer <= 0) { failMission(world, 'Time ran out', emit);
      return;
    }
  }
  const p = world.player;
  const px = p ? p.pos.x : 0;
  const pz = p ? p.pos.z : 0;
  const r2 = (obj.radius || 8) * (obj.radius || 8);
  if (obj.type === 'goto' || obj.type === 'pickup') { if (_dist2(px, pz, obj.target.x, obj.target.z) <= r2) {
      completeObjective(world, world.mission.stage, emit);
    }
    return;
  }
  if (obj.type === 'drive' || obj.type === 'deliver') { if (p && !p.onFoot && (!obj.vehicleId || p.vehicleId === obj.vehicleId) &&
      _dist2(px, pz, obj.target.x, obj.target.z) <= r2) { completeObjective(world, world.mission.stage, emit);
    }
    return;
  }
  if (obj.type === 'follow') { const van = _rt.vanId ? _vehicleById(world, _rt.vanId) : null;
    if (!van) return;
    if (_rt.vanRoute && _rt.vanRoute.length > 0) { const wp = _rt.vanRoute[_rt.vanWp % _rt.vanRoute.length];
      if (_moveVehicleToward(world, van, wp.x, wp.z, 8, dt)) _rt.vanWp += 1;
    }
    const d2 = _dist2(px, pz, van.pos.x, van.pos.z);
    const followR = (obj.radius || 45);
    if (d2 <= followR * followR) { _rt.followTime += dt;
      if (d2 <= (obj.spotDist || 10) * (obj.spotDist || 10)) { _rt.spottedTime += dt;
        if (_rt.spottedTime >= (obj.spotSeconds || 3)) { failMission(world, 'You were spotted', emit);
          return;
        }
      }
      if (_rt.followTime >= (obj.followSeconds || 20)) { completeObjective(world, world.mission.stage, emit);
      }
    }
    return;
  }
  if (obj.type === 'shootout') { if (obj.armed) { const left = enemyCount(world);
      obj.remaining = left;
      obj.label = 'Clear out the Kings lock-up (' + left + ' left)';
      if (left <= 0) completeObjective(world, world.mission.stage, emit);
    }
    return;
  }
  if (obj.type === 'escape') { _rt.escapeElapsed += dt;
    const wanted = world.police ? world.police.wanted : 0;
    if (wanted === 0 && _rt.escapeElapsed >= 5) { completeObjective(world, world.mission.stage, emit);
    }
    return;
  }
  if (obj.type === 'chase') { const car = _rt.chaseId ? _vehicleById(world, _rt.chaseId) : null;
    if (!car) return;
    if (car.health <= 0) { completeObjective(world, world.mission.stage, emit);
      return;
    }
    const dx = car.pos.x - px;
    const dz = car.pos.z - pz;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const weave = Math.sin((world.clock || 0) * 0.7) * 0.45;
    const nx = dx / d + -dz / d * weave;
    const nz = dz / d + dx / d * weave;
    const nl = Math.sqrt(nx * nx + nz * nz) || 1;
    const speed = 16;
    car.pos.x = Math.max(-280, Math.min(280, car.pos.x + (nx / nl) * speed * dt));
    car.pos.z = Math.max(-280, Math.min(280, car.pos.z + (nz / nl) * speed * dt));
    car.heading = Math.atan2(nx / nl, -(nz / nl));
    car.speed = speed;
  }
}
