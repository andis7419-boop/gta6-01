// police.js — wanted level, police pursuit, busted logic (Solmar Bay).
// Owns police.heat, the SINGLE source of truth for the wanted level.
// player.wantedHeat only ever mirrors it; nothing writes it directly.
// No three.js here, no DOM, no unseeded randomness — seeded RNG only.

import { collidesBuilding, nearestRoadPoint } from './city.js';
import { createVehicle, damageVehicle, exitVehicle, isVehicleWrecked } from './vehicles.js';
import { createRng } from './random.js';

// Heat added per crime (DESIGN §3.8, frozen).
const HEAT_TABLE = {
  theft: 25,
  'hit-ped': 20,
  shooting: 10,
  'cop-kill': 35,
  speeding: 5,
};

// Wanted band lower bounds: index = stars. Band 1 starts at 1, band 2 at 20, ...
const BAND_FLOOR = [0, 1, 20, 40, 60, 80];

// How many units of each kind the wanted level asks for.
const SPAWN_TABLE = {
  0: { cars: 0, cops: 0 },
  1: { cars: 1, cops: 0 },
  2: { cars: 2, cops: 0 },
  3: { cars: 2, cops: 2 },
  4: { cars: 3, cops: 3 },
  5: { cars: 4, cops: 4 },
};

const POLICE_TOP_SPEED = 42; // m/s
const POLICE_TURN_RATE = 2.4; // rad/s
const FOOT_COP_SPEED = 4.5; // m/s
const ARREST_RANGE = 2; // m
const ARREST_TIME = 2; // s
const SIGHT_RANGE = 60; // m
const MIN_SPAWN_DIST = 50; // m, police never spawn closer than this
const DECAY_UNSEEN = 2; // heat/s while wanted and unseen
const DECAY_CALM = 6; // heat/s while wanted is 0
const ESCAPE_TIME_LOW = 12; // s unseen at wanted 1-2
const ESCAPE_TIME_HIGH = 20; // s unseen at wanted 3-5

function _police(world) {
  if (!world.police) {
    world.police = { wanted: 0, heat: 0, officers: [], cars: [], escapeTimer: 0, bustTimer: 0 };
  }
  if (!Array.isArray(world.police.officers)) world.police.officers = [];
  if (!Array.isArray(world.police.cars)) world.police.cars = [];
  if (typeof world.police.heat !== 'number') world.police.heat = 0;
  if (typeof world.police.wanted !== 'number') world.police.wanted = 0;
  if (typeof world.police.escapeTimer !== 'number') world.police.escapeTimer = 0;
  if (typeof world.police.bustTimer !== 'number') world.police.bustTimer = 0;
  if (typeof world.police.nextId !== 'number') world.police.nextId = 1;
  return world.police;
}

function _emit(world, type, payload) {
  if (world.events && typeof world.events.emit === 'function') {
    world.events.emit(type, payload);
  }
}

function _rng(world) {
  // One seeded stream for police spawns; created lazily and kept on the
  // police state so spawn order never depends on call order elsewhere.
  const p = _police(world);
  if (!p.rng) p.rng = createRng((world.seed || 1) + 505);
  return p.rng;
}

// Stars from heat. 0 -> 0, 1-19 -> 1, 20-39 -> 2, 40-59 -> 3, 60-79 -> 4, 80-100 -> 5.
export function getWantedLevel(heat) {
  const h = Math.max(0, Math.min(100, heat || 0));
  if (h <= 0) return 0;
  if (h < 20) return 1;
  if (h < 40) return 2;
  if (h < 60) return 3;
  if (h < 80) return 4;
  return 5;
}

function _setHeat(world, value, forceEmit) {
  const p = _police(world);
  const clamped = Math.max(0, Math.min(100, value));
  const oldWanted = p.wanted;
  p.heat = clamped;
  p.wanted = getWantedLevel(clamped);
  if (world.player) world.player.wantedHeat = clamped; // mirror only, never written elsewhere
  if (forceEmit || p.wanted !== oldWanted) {
    _emit(world, 'wanted-changed', { wanted: p.wanted, heat: p.heat });
  }
}

// Add heat for a crime. Crimes committed while already wanted add double.
export function addHeat(world, amount) {
  const p = _police(world);
  _setHeat(world, p.heat + amount, true);
}

function _addCrimeHeat(world, amount) {
  const p = _police(world);
  const doubled = p.wanted >= 1 ? amount * 2 : amount;
  _setHeat(world, p.heat + doubled, true);
}

export function clearWanted(world) {
  const p = _police(world);
  // Despawn every pursuit car and foot cop.
  for (const id of p.cars) {
    const i = world.vehicles.findIndex((v) => v.id === id);
    if (i >= 0) world.vehicles.splice(i, 1);
  }
  p.cars = [];
  p.officers = [];
  p.escapeTimer = 0;
  p.bustTimer = 0;
  _setHeat(world, 0, true);
}

