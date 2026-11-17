import { GAME_CONFIG, PALETTE } from './config.js';
import { createRng } from './random.js';
import { collidesBuilding, clampToCity, randomParkedSpot } from './city.js';
import { isDown, wasPressed, getLookDelta } from './input.js';
import { scarePedestrians } from './pedestrians.js';
import { addHeat } from './police.js';
const C = GAME_CONFIG;
const KIND = { sedan: { top: C.driveTopSpeed, accel: C.driveAccel, grip: 1, models: ['Veltor Largo', 'Cascada Marina', 'Halcyon Drift'] },
  taxi: { top: C.driveTopSpeed, accel: C.driveAccel, grip: 1, models: ['Cascada Cab'] },
  pickup: { top: 36, accel: 12, grip: 0.95, models: ['Veltor Hauler', 'Halcyon Rancher'] },
  van: { top: 34, accel: 11, grip: 0.9, models: ['Halcyon Carrier', 'Veltor Mover'] },
  sport: { top: C.sportTopSpeed, accel: 17, grip: 1.15, models: ['Veltor Comet', 'Halcyon Stinger', 'Cascada Viento'] },
  police: { top: C.policeTopSpeed, accel: 16, grip: 1.1, models: ['Veltor Interceptor'] }, };
const TAXI_PAINT = 0xe8b820;
const REVERSE_ACCEL = 8;
const STEAL_CLEAR = 30;
const PARKED_COUNT = 20;
const _ws = new WeakMap();
function _st(world) { let s = _ws.get(world);
  if (!s || world.tick < s.lastTick) {
    s = { rng: createRng((world.seed || 1) + 505), nextParked: 0, steal: null, stealT: 0, lastStolenId: null, hopVy: 0, hopY: 0, lastTick: 0, populated: false };
    _ws.set(world, s);
  }
  s.lastTick = world.tick;
  return s;
}
function _emit(emit, type, payload) { if (typeof emit === 'function') emit(type, payload); }
function _hash(list, key) { let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0; return list[h % list.length]; }
function _driverFlees(world, vehicle, emit) { const st = _st(world);
  const id = 'ped-driver-' + vehicle.id;
  if (world.pedestrians.some((p) => p.id === id)) return;
  const a = st.rng.range(0, Math.PI * 2);
  world.pedestrians.push({ id, pos: { x: vehicle.pos.x + Math.sin(a) * 2, y: 0, z: vehicle.pos.z - Math.cos(a) * 2 },
    heading: a, speed: 3.5, state: 'flee', colour: 0xc9a06a, shirtColour: 0x3a6fd8, walkPhase: 0, scared: true });
  world.stats.pedsScared += 1;
  _emit(emit, 'ped-scared', { pedId: id });
}
export function createVehicle(id, kind, x, z, heading, colour) { const spec = KIND[kind] || KIND.sedan;
  const m = _hash(spec.models, String(id)).split(' ');
  let paint = colour;
  if (typeof paint !== 'number') paint = kind === 'taxi' ? TAXI_PAINT : kind === 'police' ? PALETTE.policeBlue : _hash(PALETTE.carColours, String(id));
  return { id, make: m[0], model: m[1], kind: kind in KIND ? kind : 'sedan', pos: { x, y: 0, z }, heading, speed: 0, steer: 0, colour: paint,
    state: 'parked', health: 100, stolen: false, driver: 'none', lightsOn: false };
}
export function spawnParkedCars(world, rng, count) { const st = _st(world);
  for (let i = 0; i < count; i++) { let spot = null;
    for (let a = 0; a < 5 && !spot; a++) { const c = randomParkedSpot(world.city, rng);
      if (!c) break;
      const dx = c.x - world.player.pos.x, dz = c.z - world.player.pos.z;
      if (dx * dx + dz * dz > 100) spot = c;
    }
    if (!spot) continue;
    const r = rng.next(), kind = r < 0.36 ? 'sedan' : r < 0.5 ? 'taxi' : r < 0.66 ? 'pickup' : r < 0.8 ? 'van' : 'sport';
    const m = rng.pick(KIND[kind].models).split(' ');
    const v = createVehicle('parked-' + (st.nextParked++), kind, spot.x, spot.z, spot.heading, kind === 'taxi' ? TAXI_PAINT : rng.pick(PALETTE.carColours));
    v.make = m[0]; v.model = m[1];
    world.vehicles.push(v);
  }
}
export function drivePhysics(vehicle, input, dt) { const spec = KIND[vehicle.kind] || KIND.sedan;
  let c;
  if (!input) c = { throttle: 0, steer: 0, handbrake: false };
  else if (typeof input.throttle === 'number' || typeof input.steer === 'number')
    c = { throttle: Math.max(-1, Math.min(1, input.throttle || 0)), steer: Math.max(-1, Math.min(1, input.steer || 0)), handbrake: !!input.handbrake };
  else c = { throttle: (isDown(input, 'forward') ? 1 : 0) - (isDown(input, 'back') ? 1 : 0),
    steer: (isDown(input, 'right') ? 1 : 0) - (isDown(input, 'left') ? 1 : 0), handbrake: isDown(input, 'handbrake') };
  const top = spec.top;
  vehicle.steer += (c.steer - vehicle.steer) * Math.min(1, dt * 8);
  if (c.throttle > 0) vehicle.speed += (vehicle.speed < -0.1 ? C.driveBrake : spec.accel) * c.throttle * dt;
  else if (c.throttle < 0) vehicle.speed += (vehicle.speed > 0.5 ? C.driveBrake : REVERSE_ACCEL) * c.throttle * dt;
  else { const d = 5 * dt; vehicle.speed = Math.abs(vehicle.speed) <= d ? 0 : vehicle.speed - Math.sign(vehicle.speed) * d; }
  if (c.handbrake) { const d = 10 * dt; vehicle.speed = Math.abs(vehicle.speed) <= d ? 0 : vehicle.speed - Math.sign(vehicle.speed) * d; }
  vehicle.speed -= vehicle.speed * 0.08 * dt;
  vehicle.speed = Math.max(-C.driveReverseSpeed, Math.min(top, vehicle.speed));
  if (!c.throttle && Math.abs(vehicle.speed) < 0.05) vehicle.speed = 0;
  const maxSteer = Math.max(0.12, (C.driveSteerMax - C.driveSteerSpeedFalloff * Math.abs(vehicle.speed)) * spec.grip);
  vehicle.heading += (vehicle.speed / 2.8) * Math.tan(vehicle.steer * maxSteer) * (c.handbrake ? 1.5 : 1) * dt;
  vehicle.pos.x += Math.sin(vehicle.heading) * vehicle.speed * dt;
  vehicle.pos.z += -Math.cos(vehicle.heading) * vehicle.speed * dt;
}
export function updateVehicles(world, dt, input, emit) { const st = _st(world);
  const p = world.player;
  if (!st.populated) { spawnParkedCars(world, st.rng, PARKED_COUNT); st.populated = true; }
  const night = world.timeOfDay >= C.duskHour || world.timeOfDay < 6.5;
  for (const v of world.vehicles) v.lightsOn = night && v.state !== 'wrecked';
  if (st.steal) { const t = world.vehicles.find((v) => v.id === st.steal);
    if (!t || t.state === 'wrecked' || t.driver === 'player') st.steal = null;
    else { st.stealT += dt;
      if (st.stealT >= C.stealTime) { st.steal = null; stealVehicle(world, t.id, emit); }
      return;
    }
  }
  if (p.onFoot) _onFoot(world, dt, input, emit, st);
  else { const car = world.vehicles.find((v) => v.id === p.vehicleId);
    if (!car || car.state === 'wrecked') { if (car) exitVehicle(world, emit);
      else { p.onFoot = true; p.vehicleId = null; }
    } else if (input && wasPressed(input, 'enterCar')) exitVehicle(world, emit);
    else { drivePhysics(car, input, dt);
      _hitBuilding(world, car);
      _hitCars(world, car, emit);
      _hitPeds(world, car, emit);
      if (!p.onFoot) { p.pos.x = car.pos.x; p.pos.y = 0; p.pos.z = car.pos.z;
        p.heading = car.heading; p.speed = Math.abs(car.speed);
        world.stats.distanceDriven += Math.abs(car.speed) * dt;
      }
    }
  }
  if (st.lastStolenId && p.onFoot) { const s = world.vehicles.find((v) => v.id === st.lastStolenId);
    if (!s || !s.stolen) st.lastStolenId = null;
    else { const dx = p.pos.x - s.pos.x, dz = p.pos.z - s.pos.z;
      if (dx * dx + dz * dz > STEAL_CLEAR * STEAL_CLEAR) { s.stolen = false; st.lastStolenId = null; }
    }
  }
}
function _onFoot(world, dt, input, emit, st) { const p = world.player;
  if (input) { const l = getLookDelta(input); if (l.dx) p.heading += l.dx * C.mouseSensitivity; }
  let mx = 0, mz = 0;
  if (input) { const f = (isDown(input, 'forward') ? 1 : 0) - (isDown(input, 'back') ? 1 : 0);
    const r = (isDown(input, 'right') ? 1 : 0) - (isDown(input, 'left') ? 1 : 0);
    mx = Math.sin(p.heading) * f + Math.cos(p.heading) * r;
    mz = -Math.cos(p.heading) * f + Math.sin(p.heading) * r;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
  }
  const sprint = input && (isDown(input, 'sprint') || isDown(input, 'sprintAlt'));
  const speed = sprint ? C.runSpeed : C.walkSpeed;
  p.isRunning = !!sprint && (mx !== 0 || mz !== 0);
  if (input && wasPressed(input, 'handbrake') && st.hopY <= 0) st.hopVy = (4 * C.jumpHeight) / C.jumpTime;
  if (st.hopY > 0 || st.hopVy > 0) { st.hopVy -= ((8 * C.jumpHeight) / (C.jumpTime * C.jumpTime)) * dt;
    st.hopY += st.hopVy * dt;
    if (st.hopY <= 0) { st.hopY = 0; st.hopVy = 0; }
  }
  p.pos.y = st.hopY;
  const ox = p.pos.x, oz = p.pos.z, step = speed * dt, r = C.playerRadius;
  const nx = p.pos.x + mx * step, nz = p.pos.z + mz * step;
  if (!collidesBuilding(world.city, nx, p.pos.z, r)) p.pos.x = nx;
  if (!collidesBuilding(world.city, p.pos.x, nz, r)) p.pos.z = nz;
  const cl = clampToCity(world.city, p.pos.x, p.pos.z);
  p.pos.x = cl.x; p.pos.z = cl.z;
  const moving = mx !== 0 || mz !== 0;
  p.speed = moving ? speed : 0;
  if (moving) p.walkPhase = (p.walkPhase || 0) + dt * speed * C.walkPhaseRate;
  world.stats.distanceWalked += Math.hypot(p.pos.x - ox, p.pos.z - oz);
  if (input && wasPressed(input, 'enterCar')) { const car = nearestEnterableCar(world, C.stealRange);
    if (car) { if (car.state === 'mission' || car.stolen) enterVehicle(world, car.id, emit);
      else { st.steal = car.id; st.stealT = 0; }
    }
  }
}
function _hitBuilding(world, car) { const hit = collidesBuilding(world.city, car.pos.x, car.pos.z, 1.6);
  if (!hit) { const c = clampToCity(world.city, car.pos.x, car.pos.z); car.pos.x = c.x; car.pos.z = c.z; return; }
  const hw = hit.w / 2 + 1.6, hd = hit.d / 2 + 1.6;
  const dx = car.pos.x - hit.x, dz = car.pos.z - hit.z;
  if (hw - Math.abs(dx) < hd - Math.abs(dz)) car.pos.x = hit.x + Math.sign(dx || 1) * hw;
  else car.pos.z = hit.z + Math.sign(dz || 1) * hd;
  car.speed = -car.speed * 0.18;
  if (Math.abs(car.speed) < 0.5) car.speed = 0;
}
function _hitCars(world, car, emit) { for (const o of world.vehicles) { if (o === car || o.state === 'wrecked') continue;
    const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= 3.4 * 3.4 || d2 === 0) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    const impact = Math.abs((Math.sin(car.heading) * car.speed - Math.sin(o.heading) * o.speed) * nx +
      (-Math.cos(car.heading) * car.speed + Math.cos(o.heading) * o.speed) * nz);
    car.pos.x -= nx * (3.4 - d); car.pos.z -= nz * (3.4 - d);
    car.speed *= 0.55; o.speed *= 0.6;
    if (impact > C.carCollisionDamageSpeed) { const dmg = (impact - C.carCollisionDamageSpeed) * 2.5;
      damageVehicle(world, o.id, dmg, emit);
      damageVehicle(world, car.id, dmg, emit);
    }
  }
}
function _hitPeds(world, car, emit) { if (Math.abs(car.speed) <= 3) return;
  for (const ped of world.pedestrians) { if (ped.state === 'down' || ped.state === 'hostile' || ped.hostile === true) continue;
    const dx = ped.pos.x - car.pos.x, dz = ped.pos.z - car.pos.z;
    if (dx * dx + dz * dz < 2.4 * 2.4) { ped.state = 'down'; ped.scared = true; ped.speed = 0;
      car.speed *= 0.85;
      addHeat(world, 20, emit);
      _emit(emit, 'crime', { kind: 'hit-ped', amount: 20 });
    }
  }
}
export function enterVehicle(world, vehicleId, emit) { const p = world.player;
  if (!p.onFoot) return false;
  const v = world.vehicles.find((vv) => vv.id === vehicleId);
  if (!v || v.state === 'wrecked' || v.state === 'player') return false;
  if (v.driver === 'traffic' || v.driver === 'police') return false;
  const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, m = C.stealRange + 0.5;
  if (dx * dx + dz * dz > m * m) return false;
  p.onFoot = false; p.vehicleId = v.id; p.speed = 0;
  v.state = 'player'; v.driver = 'player';
  _emit(emit, 'car-entered', { vehicleId: v.id });
  return true;
}
export function exitVehicle(world, emit) { const p = world.player;
  if (p.onFoot || !p.vehicleId) return false;
  const v = world.vehicles.find((vv) => vv.id === p.vehicleId);
  if (!v) { p.onFoot = true; p.vehicleId = null; return true; }
  const rx = Math.cos(v.heading), rz = Math.sin(v.heading);
  let px = v.pos.x + rx * 2.4, pz = v.pos.z + rz * 2.4;
  if (collidesBuilding(world.city, px, pz, 0.5)) { px = v.pos.x - rx * 2.4; pz = v.pos.z - rz * 2.4; }
  p.pos.x = px; p.pos.z = pz; p.pos.y = 0; p.heading = v.heading; p.speed = 0;
  p.onFoot = true; p.vehicleId = null;
  if (v.state === 'player') { v.state = 'parked'; v.driver = 'none'; }
  if (v.stolen) _st(world).lastStolenId = v.id;
  _emit(emit, 'car-exited', { vehicleId: v.id });
  return true;
}
export function stealVehicle(world, vehicleId, emit) { const p = world.player;
  const v = world.vehicles.find((vv) => vv.id === vehicleId);
  if (!v || v.state === 'wrecked' || v.state === 'player' || !p.onFoot) return false;
  if (v.driver === 'police' || v.driver === 'mission') return false;
  const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, m = C.stealRange + 0.5;
  if (dx * dx + dz * dz > m * m) return false;
  const st = _st(world);
  const hadDriver = v.driver === 'traffic';
  if (hadDriver) _driverFlees(world, v, emit);
  v.stolen = true; v.state = 'player'; v.driver = 'player';
  p.onFoot = false; p.vehicleId = v.id; p.speed = 0;
  st.lastStolenId = v.id;
  world.stats.carsStolen += 1;
  _emit(emit, 'car-stolen', { vehicleId: v.id, make: v.make, model: v.model });
  const heat = hadDriver ? 35 : 25;
  addHeat(world, heat, emit);
  _emit(emit, 'crime', { kind: 'theft', amount: heat });
  if (st.rng.chance(0.4)) scarePedestrians(world, v.pos.x, v.pos.z, 15, emit);
  return true;
}
export function nearestEnterableCar(world, maxDist) { const limit = typeof maxDist === 'number' ? maxDist : C.stealRange;
  const p = world.player;
  let best = null, bestD = limit * limit;
  for (const v of world.vehicles) { if (v.state === 'wrecked' || v.state === 'player' || v.state === 'police') continue;
    if (v.driver === 'police') continue;
    const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}
export function damageVehicle(world, vehicleId, amount, emit) { const v = world.vehicles.find((vv) => vv.id === vehicleId);
  if (!v) return -1;
  if (v.state === 'wrecked') return 0;
  v.health = Math.max(0, v.health - amount);
  if (v.health > 0) return v.health;
  const wasPlayer = v.state === 'player';
  const hadDriver = v.driver === 'traffic';
  v.state = 'wrecked'; v.health = 0; v.speed = 0;
  if (hadDriver) _driverFlees(world, v, emit);
  v.driver = 'none';
  if (wasPlayer) { const p = world.player;
    p.onFoot = true; p.vehicleId = null; p.speed = 0; p.pos.y = 0;
    p.pos.x = v.pos.x + Math.cos(v.heading) * 2.4;
    p.pos.z = v.pos.z + Math.sin(v.heading) * 2.4;
    _emit(emit, 'car-exited', { vehicleId: v.id });
  }
  return 0;
}
export function isVehicleWrecked(vehicle) { return !vehicle || vehicle.health <= 0 || vehicle.state === 'wrecked';
}
