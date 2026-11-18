// vehicles.js — cars: models, arcade physics, enter / exit / steal,
// and the on-foot move (which lives here, not in main.js).
//
// Arcade physics on purpose: throttle / brake / reverse with a
// speed-scaled steering limit and a handbrake slide. Collisions are cheap
// circle checks — a building stops the car with a small bounce, another car
// slows both and damages both only on a hard hit, a pedestrian hit at
// speed knocks the pedestrian down and counts as a crime.
//
// Events go out on the world bus (world.events.emit): car-stolen,
// car-entered, car-exited, crime (theft / hit-ped), ped-scared (a driver
// fleeing). This module never calls another module's update and never
// writes police heat directly — police.js reacts to the events.
//
// Movement is camera-relative: the mouse orbits the camera (main.js keeps
// its yaw in world.cameraYaw), W walks away from the camera, A/D strafe
// across it. The character faces where it moves — or the aim direction
// while aiming, which is how shooting aims.

import { GAME_CONFIG, PALETTE } from './config.js';
import { createRng } from './random.js';
import { collidesBuilding, clampToCity, randomParkedSpot } from './city.js';
import { isDown, wasPressed } from './input.js';
import { scarePedestrians } from './pedestrians.js';

const C = GAME_CONFIG;
const GRAVITY = 16; // m/s^2 for the on-foot hop; jumpHeight/jumpTime in config
const CAR_RADIUS = 2.2; // collision radius used for car-car and car-ped
const PED_HIT_RADIUS = 2.4;
const STEAL_CLEAR_DIST = 30; // walk this far from a stolen car to clear it
const ENTER_RANGE = 4; // enterVehicle allows a little slack past steal range
const PARKED_TAXI_CHANCE = 0.1;
const PARKED_SPORT_CHANCE = 0.12;

// Per-kind tuning. Top speed / accel come from config; grip scales the
// steering bite and the handbrake slide. Makes and models are invented
// for this game (Veltor, Cascada, Halcyon); nothing is borrowed.
const KIND = {
  sedan: { top: C.topSpeed, accel: C.driveAccel, grip: 1, models: ['Veltor Largo', 'Cascada Marina', 'Halcyon Drift'] },
  taxi: { top: C.topSpeed, accel: C.driveAccel, grip: 1, models: ['Cascada Cab'] },
  pickup: { top: 36, accel: 12, grip: 0.95, models: ['Veltor Hauler', 'Halcyon Rancher'] },
  van: { top: 34, accel: 11, grip: 0.9, models: ['Halcyon Carrier', 'Veltor Mover'] },
  sport: { top: C.sportTopSpeed, accel: 17, grip: 1.15, models: ['Veltor Comet', 'Halcyon Stinger', 'Cascada Viento'] },
  police: { top: C.policeTopSpeed, accel: 16, grip: 1.1, models: ['Veltor Interceptor'] },
};

const TAXI_PAINT = 0xe8b820;

// Per-world private state (steal progress, hop, stolen-car tracking),
// kept in a WeakMap so a fresh world starts clean with no re-seeding.
const _worldState = new WeakMap();
function _st(world) {
  let s = _worldState.get(world);
  if (!s || world.tick < s.lastTick) {
    s = {
      rng: createRng((world.seed || 1) + 404),
      steal: null, // { vehicleId, t } while the 0.8 s door-open pause runs
      lastStolen: null, // { vehicleId, x, z } exit point of a stolen car
      hopVy: 0,
      hopY: 0,
      lastTick: 0,
    };
    _worldState.set(world, s);
  }
  s.lastTick = world.tick;
  return s;
}

function _emit(world, type, payload) {
  if (world.events && typeof world.events.emit === 'function') {
    world.events.emit(type, payload);
  }
}

