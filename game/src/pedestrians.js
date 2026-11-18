// pedestrians.js — people for Solmar Bay.
//
// Pedestrians walk the pavements at 1–1.8 m/s, pause at corners, and cross
// roads only at intersections. A scare — a gunshot, a punch nearby, or a
// car bearing down on them — sends everyone within 12 m fleeing at
// 3.5 m/s for 4 s. A pedestrian hit by a car moving faster than 3 m/s
// goes down and stays down (that hit is reported as a crime by the car
// code in vehicles.js).
//
// Population is kept near 26 around the player with the same distance
// rules as traffic: new pedestrians appear only far away (over 80 m, or
// over 10 m for the initial fill) and far ones despawn past 160 m, so
// nobody pops into view. walkPhase drives the leg/arm swing that
// render.js reads; it advances with distance walked.

import { createRng } from './random.js';
import { isOnPavement, isRoad, randomPedSpot, collidesBuilding, clampToCity } from './city.js';
import { GAME_CONFIG } from './config.js';

const C = GAME_CONFIG;
const PED_TARGET = 26;
const SPAWN_FAR = 80;
const DESPAWN_FAR = 160;
const FLEE_SPEED = 3.5;
const FLEE_TIME = 4;
const SCARE_RADIUS = 12;
const CAR_SCARE_DIST = 4;
const AXIS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

const SHIRTS = [0xc23b2a, 0x2a5fa8, 0xe8e8e8, 0x4d8a4d, 0xe8a83b, 0x7a4d8a, 0x2a7a8a, 0xd06a2a];
const TROUSERS = [0x2b3a4d, 0x3a3a3a, 0x6a5a45, 0x4d5a6a];

// Per-world private state: the pedestrian RNG (seed + 202, never
// re-seeded) and the id counter.
const _worldState = new WeakMap();
function _st(world) {
  let s = _worldState.get(world);
  if (!s || world.tick < s.lastTick) {
    s = { rng: createRng((world.seed || 1) + 202), next: 0, lastTick: 0 };
    _worldState.set(world, s);
  }
  s.lastTick = world.tick;
  return s;
}

// Per-pedestrian private state: base walk speed, pause / flee timers,
// the flee direction, and corner / crossing bookkeeping.
const _pedState = new WeakMap();
function _ps(ped) {
  let t = _pedState.get(ped);
  if (!t) {
    t = {
      base: 1.4,
      pauseT: 0,
      fleeT: 0,
      fleeX: 0,
      fleeZ: -1,
      cornerKey: '',
      crossing: false,
      crossX: 0,
      crossZ: 0,
    };
    _pedState.set(ped, t);
  }
  return t;
}

function _fwd(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

function _axisSnap(heading) {
  const steps = Math.round(heading / (Math.PI / 2));
  return (((steps % 4) + 4) % 4) * (Math.PI / 2);
}

function _emit(world, type, payload) {
  if (world.events && typeof world.events.emit === 'function') {
    world.events.emit(type, payload);
  }
}

function _makePed(world, rng, spot) {
  const st = _st(world);
  const ped = {
    id: 'ped-' + (st.next++),
    pos: { x: spot.x, y: 0, z: spot.z },
    heading: rng.pick(AXIS),
    speed: 0,
    state: 'walk',
    colour: rng.pick(TROUSERS),
    shirtColour: rng.pick(SHIRTS),
    walkPhase: rng.range(0, Math.PI * 2),
    scared: false,
  };
  const t = _ps(ped);
  t.base = rng.range(1, 1.8);
  ped.speed = t.base;
  world.pedestrians.push(ped);
  return ped;
}

// A pavement spot at least `minDist` from the player (a few tries, then
// give up for this tick rather than spawning on top of the player).
function _spotFar(world, rng, minDist) {
  const p = world.player.pos;
  for (let attempt = 0; attempt < 6; attempt++) {
    const spot = randomPedSpot(world.city, rng);
    if (!spot) continue;
    const dx = spot.x - p.x;
    const dz = spot.z - p.z;
    if (dx * dx + dz * dz >= minDist * minDist) return spot;
  }
  return null;
}

export function spawnPedestrians(world, rng, count) {
  for (let i = 0; i < count; i++) {
    const spot = _spotFar(world, rng, 10);
    if (spot) _makePed(world, rng, spot);
  }
}

export function pedCount(world) {
  return world.pedestrians.length;
}

export function nearestPedestrian(world, x, z, maxDist) {
  const limit = typeof maxDist === 'number' ? maxDist * maxDist : Infinity;
  let best = null;
  let bestD = limit;
  for (const ped of world.pedestrians) {
    const dx = ped.pos.x - x;
    const dz = ped.pos.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = ped;
      bestD = d;
    }
  }
  return best;
}

