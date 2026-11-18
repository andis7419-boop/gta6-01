// missions.js — story missions for Solmar Bay (W4).
// Owns the mission state machine: start / update / complete / fail,
// cash rewards, the phone offer between missions and the debt-cleared end.
// Only missions.update() may mark an objective done, and only by reading
// world state (player position, vehicle, targets, police, enemies).
// Money only ever changes here, through awardCash().

import { MISSION_LIST } from './config.js';
import { addHeat, clearWanted } from './police.js';
import { spawnEnemies, enemyCount } from './combat.js';
import { createVehicle } from './vehicles.js';
import { createRng } from './random.js';

const STORY_ORDER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];

// Fallback target points, used only when a MISSION_LIST objective carries
// no target of its own. All points sit on road centrelines of the city
// grid (pitch 72 m, city -288..288). Marina safehouse: (-252, -120).
const FALLBACK_TARGETS = {
  m1: [{ x: 144, z: 72 }, { x: 216, z: 108 }],
  m2: [{ x: -36, z: 36 }, { x: 0, z: 252 }],
  m3: [{ x: 180, z: 0 }, { x: -240, z: -96 }],
  m4: [{ x: -108, z: 72 }, { x: -252, z: -120 }],
  m5: [{ x: 216, z: -216 }],
  m6: [{ x: -252, z: -120 }],
  m7: [{ x: 180, z: -144 }, { x: -252, z: -120 }],
};

// Where the next job is offered: a phone marker near the Marina safehouse.
const PHONE_SPOT = { x: -228, z: -96 };
const PHONE_RADIUS = 7;
const FOLLOW_MIN = 8;
const FOLLOW_MAX = 32;
const FOLLOW_NEED = 10;