// Deterministic pick from a list, keyed by an id string.
function _pickById(list, id) {
  let h = 0;
  const key = String(id);
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

function _dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function _findVehicle(world, vehicleId) {
  for (const v of world.vehicles) {
    if (v.id === vehicleId) return v;
  }
  return null;
}

export function createVehicle(id, kind, x, z, heading, colour) {
  const spec = KIND[kind] || KIND.sedan;
  const parts = _pickById(spec.models, id).split(' ');
  let paint = colour;
  if (typeof paint !== 'number') {
    if (kind === 'taxi') paint = TAXI_PAINT;
    else if (kind === 'police') paint = PALETTE.policeBlue;
    else paint = _pickById(PALETTE.carColours, id);
  }
  return {
    id,
    make: parts[0],
    model: parts.slice(1).join(' '),
    kind: kind in KIND ? kind : 'sedan',
    pos: { x, y: 0, z },
    heading,
    speed: 0,
    steer: 0,
    colour: paint,
    state: 'parked',
    health: 100,
    stolen: false,
    driver: 'none',
    lightsOn: false,
  };
}

export function spawnParkedCars(world, rng, count) {
  const p = world.player.pos;
  for (let i = 0; i < count; i++) {
    const spot = randomParkedSpot(world.city, rng);
    if (!spot) continue;
    // Keep the player's starting patch clear so the first steal is a walk.
    if (_dist2(spot.x, spot.z, p.x, p.z) < 36) continue;
    const roll = rng.next();
    const kind = roll < PARKED_TAXI_CHANCE
      ? 'taxi'
      : roll < PARKED_TAXI_CHANCE + PARKED_SPORT_CHANCE
        ? 'sport'
        : rng.chance(0.12) ? 'pickup' : rng.chance(0.12) ? 'van' : 'sedan';
    const car = createVehicle('parked-' + i + '-' + world.seed, kind, spot.x, spot.z, spot.heading);
    world.vehicles.push(car);
  }
}

// Arcade drive physics: pure kinematics, no world queries, so police.js
// can steer pursuit cars through the same helper. Collision with the
// world is the caller's job (updateVehicles does it for the player car).
export function drivePhysics(vehicle, input, dt) {
  const spec = KIND[vehicle.kind] || KIND.sedan;
  const speed = vehicle.speed;
  const steerInput = (isDown(input, 'right') ? 1 : 0) - (isDown(input, 'left') ? 1 : 0);
  // Steering authority fades as speed rises, so fast cars feel stable.
  const steerRange = (C.driveSteerMax || 0.55)
    * Math.max(0.35, 1 - Math.abs(speed) * (C.driveSteerSpeedFalloff || 0.011));
  const steerTarget = steerInput * steerRange;
  vehicle.steer += (steerTarget - vehicle.steer) * Math.min(1, dt * 10);

  const handbrake = isDown(input, 'handbrake');
  if (isDown(input, 'forward')) {
    if (speed < 0) vehicle.speed += C.brakeDecel * dt; // braking while reversing
    else if (speed < spec.top) vehicle.speed += spec.accel * dt;
  } else if (isDown(input, 'back')) {
    if (speed > 0.5) vehicle.speed -= C.brakeDecel * dt; // brake first
    else if (speed > -C.reverseSpeed) vehicle.speed -= spec.accel * 0.7 * dt;
  } else {
    vehicle.speed -= vehicle.speed * 0.4 * dt; // coast-down drag
  }
  if (handbrake) vehicle.speed -= vehicle.speed * 1.4 * dt;
  if (vehicle.speed > spec.top) vehicle.speed = spec.top;
  if (vehicle.speed < -C.reverseSpeed) vehicle.speed = -C.reverseSpeed;
  if (Math.abs(vehicle.speed) < 0.05 && !isDown(input, 'forward') && !isDown(input, 'back')) {
    vehicle.speed = 0;
  }

  // Yaw follows steering, scaled by how fast the car is actually moving;
  // the handbrake cuts grip and lets the tail step out.
  const grip = handbrake ? 0.45 : spec.grip;
  const yawRate = vehicle.steer * Math.min(1, Math.abs(vehicle.speed) / 6) * 1.7 * grip
    + (handbrake && Math.abs(vehicle.speed) > 5 ? vehicle.steer * 1.1 : 0);
  vehicle.heading += yawRate * Math.sign(vehicle.speed || 1) * dt;

  vehicle.pos.x += Math.sin(vehicle.heading) * vehicle.speed * dt;
  vehicle.pos.z -= Math.cos(vehicle.heading) * vehicle.speed * dt;
}

// Building stop + bounce, car-car bumps, pedestrian hits for the
// player's car. prevX/prevZ is where the car was before this step, so a
// building hit can put it back.
function _collidePlayerCar(world, car, prevX, prevZ) {
  const city = world.city;
  if (collidesBuilding(city, car.pos.x, car.pos.z, CAR_RADIUS)) {
    const impact = Math.abs(car.speed);
    car.pos.x = prevX;
    car.pos.z = prevZ;
    car.speed *= -0.25; // small bounce back off the wall
    if (impact > 12) damageVehicle(world, car.id, (impact - 12) * 0.8);
    return;
  }
  for (const other of world.vehicles) {
    if (other === car) continue;
    const rr = CAR_RADIUS * 2;
    if (_dist2(car.pos.x, car.pos.z, other.pos.x, other.pos.z) >= rr * rr) continue;
    if (other.state === 'wrecked') {
      car.speed *= 0.45; // a wreck is still an obstacle, just a dead one
      continue;
    }
    const impact = Math.abs(car.speed - other.speed);
    if (impact > (C.carCollisionDamageSpeed || 5)) {
      const hurt = (impact - (C.carCollisionDamageSpeed || 5)) * 2;
      damageVehicle(world, other.id, hurt);
      damageVehicle(world, car.id, hurt * 0.5);
    }
    // Both cars shed speed; the other car gets shoved along its heading.
    car.speed *= 0.45;
    other.speed *= 0.6;
    other.pos.x += Math.sin(other.heading) * 0.6;
    other.pos.z -= Math.cos(other.heading) * 0.6;
  }
  for (const ped of world.pedestrians) {
    if (ped.state === 'down') continue;
    if (_dist2(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z) >= PED_HIT_RADIUS * PED_HIT_RADIUS) continue;
    if (Math.abs(car.speed) <= 3) continue;
    ped.state = 'down';
    ped.speed = 0;
    ped.scared = true;
    car.speed *= 0.7;
    _emit(world, 'crime', { kind: 'hit-ped', amount: 20 });
    scarePedestrians(world, car.pos.x, car.pos.z, 12);
  }
}

function _moveOnFoot(world, dt, input) {
  const p = world.player;
  const st = _st(world);
  const aiming = isDown(input, 'aim');
  p.isAiming = aiming;

  // Movement is relative to the camera yaw (main.js keeps it in
  // world.cameraYaw): W walks away from the camera, A/D strafe across it.
  // The character faces where it moves — or the aim direction while aiming.
  const basis = (typeof world.cameraYaw === 'number') ? world.cameraYaw : p.heading;

  const fwd = (isDown(input, 'forward') ? 1 : 0) - (isDown(input, 'back') ? 1 : 0);
  const strafe = (isDown(input, 'right') ? 1 : 0) - (isDown(input, 'left') ? 1 : 0);
  let speed = C.walkSpeed || 4.2;
  if (isDown(input, 'sprint') && !aiming) speed = C.runSpeed || 6.8;
  if (aiming) speed *= 0.5; // slow, careful walk while aiming
  p.isRunning = isDown(input, 'sprint') && fwd !== 0 && !aiming;

  const len = Math.hypot(fwd, strafe) || 1;
  const mx = (Math.sin(basis) * fwd + Math.cos(basis) * strafe) / len;
  const mz = (-Math.cos(basis) * fwd + Math.sin(basis) * strafe) / len;
  if (aiming) p.heading = basis;
  else if (fwd !== 0 || strafe !== 0) p.heading = Math.atan2(mx, -mz);
  const step = speed * dt;
  const nx = p.pos.x + mx * step;
  const nz = p.pos.z + mz * step;

  // Slide along walls: try the full move, then each axis alone.
  if (!collidesBuilding(world.city, nx, nz, C.playerRadius || 0.45)) {
    p.pos.x = nx;
    p.pos.z = nz;
  } else if (!collidesBuilding(world.city, nx, p.pos.z, C.playerRadius || 0.45)) {
    p.pos.x = nx;
  } else if (!collidesBuilding(world.city, p.pos.x, nz, C.playerRadius || 0.45)) {
    p.pos.z = nz;
  }
  const clamped = clampToCity(world.city, p.pos.x, p.pos.z);
  p.pos.x = clamped.x;
  p.pos.z = clamped.z;
  p.speed = (fwd !== 0 || strafe !== 0) ? speed : 0;
  if (world.stats) world.stats.distanceWalked += p.speed * dt;

  // Small hop on handbrake (Space). Gravity and air time come from config.
  if (wasPressed(input, 'handbrake') && st.hopY <= 0) {
    const airTime = C.jumpTime || 0.45;
    st.hopVy = (GRAVITY * airTime) / 2;
  }
  if (st.hopY > 0 || st.hopVy > 0) {
    st.hopY += st.hopVy * dt;
    st.hopVy -= GRAVITY * dt;
    if (st.hopY <= 0) {
      st.hopY = 0;
      st.hopVy = 0;
    }
    p.pos.y = st.hopY;
  }
}

function _updateSteal(world, dt, input) {
  const st = _st(world);
  if (!st.steal) return;
  const car = _findVehicle(world, st.steal.vehicleId);
  const p = world.player;
  if (!car || isVehicleWrecked(car) || _dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z) > 12.25) {
    st.steal = null; // walked away or the car vanished: door stays shut
    return;
  }
  st.steal.t += dt;
  if (st.steal.t >= (C.stealTime || 0.8)) {
    st.steal = null;
    stealVehicle(world, car.id);
  }
}

