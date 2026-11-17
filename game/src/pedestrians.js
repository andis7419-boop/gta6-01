import { createRng } from './random.js';
import { isOnPavement, isRoad, randomPedSpot, collidesBuilding, clampToCity } from './city.js';
const SHIRTS = [0xc23b2a, 0x2a5fa8, 0xe8e8e8, 0x4d8a4d, 0xe8a83b, 0x7a4d8a, 0x2a7a8a, 0xd06a2a];
const TROUSERS = [0x2b3a4d, 0x3a3a3a, 0x6a5a45, 0x4d5a6a];
const AXIS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const FLEE_SPEED = 3.5, FLEE_TIME = 4;
const PED_TARGET = 26;
const _ws = new WeakMap();
const _ps = new WeakMap();
function _st(world) { let s = _ws.get(world);
  if (!s || world.tick < s.lastTick) { s = { rng: createRng((world.seed || 1) + 202), next: 0, lastTick: 0 }; _ws.set(world, s); }
  s.lastTick = world.tick;
  return s;
}
function _pt(ped) { let t = _ps.get(ped);
  if (!t) { const f = { x: Math.sin(ped.heading), z: -Math.cos(ped.heading) };
    t = { dir: ped.heading, pause: 0, fleeT: ped.state === 'flee' ? FLEE_TIME : 0, fx: f.x, fz: f.z, cross: null, base: 1.4 };
    _ps.set(ped, t);
  }
  return t;
}
function _emit(emit, type, payload) { if (typeof emit === 'function') emit(type, payload); }
const _fwd = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
function _makePed(world, rng, spot) { const st = _st(world);
  const ped = { id: 'ped-' + (st.next++), pos: { x: spot.x, y: 0, z: spot.z },
    heading: rng.pick(AXIS), speed: 0, state: 'walk', colour: rng.pick(TROUSERS), shirtColour: rng.pick(SHIRTS),
    walkPhase: rng.range(0, Math.PI * 2), scared: false };
  const t = _pt(ped);
  t.base = rng.range(1, 1.8); t.dir = ped.heading;
  ped.speed = t.base;
  world.pedestrians.push(ped);
  return ped;
}
function _spotFar(world, rng, minDist) { for (let a = 0; a < 6; a++) { const s = randomPedSpot(world.city, rng);
    if (!s) continue;
    const dx = s.x - world.player.pos.x, dz = s.z - world.player.pos.z;
    if (dx * dx + dz * dz >= minDist * minDist) return s;
  }
  return null;
}
export function spawnPedestrians(world, rng, count) { for (let i = 0; i < count; i++) { const spot = _spotFar(world, rng, 10);
    if (spot) _makePed(world, rng, spot);
  }
}
export function pedCount(world) { return world.pedestrians.length; }
export function updatePedestrians(world, dt, emit) { const st = _st(world);
  let n = pedCount(world);
  while (n < PED_TARGET) { const spot = _spotFar(world, st.rng, 80);
    if (!spot) break;
    _makePed(world, st.rng, spot);
    n++;
  }
  for (const ped of world.pedestrians.slice()) _stepPed(world, ped, dt, st, emit);
  const p = world.player.pos;
  for (let i = world.pedestrians.length - 1; i >= 0; i--) { const q = world.pedestrians[i];
    if (q.state === 'hostile' || q.hostile === true) continue;
    const dx = q.pos.x - p.x, dz = q.pos.z - p.z;
    if (dx * dx + dz * dz > 160 * 160) world.pedestrians.splice(i, 1);
  }
}
function _scare(world, ped, t, fromX, fromZ, emit) { const dx = ped.pos.x - fromX, dz = ped.pos.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  t.fx = dx / len; t.fz = dz / len;
  t.fleeT = FLEE_TIME; t.cross = null;
  ped.state = 'flee'; ped.scared = true; ped.speed = FLEE_SPEED;
  ped.heading = Math.atan2(t.fx, -t.fz);
  world.stats.pedsScared += 1;
  _emit(emit, 'ped-scared', { pedId: ped.id });
}
export function scarePedestrians(world, x, z, radius, emit) { let n = 0;
  for (const ped of world.pedestrians) { if (ped.state === 'down' || ped.state === 'hostile' || ped.hostile === true) continue;
    const dx = ped.pos.x - x, dz = ped.pos.z - z;
    if (dx * dx + dz * dz <= radius * radius) { _scare(world, ped, _pt(ped), x, z, emit); n++; }
  }
  return n;
}
function _fastCarNear(world, ped) { for (const v of world.vehicles) { if (v.state === 'wrecked' || Math.abs(v.speed) <= 5) continue;
    const dx = v.pos.x - ped.pos.x, dz = v.pos.z - ped.pos.z;
    if (dx * dx + dz * dz < 16) return v;
  }
  return null;
}
function _slide(world, ped, nx, nz) { const c = world.city;
  if (!collidesBuilding(c, nx, ped.pos.z, 0.5)) ped.pos.x = nx;
  if (!collidesBuilding(c, ped.pos.x, nz, 0.5)) ped.pos.z = nz;
  const cl = clampToCity(c, ped.pos.x, ped.pos.z);
  ped.pos.x = cl.x; ped.pos.z = cl.z;
}
function _pickDir(world, ped, t, rng) { for (const d of rng.shuffle(AXIS)) { const f = _fwd(d);
    const tx = ped.pos.x + f.x * 2, tz = ped.pos.z + f.z * 2;
    if (isOnPavement(world.city, tx, tz) && !collidesBuilding(world.city, tx, tz, 0.5)) { ped.heading = d; t.dir = d; ped.state = 'walk'; ped.speed = t.base;
      return;
    }
  }
  ped.state = 'idle'; t.pause = rng.range(1, 3); ped.speed = 0;
}
function _stepPed(world, ped, dt, st, emit) { const t = _pt(ped);
  if (ped.state === 'hostile' || ped.hostile === true) return;
  if (ped.state === 'down') { ped.speed = 0; return; }
  if (ped.state === 'flee') { t.fleeT -= dt;
    _slide(world, ped, ped.pos.x + t.fx * FLEE_SPEED * dt, ped.pos.z + t.fz * FLEE_SPEED * dt);
    ped.walkPhase += FLEE_SPEED * dt * 2;
    if (t.fleeT <= 0) { ped.state = 'walk'; ped.scared = false; ped.speed = t.base; _pickDir(world, ped, t, st.rng); }
    return;
  }
  if (ped.state === 'idle') { t.pause -= dt; ped.speed = 0;
    if (t.pause <= 0) { ped.state = 'walk'; ped.speed = t.base; _pickDir(world, ped, t, st.rng); }
    return;
  }
  if (t.cross) { const dx = t.cross.tx - ped.pos.x, dz = t.cross.tz - ped.pos.z;
    const d = Math.hypot(dx, dz), step = ped.speed * dt;
    if (d <= step || (isOnPavement(world.city, ped.pos.x, ped.pos.z) && t.cross.done > 12)) {
      t.cross = null; ped.state = 'walk'; _pickDir(world, ped, t, st.rng);
    } else { ped.pos.x += (dx / d) * step; ped.pos.z += (dz / d) * step;
      t.cross.done += step; ped.walkPhase += ped.speed * dt * 2;
    }
    return;
  }
  const threat = _fastCarNear(world, ped);
  if (threat) { _scare(world, ped, t, threat.pos.x, threat.pos.z, emit); return; }
  if (st.rng.chance(0.002)) { const f = _fwd(ped.heading);
    if (isRoad(world.city, ped.pos.x + f.x * 2, ped.pos.z + f.z * 2)) { t.cross = { tx: ped.pos.x + f.x * 14, tz: ped.pos.z + f.z * 14, done: 0 };
      return;
    }
  }
  const f = _fwd(ped.heading);
  const nx = ped.pos.x + f.x * ped.speed * dt, nz = ped.pos.z + f.z * ped.speed * dt;
  if (isOnPavement(world.city, nx, nz) && !collidesBuilding(world.city, nx, nz, 0.5)) { ped.pos.x = nx; ped.pos.z = nz;
    ped.walkPhase += ped.speed * dt * 2;
  } else if (st.rng.chance(0.3)) { ped.state = 'idle'; t.pause = st.rng.range(1, 3); ped.speed = 0;
  } else _pickDir(world, ped, t, st.rng);
}
export function nearestPedestrian(world, x, z, maxDist) { let best = null, bestD = typeof maxDist === 'number' ? maxDist * maxDist : Infinity;
  for (const ped of world.pedestrians) { if (ped.state === 'down') continue;
    const dx = ped.pos.x - x, dz = ped.pos.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = ped; }
  }
  return best;
}