// Scare everyone within `radius` of (x, z): they flee away from the cause
// at 3.5 m/s for 4 s. Down pedestrians stay down. Emits one ped-scared
// event per pedestrian and counts them in stats.
export function scarePedestrians(world, x, z, radius) {
  const r2 = radius * radius;
  let n = 0;
  for (const ped of world.pedestrians) {
    if (ped.state === 'down') continue;
    const dx = ped.pos.x - x;
    const dz = ped.pos.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const len = Math.sqrt(d2) || 1;
    const t = _ps(ped);
    t.fleeX = dx / len;
    t.fleeZ = dz / len;
    t.fleeT = FLEE_TIME;
    ped.state = 'flee';
    ped.scared = true;
    ped.speed = FLEE_SPEED;
    ped.heading = Math.atan2(t.fleeX, -t.fleeZ);
    if (world.stats) world.stats.pedsScared += 1;
    _emit(world, 'ped-scared', { pedId: ped.id });
    n++;
  }
  return n;
}

// Push a pedestrian out of a building's keep-out ring (0.5 m), along the
// shortest exit axis. Covers spawns and crossings that land a ped right
// against a wall, where a step check alone would deadlock them.
function _clearWall(city, ped) {
  const b = collidesBuilding(city, ped.pos.x, ped.pos.z, 0.45);
  if (!b) return;
  const ox = b.w / 2 + 0.5 - Math.abs(ped.pos.x - b.x);
  const oz = b.d / 2 + 0.5 - Math.abs(ped.pos.z - b.z);
  if (ox < oz) ped.pos.x = b.x + (ped.pos.x >= b.x ? 1 : -1) * (b.w / 2 + 0.5);
  else ped.pos.z = b.z + (ped.pos.z >= b.z ? 1 : -1) * (b.d / 2 + 0.5);
}

// Middle of the far pavement across the road this ped is about to cross:
// the nearest road centreline along the travel axis, plus half the road
// plus half the pavement in the heading direction.
function _crossTarget(city, lines, ped) {
  const f = _fwd(ped.heading);
  const reach = city.roadWidth / 2 + 5;
  let best = lines[0];
  let bestD = Math.abs((Math.abs(f.x) > 0.5 ? ped.pos.x : ped.pos.z) - lines[0]);
  for (const line of lines) {
    const d = Math.abs((Math.abs(f.x) > 0.5 ? ped.pos.x : ped.pos.z) - line);
    if (d < bestD) {
      best = line;
      bestD = d;
    }
  }
  if (Math.abs(f.x) > 0.5) return { x: best + f.x * reach, z: ped.pos.z };
  return { x: ped.pos.x, z: best + f.z * reach };
}

// Road centrelines along one axis, from the city shape.
function _lines(city) {
  const pitch = city.blockSize + city.roadWidth;
  const half = (city.blocksX * pitch) / 2;
  const out = [];
  for (let k = 0; k <= city.blocksX; k++) out.push(-half + k * pitch);
  return out;
}

// Is this pedestrian standing on a pavement corner — near a road line in
// both axes? Corners are where pedestrians pause, turn, or cross.
function _cornerKey(city, lines, x, z) {
  let nearX = false;
  let nearZ = false;
  let kx = -1;
  let kz = -1;
  for (let k = 0; k < lines.length; k++) {
    if (Math.abs(x - lines[k]) < city.roadWidth / 2 + 4) {
      nearX = true;
      kx = k;
    }
    if (Math.abs(z - lines[k]) < city.roadWidth / 2 + 4) {
      nearZ = true;
      kz = k;
    }
  }
  return nearX && nearZ ? kx + ',' + kz : '';
}