export function updateVehicles(world, dt, input) {
  const p = world.player;
  const st = _st(world);

  if (!p.onFoot) {
    const car = _findVehicle(world, p.vehicleId);
    if (!car || isVehicleWrecked(car)) {
      if (car) exitVehicle(world);
      p.onFoot = true;
      p.vehicleId = null;
      p.speed = 0;
    } else {
      const prevX = car.pos.x;
      const prevZ = car.pos.z;
      drivePhysics(car, input, dt);
      _collidePlayerCar(world, car, prevX, prevZ);
      const clamped = clampToCity(world.city, car.pos.x, car.pos.z);
      car.pos.x = clamped.x;
      car.pos.z = clamped.z;
      car.lightsOn = world.timeOfDay >= 17 || world.timeOfDay < 6.5;
      p.pos.x = car.pos.x;
      p.pos.y = 0;
      p.pos.z = car.pos.z;
      p.heading = car.heading;
      p.speed = car.speed;
      if (world.stats) world.stats.distanceDriven += Math.abs(car.speed) * dt;
      if (wasPressed(input, 'enterCar')) exitVehicle(world);
      if (isVehicleWrecked(car)) exitVehicle(world);
    }
    return;
  }

  _moveOnFoot(world, dt, input);
  _updateSteal(world, dt, input);

  // A stolen car stops being "stolen" once the player walks away from it.
  if (st.lastStolen) {
    const car = _findVehicle(world, st.lastStolen.vehicleId);
    if (!car || _dist2(p.pos.x, p.pos.z, st.lastStolen.x, st.lastStolen.z)
      > STEAL_CLEAR_DIST * STEAL_CLEAR_DIST) {
      if (car) car.stolen = false;
      st.lastStolen = null;
    }
  }

  if (!st.steal && wasPressed(input, 'enterCar')) {
    const car = nearestEnterableCar(world, C.stealRange || 3);
    if (!car) return;
    if (car.state === 'mission' && car.driver === 'none') {
      enterVehicle(world, car.id); // assigned car: just get in
    } else {
      st.steal = { vehicleId: car.id, t: 0 }; // door-open pause, then steal
    }
  }
}

