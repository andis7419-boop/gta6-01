import { createRng } from './random.js';
import { isRoad, nearestRoadPoint, getDistrictAt, clampToCity } from './city.js';
import { createVehicle } from './vehicles.js';
import { addHeat } from './police.js';
const CRUISE_MIN = 8, CRUISE_MAX = 14;
const SPAWN_FAR = 80, DESPAWN_FAR = 160;
const LIGHT_PHASE = 10;
const DISTRICT_FACTOR = { 'Market Mile': 1.3, 'Old Solmar': 1.2, 'Marina Quarter': 1.1, 'Palm Row': 1, 'Harbour Yards': 0.7, 'North Hills': 0.6 };
const _ws = new WeakMap();
const _cs = new WeakMap();
function _st(world) { let s = _ws.get(world);
  if (!s || world.tick < s.lastTick) { s = { rng: createRng((world.seed || 1) + 101), next: 0, lastTick: 0 }; _ws.set(world, s); }
  s.lastTick = world.tick;
  return s;
}
function _carState(car, rng) { let t = _cs.get(car);
  if (!t) { t = { cruise: rng.range(CRUISE_MIN, CRUISE_MAX), decided: false, turn: 'straight', centerDist: 0, justTurned: false }; _cs.set(car, t); }
  return t;
}
const _fwd = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
const _rgt = (h) => ({ x: Math.cos(h), z: Math.sin(h) });
const _axis = (h) => (((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4) * Math.PI / 2;
function _turn(h, t) { return _axis(h + (t === 'left' ? -Math.PI / 2 : t === 'right' ? Math.PI / 2 : Math.PI)); }
function _targetCount(world) { const d = DISTRICT_FACTOR[getDistrictAt(world.city, world.player.pos.x, world.player.pos.z)] || 1;
  const h = world.timeOfDay;
  const t = (h >= 7 && h < 10) || (h >= 17 && h < 19) ? 1.3 : (h < 5 || h >= 22) ? 0.5 : 1;
  return Math.max(6, Math.min(20, Math.round(14 * d * t)));
}
function _placeCar(world, rng, minDist) { const st = _st(world);
  for (let a = 0; a < 6; a++) { const pt = nearestRoadPoint(world.city, rng.range(-280, 280), rng.range(-280, 280));
    const dx = pt.x - world.player.pos.x, dz = pt.z - world.player.pos.z;
    if (dx * dx + dz * dz < minDist * minDist) continue;
    const heading = rng.chance(0.5) ? pt.heading : pt.heading + Math.PI;
    const r = _rgt(heading);
    const kind = rng.chance(0.15) ? 'taxi' : rng.chance(0.15) ? 'van' : rng.chance(0.1) ? 'pickup' : 'sedan';
    const car = createVehicle('traffic-' + (st.next++), kind, pt.x + r.x * 3, pt.z + r.z * 3, heading);
    car.state = 'traffic'; car.driver = 'traffic'; car.speed = rng.range(0, 6);
    _carState(car, rng);
    world.vehicles.push(car);
    return car;
  }
  return null;
}
export function spawnTraffic(world, rng, count) { for (let i = 0; i < count; i++) _placeCar(world, rng, 40);
}
export function trafficCount(world) { let n = 0;
  for (const v of world.vehicles) if (v.state === 'traffic') n++;
  return n;
}
export function despawnFarTraffic(world) { const p = world.player.pos;
  let removed = 0;
  for (let i = world.vehicles.length - 1; i >= 0; i--) { const v = world.vehicles[i];
    if (v.state !== 'traffic') continue;
    const dx = v.pos.x - p.x, dz = v.pos.z - p.z;
    if (dx * dx + dz * dz > DESPAWN_FAR * DESPAWN_FAR) { world.vehicles.splice(i, 1); removed++; }
  }
  return removed;
}
export function updateTraffic(world, dt, emit) { const st = _st(world);
  let n = trafficCount(world);
  const target = _targetCount(world);
  while (n < target && _placeCar(world, st.rng, SPAWN_FAR)) n++;
  if (n > target) { const far = [];
    for (const v of world.vehicles) { if (v.state !== 'traffic') continue;
      const dx = v.pos.x - world.player.pos.x, dz = v.pos.z - world.player.pos.z, d = dx * dx + dz * dz;
      if (d > 120 * 120) far.push([v, d]);
    }
    far.sort((a, b) => b[1] - a[1]);
    for (const [v] of far) { if (trafficCount(world) <= target) break;
      world.vehicles.splice(world.vehicles.indexOf(v), 1);
    }
  }
  for (const car of world.vehicles.slice()) { if (car.state !== 'traffic' || car.driver !== 'traffic' || car.health <= 0) continue;
    _stepCar(world, car, dt, st, emit);
  }
  despawnFarTraffic(world);
}
function _crossingAhead(city, x, z, h) { const f = _fwd(h), r = _rgt(h);
  for (const side of [1, -1]) for (let d = 2; d <= 18; d += 2)
    if (isRoad(city, x + f.x * d + r.x * 10 * side, z + f.z * d + r.z * 10 * side)) return { dist: d + 6 };
  return null;
}
function _isRed(world, h) { const ns = Math.abs(Math.sin(h)) < 0.01;
  return ns ? Math.floor(world.clock / LIGHT_PHASE) % 2 === 1 : Math.floor(world.clock / LIGHT_PHASE) % 2 === 0;
}
function _leaderAhead(world, car, h) { const f = _fwd(h), r = _rgt(h);
  let best = null;
  for (const v of world.vehicles) { if (v === car || v.state === 'wrecked') continue;
    if (v.state !== 'traffic' && v.state !== 'player' && v.state !== 'police' && v.state !== 'mission') continue;
    const dx = v.pos.x - car.pos.x, dz = v.pos.z - car.pos.z;
    const along = dx * f.x + dz * f.z, lat = dx * r.x + dz * r.z;
    if (along <= 0 || along > 16 || Math.abs(lat) > 3.2) continue;
    const dh = v.heading - h;
    if (Math.abs(Math.sin(dh)) < 0.05 && Math.cos(dh) > 0) { if (!best || along < best.gap) best = { gap: along - 3.4, speed: v.speed };
    } else if (Math.abs(Math.sin(dh)) < 0.05 && Math.cos(dh) < 0 && along < 10) return { gap: 0, speed: 0 };
  }
  return best;
}
function _pedAhead(world, car, h) { const f = _fwd(h), r = _rgt(h);
  const blocked = (x, z, maxAlong) => { const dx = x - car.pos.x, dz = z - car.pos.z;
    const along = dx * f.x + dz * f.z, lat = dx * r.x + dz * r.z;
    return along > 0 && along < maxAlong && Math.abs(lat) < 3;
  };
  if (world.player.onFoot && blocked(world.player.pos.x, world.player.pos.z, 10)) return true;
  for (const ped of world.pedestrians)
    if (ped.state !== 'down' && blocked(ped.pos.x, ped.pos.z, 9)) return true;
  return false;
}
function _laneOffset(city, x, z, h) { const r = _rgt(h);
  let left = 0, right = 0;
  for (let d = 1; d <= 10; d++) { if (isRoad(city, x + r.x * d, z + r.z * d)) right = d; else break; }
  for (let d = 1; d <= 10; d++) { if (isRoad(city, x - r.x * d, z - r.z * d)) left = d; else break; }
  if (left + right >= 17) return null;
  return (right - left) / 2 + 3;
}
function _stepCar(world, car, dt, st, emit) { const t = _carState(car, st.rng);
  const h = _axis(car.heading);
  car.heading = h;
  const f = _fwd(h);
  let target = t.cruise;
  const leader = _leaderAhead(world, car, h);
  if (leader) target = leader.gap < 6 ? 0 : Math.min(target, leader.speed);
  if (_pedAhead(world, car, h)) target = 0;
  const cross = _crossingAhead(world.city, car.pos.x, car.pos.z, h);
  if (cross && _isRed(world, h)) { const stop = cross.dist - 8;
    if (stop > 0 && stop < (car.speed * car.speed) / 16 + 3.5) target = 0;
  }
  const rate = target < car.speed ? 10 : 6;
  car.speed = car.speed < target ? Math.min(target, car.speed + rate * dt) : Math.max(target, car.speed - rate * dt);
  if (!isRoad(world.city, car.pos.x + f.x * 8, car.pos.z + f.z * 8) && !cross) { car.heading = _turn(h, 'back'); t.decided = false; t.turn = 'straight';
  }
  if (cross && cross.dist < 12 && !t.decided && !t.justTurned) { t.decided = true;
    t.centerDist = cross.dist;
    const roll = st.rng.next();
    t.turn = roll < 0.55 ? 'straight' : roll < 0.78 ? 'left' : 'right';
  }
  if (t.decided && t.turn !== 'straight' && Math.abs(t.centerDist) < 1.5) {
    car.heading = _turn(h, t.turn); t.decided = false; t.turn = 'straight'; t.justTurned = true;
  }
  if (!cross) { t.decided = false; t.justTurned = false; }
  const h2 = _axis(car.heading), f2 = _fwd(h2), r2 = _rgt(h2);
  const nx = car.pos.x + f2.x * car.speed * dt, nz = car.pos.z + f2.z * car.speed * dt;
  const cl = clampToCity(world.city, nx, nz);
  if (cl.x !== nx || cl.z !== nz) { car.heading = _turn(h2, 'back'); t.decided = false; }
  else { car.pos.x = nx; car.pos.z = nz; }
  const lane = _laneOffset(world.city, car.pos.x, car.pos.z, _axis(car.heading));
  if (lane !== null) { const step = Math.max(-3 * dt, Math.min(3 * dt, lane));
    car.pos.x += r2.x * step; car.pos.z += r2.z * step;
  }
  if (t.decided) t.centerDist -= car.speed * dt;
  if (Math.abs(car.speed) > 3) for (const ped of world.pedestrians) { if (ped.state === 'down' || ped.state === 'hostile' || ped.hostile === true) continue;
    const dx = ped.pos.x - car.pos.x, dz = ped.pos.z - car.pos.z;
    if (dx * dx + dz * dz < 2.4 * 2.4) { ped.state = 'down'; ped.scared = true; ped.speed = 0; car.speed *= 0.8; addHeat(world, 20, emit); }
  }
}