function emit(world, type, payload) {
  if (world.events && typeof world.events.emit === 'function') {
    world.events.emit(type, payload);
  }
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function findMissionDef(missionId) {
  for (const def of MISSION_LIST) {
    if (def.id === missionId) return def;
  }
  return null;
}

function doneIds(world) {
  if (!Array.isArray(world.mission.doneIds)) world.mission.doneIds = [];
  return world.mission.doneIds;
}

function currentObjective(world) {
  const m = world.mission;
  if (!m.activeId || !Array.isArray(m.objectives)) return null;
  return m.objectives[m.stage] || null;
}

function objectiveTarget(world, objective, index) {
  if (objective.target && typeof objective.target.x === 'number') {
    return objective.target;
  }
  const list = FALLBACK_TARGETS[world.mission.activeId] || [];
  return list[index] || list[0] || { x: 0, z: 0 };
}

function playerVehicle(world) {
  if (!world.player.vehicleId) return null;
  for (const v of world.vehicles) {
    if (v.id === world.player.vehicleId) return v;
  }
  return null;
}

function findVehicle(world, id) {
  if (id === null || id === undefined) return null;
  for (const v of world.vehicles) {
    if (v.id === id) return v;
  }
  return null;
}

function markDirty(world) {
  world.saveDirty = true;
}

export function getActiveMission(world) {
  if (!world.mission.activeId) return null;
  return findMissionDef(world.mission.activeId);
}

export function nextMissionId(world) {
  const done = doneIds(world);
  for (const id of STORY_ORDER) {
    if (!done.includes(id)) return id;
  }
  return null;
}

// Where the next job is offered on the map (phone blip), or null when the
// story is finished or a mission is already running.
export function getNextMissionOffer(world) {
  const next = nextMissionId(world);
  if (!next || world.mission.activeId) return null;
  return { missionId: next, x: PHONE_SPOT.x, z: PHONE_SPOT.z };
}

// Start the offered job when the player stands by the phone marker and
// presses E (or picks it from the pause menu). Returns true if started.
export function tryStartNearMarker(world) {
  const offer = getNextMissionOffer(world);
  if (!offer) return false;
  const d2 = dist2(world.player.pos.x, world.player.pos.z, offer.x, offer.z);
  if (d2 > PHONE_RADIUS * PHONE_RADIUS) return false;
  return startMission(world, offer.missionId);
}

export function startMission(world, missionId) {
  if (world.mission.activeId) return false;
  const def = findMissionDef(missionId);
  if (!def) return false;
  const rng = createRng(world.seed + 303);

  const objectives = (def.objectives || []).map((o, i) => ({
    type: o.type || 'goto',
    label: o.label || def.title || missionId,
    target: o.target
      ? { x: o.target.x, z: o.target.z }
      : { ...(FALLBACK_TARGETS[missionId] || [{ x: 0, z: 0 }])[i] || { x: 0, z: 0 } },
    radius: typeof o.radius === 'number' ? o.radius : 9,
    timer: typeof o.timer === 'number' ? o.timer : null,
    count: typeof o.count === 'number' ? o.count : 0,
    done: false,
  }));

  world.mission.activeId = missionId;
  world.mission.stage = 0;
  world.mission.objectives = objectives;
  world.mission.briefing = def.briefing || '';
  world.mission.reward = def.reward || 0;
  // Mission clock: config carries it on the timed objective (m5: 150 s),
  // or as a top-level timeLimit. Either way it is one mission countdown.
  const timed = objectives.find((o) => typeof o.timer === 'number');
  world.mission.timer = typeof def.timeLimit === 'number'
    ? def.timeLimit : timed ? timed.timer : null;
  world.mission.targetVehicleId = null;
  world.mission.followTargetId = null;
  world.mission.followTime = 0;
  world.mission.followSeen = false;
  world.mission.spottedTime = 0;
  world.mission.missionRoute = null;
  world.mission.missionRouteIndex = 0;
  world.mission.missionRouteDir = 1;
  world.flags.metRosa = true;

  setupMissionScene(world, missionId, rng);
  markDirty(world);
  emit(world, 'mission-started', {
    missionId,
    label: def.title || missionId,
    reward: def.reward || 0,
  });
  return true;
}

// Per-mission staging: vehicles, heat and enemies the mission needs.
// Spawn points come from the mission's own objective targets in
// MISSION_LIST (config.js owns the list), so the minimap blip and the
// staged car/enemies always agree.
function setupMissionScene(world, missionId, rng) {
  const objectives = world.mission.objectives;
  const targetOf = (type) => {
    const o = objectives.find((item) => item.type === type);
    return o ? o.target : null;
  };
  if (missionId === 'm1') {
    // Rosa's taxi waits by the Marina rank where she is picked up.
    const taxi = createVehicle('mission-taxi-m1', 'taxi', -216, 96, Math.PI / 2, 0xf2c230);
    taxi.state = 'mission';
    world.vehicles.push(taxi);
    world.mission.targetVehicleId = taxi.id;
  } else if (missionId === 'm2') {
    // The sport car to steal, parked where the goto marker points.
    const spot = targetOf('goto') || { x: 36, z: 6 };
    const car = createVehicle('mission-sport-m2', 'sport', spot.x, spot.z, 0, 0xc22e2e);
    // Parked, not 'mission': E must take the steal path (door pause, theft
    // crime, wanted heat) — that is the point of this mission.
    car.state = 'parked';
    world.vehicles.push(car);
    world.mission.targetVehicleId = car.id;
  } else if (missionId === 'm3') {
    // A Harbour Kings van to tail, starting at the follow marker and
    // cruising a short loop (moved by updateMission, below).
    const spot = targetOf('follow') || { x: -102, z: -174 };
    const van = createVehicle('mission-van-m3', 'van', spot.x, spot.z, Math.PI / 2, 0x3a5a3a);
    van.state = 'mission';
    van.driver = 'mission';
    world.vehicles.push(van);
    world.mission.followTargetId = van.id;
    world.mission.targetVehicleId = van.id;
    world.mission.missionRoute = [spot, { x: spot.x + 72, z: spot.z }];
    world.mission.missionRouteIndex = 1;
    world.mission.missionRouteDir = 1;
  } else if (missionId === 'm4') {
    // Three Kings hold the lock-up the shootout marker points at; the
    // shootout draws the law.
    const spot = targetOf('shootout') || { x: 108, z: 6 };
    spawnEnemies(world, spot.x, spot.z, 3);
    addHeat(world, 40);
  } else if (missionId === 'm5') {
    // The package van: reuse the van the player is already driving
    // (shots.js stages exactly that), else an existing mission van,
    // else spawn one beside the player.
    let van = playerVehicle(world);
    if (!van || van.kind !== 'van') {
      van = null;
      for (const v of world.vehicles) {
        if (v.kind === 'van' && v.state === 'mission') { van = v; break; }
      }
    }
    if (!van) {
      van = createVehicle('mission-van-m5', 'van',
        world.player.pos.x, world.player.pos.z - 12,
        world.player.heading, 0xd8d3c0);
      van.state = 'mission';
      world.vehicles.push(van);
    }
    van.state = 'mission';
    world.mission.targetVehicleId = van.id;
    const kings = createVehicle('mission-kings-m5', 'sport',
      van.pos.x + 8, van.pos.z, van.heading, 0x222226);
    kings.state = 'mission';
    kings.driver = 'mission';
    world.vehicles.push(kings);
  } else if (missionId === 'm6') {
    // The job went wrong: 3 stars on the player from the first second.
    addHeat(world, 50);
  } else if (missionId === 'm7') {
    // The Kings' getaway car, fleeing from the chase marker on a loop
    // through North Hills (moved by updateMission, below).
    const spot = targetOf('chase') || { x: 108, z: -102 };
    const car = createVehicle('mission-getaway-m7', 'sport', spot.x, spot.z, Math.PI / 2, 0x1c1c22);
    car.state = 'mission';
    car.driver = 'mission';
    car.speed = 14;
    world.vehicles.push(car);
    world.mission.targetVehicleId = car.id;
    world.mission.missionRoute = [
      spot, { x: 228, z: -228 }, { x: 180, z: 108 }, { x: 0, z: -180 },
    ];
    world.mission.missionRouteIndex = 1;
  }
  void rng;
}

// Drive a mission car along world.mission.missionRoute at a steady speed.
// m3 ping-pongs its two-point loop; m7 loops its circuit. Heading 0 faces
// north (-z), so the forward vector is (sin h, -cos h).
function advanceAlongRoute(world, car, dt, speed) {
  const route = world.mission.missionRoute;
  if (!car || !route || route.length === 0) return;
  let idx = world.mission.missionRouteIndex || 0;
  const target = route[idx];
  const dx = target.x - car.pos.x;
  const dz = target.z - car.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 5) {
    if (world.mission.activeId === 'm3') {
      // Ping-pong: reverse direction at each end of the loop.
      const dir = world.mission.missionRouteDir || 1;
      idx += dir;
      if (idx >= route.length) {
        idx = route.length - 2;
        world.mission.missionRouteDir = -1;
      } else if (idx < 0) {
        idx = 1;
        world.mission.missionRouteDir = 1;
      }
    } else {
      idx = (idx + 1) % route.length;
    }
    world.mission.missionRouteIndex = idx;
    return;
  }
  car.heading = Math.atan2(dx, -dz);
  car.pos.x += Math.sin(car.heading) * speed * dt;
  car.pos.z -= Math.cos(car.heading) * speed * dt;
  car.speed = speed;
}