function _stepPed(world, ped, dt, rng, lines) {
  const t = _ps(ped);
  const phaseRate = C.walkPhaseRate || 2;

  if (ped.state === 'down') return; // stays down until despawned

  if (ped.state === 'flee') {
    t.fleeT -= dt;
    _clearWall(world.city, ped);
    // Check the next step before taking it: keep a body-width (0.45 m)
    // off the walls instead of stepping into them and bouncing out.
    const nx = ped.pos.x + t.fleeX * FLEE_SPEED * dt;
    const nz = ped.pos.z + t.fleeZ * FLEE_SPEED * dt;
    if (collidesBuilding(world.city, nx, nz, 0.45)) {
      // Wall ahead: turn the flee aside and keep running.
      const rx = -t.fleeZ;
      const rz = t.fleeX;
      t.fleeX = rx;
      t.fleeZ = rz;
      ped.heading = Math.atan2(rx, -rz);
    } else {
      ped.pos.x = nx;
      ped.pos.z = nz;
    }
    ped.walkPhase += FLEE_SPEED * dt * phaseRate;
    if (t.fleeT <= 0) {
      ped.state = 'walk';
      ped.scared = false;
      ped.speed = t.base;
      ped.heading = _axisSnap(ped.heading);
    }
    const clamped = clampToCity(world.city, ped.pos.x, ped.pos.z);
    ped.pos.x = clamped.x;
    ped.pos.z = clamped.z;
    return;
  }

  if (ped.state === 'idle') {
    t.pauseT -= dt;
    if (t.pauseT <= 0) {
      ped.state = 'walk';
      ped.speed = t.base;
    }
    return;
  }

  // Walking. Crossings go straight across the road to the far pavement;
  // otherwise stay on the pavement and decide at each new corner.
  if (t.crossing) {
    const dx = t.crossX - ped.pos.x;
    const dz = t.crossZ - ped.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      t.crossing = false;
      ped.heading = _axisSnap(ped.heading);
    } else if (collidesBuilding(world.city,
      ped.pos.x + (dx / d) * t.base * dt, ped.pos.z + (dz / d) * t.base * dt, 0.45)) {
      // The far side is blocked (a wall, not pavement): abandon the cross.
      t.crossing = false;
      ped.heading = _axisSnap(ped.heading + Math.PI / 2);
    } else {
      ped.pos.x += (dx / d) * t.base * dt;
      ped.pos.z += (dz / d) * t.base * dt;
      ped.walkPhase += t.base * dt * phaseRate;
    }
    return;
  }

  _clearWall(world.city, ped);
  const f = _fwd(ped.heading);
  // Check the next step before taking it: keep a body-width (0.45 m) off
  // the walls, so pedestrians never scrape along a building face.
  const nx = ped.pos.x + f.x * t.base * dt;
  const nz = ped.pos.z + f.z * t.base * dt;
  if (collidesBuilding(world.city, nx, nz, 0.45)) {
    ped.heading = _axisSnap(ped.heading + Math.PI / 2);
    return;
  }
  ped.pos.x = nx;
  ped.pos.z = nz;
  ped.walkPhase += t.base * dt * phaseRate;

  if (!isOnPavement(world.city, ped.pos.x, ped.pos.z)) {
    if (isRoad(world.city, ped.pos.x, ped.pos.z)) {
      // Wandered onto the road away from a crossing: turn back.
      ped.heading = _axisSnap(ped.heading + Math.PI);
      ped.pos.x -= f.x * t.base * dt * 2;
      ped.pos.z -= f.z * t.base * dt * 2;
    } else {
      // Inside a block (a building): turn aside.
      ped.heading = _axisSnap(ped.heading + Math.PI / 2);
    }
    return;
  }

  const key = _cornerKey(world.city, lines, ped.pos.x, ped.pos.z);
  if (key && t.cornerKey !== key) {
    t.cornerKey = key;
    const roll = rng.next();
    if (roll < 0.22) {
      ped.state = 'idle'; // pause at the corner and look around
      ped.speed = 0;
      t.pauseT = 1 + rng.next() * 1.5;
    } else if (roll < 0.4) {
      // Cross the road ahead to the middle of the far pavement.
      const target = _crossTarget(world.city, lines, ped);
      t.crossing = true;
      t.crossX = target.x;
      t.crossZ = target.z;
    } else if (roll < 0.62) {
      ped.heading = _axisSnap(ped.heading + (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2));
    }
  } else if (!key) {
    t.cornerKey = '';
  }
}

export function updatePedestrians(world, dt) {
  const st = _st(world);

  // Keep the streets populated near the player, a couple per tick at most.
  if (pedCount(world) < PED_TARGET && world.tick % 20 === 0) {
    for (let i = 0; i < 2; i++) {
      const spot = _spotFar(world, st.rng, SPAWN_FAR);
      if (spot) _makePed(world, st.rng, spot);
    }
  }
  if (world.tick % 120 === 0) {
    const p = world.player.pos;
    for (let i = world.pedestrians.length - 1; i >= 0; i--) {
      const ped = world.pedestrians[i];
      const dx = ped.pos.x - p.x;
      const dz = ped.pos.z - p.z;
      if (dx * dx + dz * dz > DESPAWN_FAR * DESPAWN_FAR) world.pedestrians.splice(i, 1);
    }
  }

  // A fast car close by scares everyone around it (DESIGN section 3.7).
  const p = world.player;
  if (!p.onFoot && Math.abs(p.speed) > 3) {
    const car = world.vehicles.find((v) => v.id === p.vehicleId);
    if (car) {
      for (const ped of world.pedestrians) {
        if (ped.state === 'down' || ped.state === 'flee') continue;
        const dx = ped.pos.x - car.pos.x;
        const dz = ped.pos.z - car.pos.z;
        if (dx * dx + dz * dz < CAR_SCARE_DIST * CAR_SCARE_DIST) {
          scarePedestrians(world, car.pos.x, car.pos.z, SCARE_RADIUS);
          break;
        }
      }
    }
  }

  const lines = _lines(world.city);
  for (const ped of world.pedestrians) _stepPed(world, ped, dt, st.rng, lines);
}