export function enterVehicle(world, vehicleId) {
  const p = world.player;
  const car = _findVehicle(world, vehicleId);
  if (!car || isVehicleWrecked(car) || p.vehicleId) return false;
  if (car.driver !== 'none' && car.driver !== 'player') return false;
  if (_dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z) > ENTER_RANGE * ENTER_RANGE) return false;
  p.onFoot = false;
  p.vehicleId = car.id;
  p.pos.x = car.pos.x;
  p.pos.z = car.pos.z;
  p.heading = car.heading;
  p.speed = car.speed;
  car.state = 'player';
  car.driver = 'player';
  _emit(world, 'car-entered', { vehicleId: car.id });
  return true;
}

export function exitVehicle(world) {
  const p = world.player;
  const car = _findVehicle(world, p.vehicleId);
  if (!car || p.onFoot) return false;
  // Step out on the car's right-hand side; fall back to the left, then back.
  const rx = Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  const spots = [
    { x: car.pos.x + rx * 2.4, z: car.pos.z + rz * 2.4 },
    { x: car.pos.x - rx * 2.4, z: car.pos.z - rz * 2.4 },
    { x: car.pos.x - Math.sin(car.heading) * 3, z: car.pos.z + Math.cos(car.heading) * 3 },
  ];
  let spot = spots[2];
  for (const s of spots) {
    if (!collidesBuilding(world.city, s.x, s.z, C.playerRadius || 0.45)) {
      spot = s;
      break;
    }
  }
  const clamped = clampToCity(world.city, spot.x, spot.z);
  p.pos.x = clamped.x;
  p.pos.z = clamped.z;
  p.pos.y = 0;
  p.onFoot = true;
  p.vehicleId = null;
  p.speed = 0;
  car.state = car.kind === 'police' ? 'police' : car.state === 'mission' ? 'mission' : 'parked';
  car.driver = 'none';
  car.speed = 0;
  car.steer = 0;
  if (car.stolen) _st(world).lastStolen = { vehicleId: car.id, x: car.pos.x, z: car.pos.z };
  _emit(world, 'car-exited', { vehicleId: car.id });
  return true;
}