export function updateMission(world, dt) {
  const m = world.mission;
  if (!m.activeId) return;
  const objective = currentObjective(world);
  if (!objective) return;

  if (typeof m.timer === 'number') {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = 0;
      failMission(world, 'time');
      return;
    }
  }

  // A wrecked mission car fails the job (m2 steal target, m5 package van).
  const targetCar = findVehicle(world, m.targetVehicleId);
  if (targetCar && targetCar.health <= 0) {
    if (m.activeId === 'm2' || m.activeId === 'm5') {
      failMission(world, 'target-wrecked');
      return;
    }
  }

  // Mission cars drive themselves: the tail target cruises its loop and
  // the getaway car runs its circuit (traffic/police never steer them).
  if (objective.type === 'follow') {
    advanceAlongRoute(world, findVehicle(world, m.followTargetId), dt, 6);
  } else if (objective.type === 'chase') {
    advanceAlongRoute(world, findVehicle(world, m.targetVehicleId), dt, 14);
  }

  switch (objective.type) {
    case 'goto':
    case 'drive':
    case 'deliver':
    case 'pickup': {
      const target = objectiveTarget(world, objective, m.stage);
      const ride = objective.type === 'goto' || objective.type === 'pickup'
        ? null : playerVehicle(world);
      const px = ride ? ride.pos.x : world.player.pos.x;
      const pz = ride ? ride.pos.z : world.player.pos.z;
      if (objective.type === 'deliver' && !ride) break;
      if (objective.type === 'deliver' && m.targetVehicleId
        && ride.id !== m.targetVehicleId) break;
      const r = objective.radius || 9;
      if (dist2(px, pz, target.x, target.z) <= r * r) {
        completeObjective(world, m.stage);
      }
      break;
    }
    case 'follow': {
      const van = findVehicle(world, m.followTargetId);
      if (!van) break;
      const d = Math.sqrt(dist2(
        world.player.pos.x, world.player.pos.z, van.pos.x, van.pos.z));
      if (d < FOLLOW_MIN) {
        // Too close: the Kings spot Mara, tailing progress bleeds away.
        m.spottedTime = (m.spottedTime || 0) + dt;
        m.followTime = Math.max(0, (m.followTime || 0) - dt * 2);
        if (m.spottedTime > 3) {
          failMission(world, 'spotted');
          return;
        }
      } else if (d <= FOLLOW_MAX) {
        m.spottedTime = 0;
        m.followSeen = true;
        m.followTime = (m.followTime || 0) + dt;
        if (m.followTime >= FOLLOW_NEED) completeObjective(world, m.stage);
      } else {
        // Lost the van — but only fail once the tail was actually on.
        // (followTime starts at 0, so an unstarted tail must not fail
        // the mission on the first tick before the player closes in.)
        m.followTime = Math.max(0, (m.followTime || 0) - dt);
        if (m.followSeen && m.followTime <= 0 && d > FOLLOW_MAX + 25) {
          failMission(world, 'lost-target');
          return;
        }
      }
      break;
    }
    case 'shootout': {
      if (enemyCount(world) === 0) completeObjective(world, m.stage);
      break;
    }
    case 'escape': {
      if (world.police.wanted === 0) completeObjective(world, m.stage);
      break;
    }
    case 'chase': {
      const car = findVehicle(world, m.targetVehicleId);
      if (car && (car.health <= 0 || (car.health <= 15 && car.speed < 1))) {
        completeObjective(world, m.stage);
      }
      break;
    }
    default:
      break;
  }
}