// Pick a spawn point on a road, 60-120 m from the player, never within 50 m.
function _spawnPoint(world) {
  const rng = _rng(world);
  const player = world.player.pos;
  for (let tries = 0; tries < 8; tries++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(60, 120);
    const x = player.x + Math.sin(angle) * dist;
    const z = player.z + Math.cos(angle) * dist;
    const spot = nearestRoadPoint(world.city, x, z);
    const dx = spot.x - player.x;
    const dz = spot.z - player.z;
    if (Math.hypot(dx, dz) >= MIN_SPAWN_DIST) return spot;
  }
  // Fallback: 80 m due north of the player, on the nearest road.
  const spot = nearestRoadPoint(world.city, player.x, player.z - 80);
  return spot;
}

export function spawnPoliceCar(world) {
  const p = _police(world);
  const spot = _spawnPoint(world);
  const id = 'police-car-' + (p.nextId++);
  const car = createVehicle(id, 'police', spot.x, spot.z, spot.heading || 0, 0x1a3a8f);
  car.state = 'police';
  car.driver = 'police';
  car.lightsOn = true;
  car.speed = 0;
  world.vehicles.push(car);
  p.cars.push(id);
  _emit(world, 'police-spawned', { wanted: p.wanted });
  return car;
}

export function spawnOfficer(world, x, z) {
  const p = _police(world);
  const id = 'officer-' + (p.nextId++);
  const officer = {
    id,
    pos: { x, y: 0, z },
    heading: 0,
    speed: 0,
    state: 'patrol',
  };
  p.officers.push(officer);
  return officer;
}

// Line of sight: within 60 m and no building on the segment midpoint.
function _canSeePlayer(world, fromPos) {
  const player = world.player.pos;
  const dx = player.x - fromPos.x;
  const dz = player.z - fromPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  const midX = (fromPos.x + player.x) / 2;
  const midZ = (fromPos.z + player.z) / 2;
  return collidesBuilding(world.city, midX, midZ, 0) === null;
}

function _anyCopSeesPlayer(world) {
  const p = _police(world);
  for (const id of p.cars) {
    const car = world.vehicles.find((v) => v.id === id);
    if (car && _canSeePlayer(world, car.pos)) return true;
  }
  for (const officer of p.officers) {
    if (_canSeePlayer(world, officer.pos)) return true;
  }
  return false;
}

function _angleTo(from, to) {
  // Heading convention: 0 faces north (-z), clockwise from above.
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

function _turnToward(current, target, maxStep) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > maxStep) return current + maxStep;
  if (diff < -maxStep) return current - maxStep;
  return target;
}

function _updatePoliceCars(world, dt) {
  const p = _police(world);
  const player = world.player;
  for (const id of [...p.cars]) {
    const car = world.vehicles.find((v) => v.id === id);
    if (!car) continue;
    // Despawn pursuit cars that fell far behind the action.
    const distToPlayer = Math.hypot(player.pos.x - car.pos.x, player.pos.z - car.pos.z);
    if (distToPlayer > 260) {
      const i = world.vehicles.findIndex((v) => v.id === id);
      if (i >= 0) world.vehicles.splice(i, 1);
      p.cars = p.cars.filter((c) => c !== id);
      continue;
    }
    const desired = _angleTo(car.pos, player.pos);
    car.heading = _turnToward(car.heading, desired, POLICE_TURN_RATE * dt);
    // Ease up to top speed; ease off when right on top of the player.
    const targetSpeed = distToPlayer < 6 ? 18 : POLICE_TOP_SPEED;
    car.speed += Math.max(-20 * dt, Math.min(14 * dt, targetSpeed - car.speed));
    const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.pos.z - Math.cos(car.heading) * car.speed * dt;
    // Buildings stop a pursuit car dead instead of letting it clip through.
    if (collidesBuilding(world.city, nx, nz, 1.2) === null) {
      car.pos.x = nx;
      car.pos.z = nz;
    } else {
      car.speed *= 0.4;
    }
    // Ram: slow the player's car and chew its health a little.
    if (!player.onFoot && player.vehicleId) {
      const pv = world.vehicles.find((v) => v.id === player.vehicleId);
      if (pv && Math.hypot(pv.pos.x - car.pos.x, pv.pos.z - car.pos.z) < 5) {
        pv.speed *= Math.max(0, 1 - 0.6 * dt);
        damageVehicle(world, pv.id, 3 * dt);
        car.speed *= 0.85;
      }
    } else if (player.onFoot && distToPlayer < 2.5) {
      // A pursuit car nudges an on-foot player aside instead of running them over.
      const pushX = player.pos.x - car.pos.x;
      const pushZ = player.pos.z - car.pos.z;
      const len = Math.hypot(pushX, pushZ) || 1;
      const px = player.pos.x + (pushX / len) * 1.2 * dt * 10;
      const pz = player.pos.z + (pushZ / len) * 1.2 * dt * 10;
      if (collidesBuilding(world.city, px, pz, 0.5) === null) {
        player.pos.x = px;
        player.pos.z = pz;
      }
    }
  }
}

