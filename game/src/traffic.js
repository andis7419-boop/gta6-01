// traffic.js — traffic AI for Solmar Bay.
//
// Traffic cars stay on the road network, keep to the right-hand lane, and
// cruise at 8–14 m/s. Each car is a tiny state machine: follow its lane,
// slow or stop for the car ahead, for a pedestrian or the player in the
// lane, and for a red light at an intersection. At an intersection it
// picks straight / left / right and snaps onto the new road's lane.
//
// Spawning keeps about 14 traffic cars near the player: new cars appear
// only far away (over 80 m, or over 40 m for the initial fill) and far
// cars despawn past 160 m, so cars never pop into view. Traffic cars are
// stealable — stealing one is handled by vehicles.js, not here.
//
// The road grid is axis-aligned: road centrelines sit every
// blockSize + roadWidth metres. Headings are always axis-aligned too
// (0, 90, 180, 270 degrees), which keeps lane math to one coordinate.

import { createRng } from './random.js';
import { isRoad, nearestRoadPoint, clampToCity } from './city.js';
import { createVehicle } from './vehicles.js';

const CRUISE_MIN = 8;
const CRUISE_MAX = 14;
const TARGET_COUNT = 14;
const SPAWN_FAR = 80; // maintenance spawns: at least this far from the player
const DESPAWN_FAR = 160;
const LIGHT_CYCLE = 9; // seconds each light phase lasts
const STOP_GAP = 6; // stop this far behind the car ahead
const LOOK_AHEAD = 12; // how far ahead a car watches for trouble

// Per-world private state: the traffic RNG (seed + 101, never re-seeded)
// and the id counter for spawned cars.
const _worldState = new WeakMap();
function _st(world) {
  let s = _worldState.get(world);
  if (!s || world.tick < s.lastTick) {
    s = { rng: createRng((world.seed || 1) + 101), next: 0, lastTick: 0 };
    _worldState.set(world, s);
  }
  s.lastTick = world.tick;
  return s;
}

// Per-car private state, keyed by the car object itself.
const _carState = new WeakMap();
function _cs(car, rng) {
  let t = _carState.get(car);
  if (!t) {
    t = {
      cruise: rng.range(CRUISE_MIN, CRUISE_MAX),
      decidedKey: '',
    };
    _carState.set(car, t);
  }
  return t;
}