export function stealVehicle(world, vehicleId) {
  const p = world.player;
  const car = _findVehicle(world, vehicleId);
  if (!car || isVehicleWrecked(car) || p.vehicleId) return false;
  if (car.state !== 'parked' && car.state !== 'traffic' && car.state !== 'mission') return false;
  if (_dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z) > 12.25) return false;

  let extraHeat = 0;
  if (car.driver === 'traffic') {
    // Yank the driver out: they flee on foot as a pedestrian.
    const a = _st(world).rng.range(0, Math.PI * 2);
    const driverId = 'ped-driver-' + car.id;
    if (!world.pedestrians.some((ped) => ped.id === driverId)) {
      world.pedestrians.push({
        id: driverId,
        pos: {
          x: car.pos.x + Math.sin(a) * 2,
          y: 0,
          z: car.pos.z - Math.cos(a) * 2,
        },
        heading: a,
        speed: 3.5,
        state: 'flee',
        colour: 0x2b3a4d,
        shirtColour: 0x3a6fd8,
        walkPhase: 0,
        scared: true,
      });
      if (world.stats) world.stats.pedsScared += 1;
      _emit(world, 'ped-scared', { pedId: driverId });
    }
    extraHeat = 10;
  }

  car.stolen = true;
  car.state = 'player';
  car.driver = 'player';
  p.onFoot = false;
  p.vehicleId = car.id;
  p.pos.x = car.pos.x;
  p.pos.z = car.pos.z;
  p.heading = car.heading;
  p.speed = 0;
  if (world.stats) world.stats.carsStolen += 1;
  _emit(world, 'car-stolen', { vehicleId: car.id, make: car.make, model: car.model });
  _emit(world, 'crime', { kind: 'theft', amount: 25 + extraHeat });
  return true;
}

export function nearestEnterableCar(world, maxDist) {
  const p = world.player;
  const limit = (typeof maxDist === 'number' ? maxDist : C.stealRange || 3);
  let best = null;
  let bestD = limit * limit;
  for (const car of world.vehicles) {
    if (car.state !== 'parked' && car.state !== 'traffic' && car.state !== 'mission') continue;
    if (car.driver === 'police') continue;
    if (isVehicleWrecked(car)) continue;
    const d = _dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z);
    if (d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

export function damageVehicle(world, vehicleId, amount) {
  const car = _findVehicle(world, vehicleId);
  if (!car || car.state === 'wrecked') return;
  car.health -= amount;
  if (car.health <= 0) {
    car.health = 0;
    car.state = 'wrecked';
    car.speed = 0;
    // A wrecked car throws its driver out onto the street.
    if (world.player.vehicleId === car.id) exitVehicle(world);
  }
}

export function isVehicleWrecked(vehicle) {
  return !vehicle || vehicle.health <= 0 || vehicle.state === 'wrecked';
}