function _updateOfficers(world, dt) {
  const p = _police(world);
  const player = world.player;
  let arresting = false;
  for (const officer of p.officers) {
    const dx = player.pos.x - officer.pos.x;
    const dz = player.pos.z - officer.pos.z;
    const dist = Math.hypot(dx, dz);
    if (p.wanted === 0) {
      officer.state = 'patrol';
      officer.speed = 0;
      continue;
    }
    officer.state = 'chase';
    officer.heading = _angleTo(officer.pos, player.pos);
    officer.speed = FOOT_COP_SPEED;
    const step = Math.min(dist, FOOT_COP_SPEED * dt);
    const nx = officer.pos.x + Math.sin(officer.heading) * step;
    const nz = officer.pos.z - Math.cos(officer.heading) * step;
    if (collidesBuilding(world.city, nx, nz, 0.5) === null) {
      officer.pos.x = nx;
      officer.pos.z = nz;
    }
    if (dist < ARREST_RANGE) arresting = true;
  }
  // A cop can only arrest the player on foot; a driver is chased by cars.
  if (arresting && world.player.onFoot) {
    p.bustTimer += dt;
    if (p.bustTimer >= ARREST_TIME) {
      const wanted = p.wanted;
      p.bustTimer = 0;
      _emit(world, 'busted', { wanted });
      clearWanted(world);
    }
  } else {
    p.bustTimer = 0;
  }
}

function _topUpSpawns(world) {
  const p = _police(world);
  const want = SPAWN_TABLE[p.wanted] || SPAWN_TABLE[0];
  while (p.cars.length < want.cars) spawnPoliceCar(world);
  while (p.officers.length < want.cops) {
    const spot = _spawnPoint(world);
    spawnOfficer(world, spot.x, spot.z);
  }
  // Wanted fell: trim the excess instead of leaving an army behind.
  while (p.cars.length > want.cars) {
    const id = p.cars.pop();
    const i = world.vehicles.findIndex((v) => v.id === id);
    if (i >= 0) world.vehicles.splice(i, 1);
  }
  while (p.officers.length > want.cops) p.officers.pop();
}

export function updatePolice(world, dt) {
  if (world.paused) return;
  if (world.screen && world.screen !== 'play') return;
  const p = _police(world);

  // A wrecked player car at high wanted forces the player out on foot.
  if (!world.player.onFoot && world.player.vehicleId && p.wanted >= 3) {
    const pv = world.vehicles.find((v) => v.id === world.player.vehicleId);
    if (pv && isVehicleWrecked(pv)) {
      exitVehicle(world);
    }
  }

  const seen = _anyCopSeesPlayer(world);

  // Heat decay + escape clock.
  if (p.wanted === 0) {
    if (p.heat > 0) _setHeat(world, p.heat - DECAY_CALM * dt, false);
    p.escapeTimer = 0;
  } else if (!seen) {
    _setHeat(world, p.heat - DECAY_UNSEEN * dt, false);
    p.escapeTimer += dt;
    const limit = p.wanted <= 2 ? ESCAPE_TIME_LOW : ESCAPE_TIME_HIGH;
    if (p.escapeTimer >= limit) {
      p.escapeTimer = 0;
      // Drop exactly one star band: heat to just below this band's floor,
      // never above where decay has already brought it.
      const newHeat = Math.min(p.heat, BAND_FLOOR[p.wanted] - 1);
      const wasWanted = p.wanted;
      _setHeat(world, newHeat, true);
      if (wasWanted === 1) _emit(world, 'escaped', {});
    }
  } else {
    p.escapeTimer = 0;
  }

  _topUpSpawns(world);
  _updatePoliceCars(world, dt);
  _updateOfficers(world, dt);
}

// Drain one tick's events. main.js calls this after update, once per tick.
export function handleEvents(world, events) {
  for (const event of events) {
    const payload = event.payload || {};
    // The 'crime' event is the single heat channel: one crime, one add.
    // 'car-stolen' and 'shot-fired' are notification twins of the same
    // act (the theft / the shot already report through 'crime'), so
    // charging them here too counted one theft as 25 + doubled 50 = 75
    // heat (4 stars instead of the designed 2) and one shot as 30.
    if (event.type === 'crime') {
      const amount = typeof payload.amount === 'number'
        ? payload.amount
        : (HEAT_TABLE[payload.kind] || 0);
      if (amount > 0) _addCrimeHeat(world, amount);
    } else if (event.type === 'ped-scared') {
      // A scared pedestrian is not itself a crime; heat comes from the
      // shot, punch or speeding that scared them, via those events.
    }
  }
}