function _fwd(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

function _right(heading) {
  return { x: Math.cos(heading), z: Math.sin(heading) };
}

// Nearest multiple of 90 degrees — traffic only ever drives axis-aligned.
function _axisSnap(heading) {
  const steps = Math.round(heading / (Math.PI / 2));
  return (((steps % 4) + 4) % 4) * (Math.PI / 2);
}

// Road centreline coordinates along one axis, from the city shape.
function _lines(city) {
  const pitch = city.blockSize + city.roadWidth;
  const half = (city.blocksX * pitch) / 2;
  const out = [];
  for (let k = 0; k <= city.blocksX; k++) out.push(-half + k * pitch);
  return out;
}

function _nearestLine(lines, v) {
  let best = lines[0];
  let bestD = Math.abs(v - lines[0]);
  for (const line of lines) {
    const d = Math.abs(v - line);
    if (d < bestD) {
      best = line;
      bestD = d;
    }
  }
  return { line: best, dist: bestD };
}

// If the car is inside an intersection box, return its grid indices;
// otherwise null. Intersections are where a vertical and a horizontal
// road cross, within half a road width of both centrelines.
function _intersectionAt(city, lines, x, z) {
  const vx = _nearestLine(lines, x);
  const vz = _nearestLine(lines, z);
  if (vx.dist > city.roadWidth / 2 + 1 || vz.dist > city.roadWidth / 2 + 1) return null;
  return { kx: lines.indexOf(vx.line), kz: lines.indexOf(vz.line) };
}

// How far the car sits off its right-hand lane centre, measured along
// the lateral axis (z when travelling along x, x when travelling along z).
// The lane centre is the road centreline plus 3 m to the right of travel.
function _laneError(car, lines) {
  const f = _fwd(car.heading);
  const r = _right(car.heading);
  if (Math.abs(f.x) > 0.5) {
    const near = _nearestLine(lines, car.pos.z);
    return car.pos.z - (near.line + r.z * 3);
  }
  const near = _nearestLine(lines, car.pos.x);
  return car.pos.x - (near.line + r.x * 3);
}

function _snapToLane(car, city, lines) {
  const r = _right(car.heading);
  const f = _fwd(car.heading);
  if (Math.abs(f.x) > 0.5) {
    const near = _nearestLine(lines, car.pos.z);
    car.pos.z = near.line + r.z * 3;
  } else {
    const near = _nearestLine(lines, car.pos.x);
    car.pos.x = near.line + r.x * 3;
  }
}

// Is the light red at the intersection this car is approaching (within
// LOOK_AHEAD)? The phase alternates every LIGHT_CYCLE seconds and
// staggers per intersection, so the city is not one single wave of green.
function _redLightAhead(city, lines, car, clock) {
  const f = _fwd(car.heading);
  let kx;
  let kz;
  if (Math.abs(f.x) > 0.5) {
    const ahead = car.pos.x + f.x * LOOK_AHEAD;
    kx = lines.indexOf(_nearestLine(lines, ahead).line);
    kz = lines.indexOf(_nearestLine(lines, car.pos.z).line);
    const d = (lines[kx] - car.pos.x) * f.x;
    if (d <= 0 || d > LOOK_AHEAD) return false;
  } else {
    const ahead = car.pos.z + f.z * LOOK_AHEAD;
    kz = lines.indexOf(_nearestLine(lines, ahead).line);
    kx = lines.indexOf(_nearestLine(lines, car.pos.x).line);
    const d = (lines[kz] - car.pos.z) * f.z;
    if (d <= 0 || d > LOOK_AHEAD) return false;
  }
  const phase = Math.floor(clock / LIGHT_CYCLE) + kx + kz;
  const nsGreen = phase % 2 === 0;
  const travellingNS = Math.abs(Math.sin(car.heading)) < 0.5;
  return travellingNS ? !nsGreen : nsGreen;
}

// What speed should this car aim for, given everything ahead of it?
function _targetSpeed(world, car, cruise) {
  const f = _fwd(car.heading);
  const r = _right(car.heading);
  let target = cruise;

  const _aheadOf = (ox, oz, lateralMax) => {
    const dx = ox - car.pos.x;
    const dz = oz - car.pos.z;
    const along = dx * f.x + dz * f.z;
    const lateral = Math.abs(dx * r.x + dz * r.z);
    if (along > 0 && along < LOOK_AHEAD + 4 && lateral < lateralMax) return along;
    return -1;
  };

  for (const other of world.vehicles) {
    if (other === car || other.state === 'wrecked') continue;
    const along = _aheadOf(other.pos.x, other.pos.z, 2.6);
    if (along < 0) continue;
    if (along < STOP_GAP) return 0;
    target = Math.min(target, Math.max(0, other.speed));
  }
  for (const ped of world.pedestrians) {
    if (ped.state === 'down') continue;
    if (_aheadOf(ped.pos.x, ped.pos.z, 2.2) >= 0) return 0;
  }
  const p = world.player;
  if (p.onFoot) {
    if (_aheadOf(p.pos.x, p.pos.z, 2.2) >= 0) return 0;
  } else if (p.vehicleId !== car.id) {
    const along = _aheadOf(p.pos.x, p.pos.z, 2.6);
    if (along >= 0 && along < STOP_GAP) return 0;
    if (along >= 0) target = Math.min(target, Math.max(0, p.speed));
  }

  if (_redLightAhead(world.city, _lines(world.city), car, world.clock)) return 0;
  return target;
}

function _placeCar(world, rng, minDist) {
  const st = _st(world);
  const p = world.player.pos;
  const half = ((world.city.blocksX * (world.city.blockSize + world.city.roadWidth)) / 2) - 10;
  for (let attempt = 0; attempt < 6; attempt++) {
    const pt = nearestRoadPoint(world.city, rng.range(-half, half), rng.range(-half, half));
    if (!pt) continue;
    const dx = pt.x - p.x;
    const dz = pt.z - p.z;
    if (dx * dx + dz * dz < minDist * minDist) continue;
    const heading = rng.chance(0.5) ? pt.heading : pt.heading + Math.PI;
    const r = _right(heading);
    const roll = rng.next();
    const kind = roll < 0.15 ? 'taxi' : roll < 0.3 ? 'van' : roll < 0.4 ? 'pickup' : 'sedan';
    const car = createVehicle('traffic-' + (st.next++), kind, pt.x + r.x * 3, pt.z + r.z * 3, heading);
    car.state = 'traffic';
    car.driver = 'traffic';
    car.speed = rng.range(0, 6);
    _cs(car, rng);
    world.vehicles.push(car);
    return car;
  }
  return null;
}

export function spawnTraffic(world, rng, count) {
  for (let i = 0; i < count; i++) _placeCar(world, rng, 40);
}

export function trafficCount(world) {
  let n = 0;
  for (const v of world.vehicles) {
    if (v.state === 'traffic') n++;
  }
  return n;
}

export function despawnFarTraffic(world) {
  const p = world.player.pos;
  for (let i = world.vehicles.length - 1; i >= 0; i--) {
    const v = world.vehicles[i];
    const dx = v.pos.x - p.x;
    const dz = v.pos.z - p.z;
    const d2 = dx * dx + dz * dz;
    // Traffic cars go past 160 m; wrecks (traffic or abandoned player
    // cars, never mission cars) go past 80 m so the streets clear.
    if (v.state === 'traffic' && d2 > DESPAWN_FAR * DESPAWN_FAR) {
      world.vehicles.splice(i, 1);
    } else if (v.state === 'wrecked' && v.driver !== 'mission'
      && d2 > 80 * 80) {
      world.vehicles.splice(i, 1);
    }
  }
}

export function updateTraffic(world, dt) {
  const st = _st(world);
  const lines = _lines(world.city);

  // Keep the streets populated near the player, one car per tick at most,
  // and only ever far away so nothing pops into view.
  if (trafficCount(world) < TARGET_COUNT && world.tick % 30 === 0) {
    _placeCar(world, st.rng, SPAWN_FAR);
  }
  if (world.tick % 120 === 0) despawnFarTraffic(world);

  for (const car of world.vehicles) {
    if (car.state !== 'traffic') continue;
    const t = _cs(car, st.rng);
    car.heading = _axisSnap(car.heading);

    // Decide a turn once per intersection, then hold it.
    const at = _intersectionAt(world.city, lines, car.pos.x, car.pos.z);
    if (at) {
      const key = at.kx + ',' + at.kz;
      if (t.decidedKey !== key) {
        t.decidedKey = key;
        const roll = st.rng.next();
        let turn = 0;
        if (roll > 0.81) turn = st.rng.chance(0.5) ? -1 : 1;
        if (turn !== 0) {
          car.heading = _axisSnap(car.heading + turn * (Math.PI / 2));
          _snapToLane(car, world.city, lines);
        }
      }
    } else {
      t.decidedKey = '';
    }

    // Ease toward the target speed: gentle accel, firm brake.
    const target = _targetSpeed(world, car, t.cruise);
    if (car.speed < target) car.speed = Math.min(target, car.speed + 6 * dt);
    else if (car.speed > target) car.speed = Math.max(target, car.speed - 10 * dt);

    // Drift back onto the lane centre, then roll forward.
    const err = _laneError(car, lines);
    if (Math.abs(err) > 0.05) {
      const r = _right(car.heading);
      car.pos.x -= r.x * err * Math.min(1, dt * 2);
      car.pos.z -= r.z * err * Math.min(1, dt * 2);
    }
    const f = _fwd(car.heading);
    car.pos.x += f.x * car.speed * dt;
    car.pos.z += f.z * car.speed * dt;

    // Never leave the roads: snap back if anything pushed the car off.
    if (!isRoad(world.city, car.pos.x, car.pos.z)) {
      const pt = nearestRoadPoint(world.city, car.pos.x, car.pos.z);
      if (pt) {
        car.pos.x = pt.x;
        car.pos.z = pt.z;
        car.heading = _axisSnap(pt.heading);
      }
    }
    const clamped = clampToCity(world.city, car.pos.x, car.pos.z);
    car.pos.x = clamped.x;
    car.pos.z = clamped.z;
  }
}