export function completeObjective(world, index) {
  const m = world.mission;
  if (!m.activeId || !m.objectives[index] || m.objectives[index].done) return;
  m.objectives[index].done = true;
  // A timed objective's countdown ends with it (m5's 150 s must not keep
  // running into the walk-away objective that follows it).
  if (typeof m.objectives[index].timer === 'number') m.timer = null;
  emit(world, 'objective-done', {
    missionId: m.activeId,
    label: m.objectives[index].label,
    reward: m.reward || 0,
  });
  m.stage += 1;
  markDirty(world);
  if (m.stage >= m.objectives.length) {
    completeMission(world);
  }
}

function completeMission(world) {
  const m = world.mission;
  const def = findMissionDef(m.activeId);
  const missionId = m.activeId;
  const label = def ? def.title || missionId : missionId;
  const reward = m.reward || 0;
  const done = doneIds(world);
  if (!done.includes(missionId)) done.push(missionId);
  world.stats.missionsDone = done.length;
  if (missionId === 'm2') world.flags.harbourOpen = true;
  if (missionId === 'm7') world.flags.debtCleared = true;
  clearWanted(world);
  m.activeId = null;
  m.stage = 0;
  m.objectives = [];
  m.briefing = '';
  m.timer = null;
  m.reward = 0;
  m.targetVehicleId = null;
  m.followTargetId = null;
  if (reward > 0) awardCash(world, reward);
  markDirty(world);
  emit(world, 'mission-done', { missionId, label, reward });
}

export function failMission(world, reason) {
  const m = world.mission;
  if (!m.activeId) return;
  const missionId = m.activeId;
  const def = findMissionDef(missionId);
  emit(world, 'mission-failed', {
    missionId,
    label: def ? def.title || missionId : missionId,
    reward: m.reward || 0,
    reason: reason || 'failed',
  });
  // Retry is immediate: nothing is lost except the mission itself.
  m.activeId = null;
  m.stage = 0;
  m.objectives = [];
  m.briefing = '';
  m.timer = null;
  m.reward = 0;
  m.targetVehicleId = null;
  m.followTargetId = null;
  m.followTime = 0;
  m.spottedTime = 0;
  markDirty(world);
}

// The ONLY way money increases. Emits cash-changed for HUD + save.
export function awardCash(world, amount) {
  if (typeof amount !== 'number' || amount === 0) return;
  world.player.cash += amount;
  if (world.player.cash > world.stats.bestCash) {
    world.stats.bestCash = world.player.cash;
  }
  markDirty(world);
  emit(world, 'cash-changed', { cash: world.player.cash, delta: amount });
}

// Events drained by main.js after each fixed step.
export function handleEvents(world, events) {
  for (const event of events) {
    if (event.type === 'busted') {
      if (world.mission.activeId) failMission(world, 'busted');
    } else if (event.type === 'player-down') {
      if (world.mission.activeId) failMission(world, 'wasted');
    } else if (event.type === 'escaped') {
      // updateMission() notices wanted === 0 on its own; nothing to do.
    }
  }
}
