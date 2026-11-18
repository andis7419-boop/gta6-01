// combat.js — on-foot combat: fists, pistol, damage, health, enemy NPCs.
// Plain trig on world positions only; no three.js, no DOM, no unseeded RNG.
// All randomness comes from a seeded RNG kept on world.combat.

import { createRng } from './random.js';
import { damageVehicle } from './vehicles.js';

const FIST_DAMAGE = 12;
const FIST_COOLDOWN = 0.5; // s
const FIST_RANGE = 1.2; // m
const PISTOL_DAMAGE = 34;
const PISTOL_COOLDOWN = 0.25; // s
const PISTOL_RANGE = 60; // m
const PISTOL_CORRIDOR = 1.5; // m half-width of the aim corridor
const MAG_SIZE = 12;
const RELOAD_TIME = 1.2; // s
const ENEMY_HEALTH = 100;
const ENEMY_SHOT_MIN = 0.8; // s between enemy shots
const ENEMY_SHOT_MAX = 1.6; // s
const ENEMY_HIT_AT_20M = 0.3;
const ENEMY_DAMAGE = 8;
const REGEN_DELAY = 8; // s without damage before regen starts
const REGEN_RATE = 2; // health/s
const PICKUP_RADIUS = 1.6; // m
const HEALTH_PICKUP_AMOUNT = 40;

function _combat(world) {
  if (!world.combat) {
    world.combat = {
      punchCooldown: 0,
      shootCooldown: 0,
      reloading: false,
      reloadTimer: 0,
      lastDamageAt: -1000,
      magAmmo: MAG_SIZE,
      enemies: [],
      bullets: [],
      pickups: [],
      nextEnemyId: 1,
      nextPickupId: 1,
      clinicSpawned: false,
    };
  }
  const c = world.combat;
  if (!c.rng) c.rng = createRng((world.seed || 1) + 404);
  if (!Array.isArray(c.enemies)) c.enemies = [];
  if (!Array.isArray(c.bullets)) c.bullets = [];
  if (!Array.isArray(c.pickups)) c.pickups = [];
  return c;
}

function _emit(world, type, payload) {
  if (world.events && typeof world.events.emit === 'function') {
    world.events.emit(type, payload);
  }
}

function _playerPos(world) {
  return world.player.pos;
}

// Aim ray: the player heading is the aim direction (vehicles aligns the
// heading to the camera yaw while aiming). Returns the unit forward vector.
function _aimDir(world) {
  const h = world.player.heading || 0;
  return { x: Math.sin(h), z: -Math.cos(h) };
}

// Distance along the ray and perpendicular offset of point p from the ray
// starting at origin with unit direction dir. Returns null if behind.
function _rayHit(origin, dir, p) {
  const dx = p.x - origin.x;
  const dz = p.z - origin.z;
  const along = dx * dir.x + dz * dir.z;
  if (along < 0) return null;
  const perpX = dx - dir.x * along;
  const perpZ = dz - dir.z * along;
  return { along, perp: Math.hypot(perpX, perpZ) };
}

function _aliveEnemies(world) {
  return _combat(world).enemies.filter((e) => e.health > 0 && e.state !== 'down');
}

export function enemyCount(world) {
  return _aliveEnemies(world).length;
}

export function spawnEnemies(world, x, z, count) {
  const c = _combat(world);
  const made = [];
  for (let i = 0; i < count; i++) {
    const enemy = {
      id: 'enemy-' + (c.nextEnemyId++),
      pos: { x: x + c.rng.range(-4, 4), y: 0, z: z + c.rng.range(-4, 4) },
      heading: c.rng.range(0, Math.PI * 2),
      health: ENEMY_HEALTH,
      state: 'alive',
      // First shot comes soon, then every 0.8-1.6 s on the sim clock.
      nextShotAt: world.clock + c.rng.range(0.4, 1.2),
    };
    c.enemies.push(enemy);
    made.push(enemy);
  }
  return made;
}

// Health pickups (+40) for mission areas and the Marina clinic.
export function spawnHealthPickup(world, x, z) {
  const c = _combat(world);
  const pickup = {
    id: 'health-' + (c.nextPickupId++),
    kind: 'health',
    x,
    z,
    amount: HEALTH_PICKUP_AMOUNT,
    taken: false,
  };
  c.pickups.push(pickup);
  return pickup;
}

function _spawnClinicPickup(world) {
  const c = _combat(world);
  if (c.clinicSpawned) return;
  c.clinicSpawned = true;
  const districts = (world.city && world.city.districts) || [];
  const marina = districts.find((d) => d.name === 'Marina Quarter');
  if (marina) {
    spawnHealthPickup(world, (marina.x0 + marina.x1) / 2, (marina.z0 + marina.z1) / 2);
  }
}

export function punch(world) {
  const c = _combat(world);
  if (world.player.onFoot === false) return false;
  if (c.punchCooldown > 0) return false;
  c.punchCooldown = FIST_COOLDOWN;
  const origin = _playerPos(world);
  _emit(world, 'punch', { pos: { x: origin.x, y: origin.y, z: origin.z } });
  // Melee hits the closest living enemy inside the 1.2 m reach.
  let best = null;
  let bestDist = FIST_RANGE;
  for (const enemy of _aliveEnemies(world)) {
    const d = Math.hypot(enemy.pos.x - origin.x, enemy.pos.z - origin.z);
    if (d <= bestDist) {
      best = enemy;
      bestDist = d;
    }
  }
  if (best) {
    applyDamage(world, best.id, FIST_DAMAGE, 'punch');
    return true;
  }
  // No enemy in reach: a nearby pedestrian gets knocked down instead.
  // That is a crime (hit-ped) — police hears about it via the event.
  let ped = null;
  let pedDist = FIST_RANGE;
  for (const p of world.pedestrians || []) {
    if (p.state === 'down') continue;
    const d = Math.hypot(p.pos.x - origin.x, p.pos.z - origin.z);
    if (d <= pedDist) {
      ped = p;
      pedDist = d;
    }
  }
  if (ped) {
    applyDamage(world, ped.id, FIST_DAMAGE, 'punch');
    return true;
  }
  return true; // swung and missed; the punch still happened
}

export function reloadWeapon(world) {
  const c = _combat(world);
  if (c.reloading) return false;
  if (c.magAmmo >= MAG_SIZE) return false;
  if ((world.player.ammo || 0) <= 0) return false;
  c.reloading = true;
  c.reloadTimer = RELOAD_TIME;
  return true;
}

export function shoot(world, targetPoint) {
  const c = _combat(world);
  if (!world.player.onFoot) return false;
  if (world.player.weapon !== 'pistol') return false;
  if (c.reloading) return false;
  if (c.magAmmo <= 0) {
    reloadWeapon(world); // dry magazine: start the reload even mid-cooldown
    return false;
  }
  if (c.shootCooldown > 0) return false;
  c.shootCooldown = PISTOL_COOLDOWN;
  c.magAmmo -= 1;
  if (world.stats) world.stats.shotsFired = (world.stats.shotsFired || 0) + 1;
  const origin = _playerPos(world);
  const dir = _aimDir(world);
  _emit(world, 'shot-fired', { pos: { x: origin.x, y: origin.y, z: origin.z } });
  _emit(world, 'crime', { kind: 'shooting', amount: 10 });

  // Hitscan along the heading ray: first enemy, vehicle or pedestrian
  // inside the 1.5 m corridor and 60 m range takes the round.
  let bestAlong = PISTOL_RANGE;
  let bestTarget = null; // { kind: 'enemy'|'vehicle'|'ped', id }
  for (const enemy of _aliveEnemies(world)) {
    const hit = _rayHit(origin, dir, enemy.pos);
    if (hit && hit.perp <= PISTOL_CORRIDOR && hit.along <= bestAlong) {
      bestAlong = hit.along;
      bestTarget = { kind: 'enemy', id: enemy.id };
    }
  }
  for (const v of world.vehicles || []) {
    if (v.state === 'wrecked') continue;
    const hit = _rayHit(origin, dir, v.pos);
    if (hit && hit.perp <= PISTOL_CORRIDOR && hit.along <= bestAlong) {
      bestAlong = hit.along;
      bestTarget = { kind: 'vehicle', id: v.id };
    }
  }
  for (const p of world.pedestrians || []) {
    if (p.state === 'down') continue;
    const hit = _rayHit(origin, dir, p.pos);
    if (hit && hit.perp <= PISTOL_CORRIDOR && hit.along <= bestAlong) {
      bestAlong = hit.along;
      bestTarget = { kind: 'ped', id: p.id };
    }
  }
  const end = {
    x: origin.x + dir.x * bestAlong,
    y: (origin.y || 0) + 1.3,
    z: origin.z + dir.z * bestAlong,
  };
  // A short-lived tracer for render.js to draw; pure presentation data.
  c.bullets.push({ from: { x: origin.x, y: (origin.y || 0) + 1.3, z: origin.z }, to: end, ttl: 0.08 });
  if (bestTarget) applyDamage(world, bestTarget.id, PISTOL_DAMAGE, 'pistol');
  return true;
}

// target: 'player' | vehicleId | pedId | enemyId.
export function applyDamage(world, target, amount, source) {
  const c = _combat(world);
  if (target === 'player') {
    const player = world.player;
    if (player.health <= 0) return;
    let remaining = amount;
    if (player.armour > 0) {
      const absorbed = Math.min(player.armour, remaining);
      player.armour -= absorbed;
      remaining -= absorbed;
    }
    player.health = Math.max(0, player.health - remaining);
    c.lastDamageAt = world.clock;
    _emit(world, 'damage', { amount, source: source || 'unknown' });
    if (player.health <= 0) {
      _emit(world, 'player-down', {});
    }
    return;
  }
  const vehicle = (world.vehicles || []).find((v) => v.id === target);
  if (vehicle) {
    damageVehicle(world, vehicle.id, amount);
    _emit(world, 'damage', { amount, source: source || 'unknown' });
    return;
  }
  const enemy = c.enemies.find((e) => e.id === target);
  if (enemy && enemy.health > 0) {
    enemy.health = Math.max(0, enemy.health - amount);
    _emit(world, 'damage', { amount, source: source || 'unknown' });
    if (enemy.health <= 0) {
      enemy.state = 'down';
    }
    return;
  }
  const ped = (world.pedestrians || []).find((p) => p.id === target);
  if (ped) {
    ped.state = 'down';
    ped.scared = true;
    _emit(world, 'damage', { amount, source: source || 'unknown' });
    _emit(world, 'crime', { kind: 'hit-ped', amount: 20 });
  }
}

export function heal(world, amount) {
  const player = world.player;
  if (player.health <= 0) return 0;
  const healed = Math.min(amount, 100 - player.health);
  if (healed <= 0) return 0;
  player.health += healed;
  _emit(world, 'healed', { amount: healed, source: 'pickup' });
  return healed;
}

function _enemyFire(world, dt) {
  const c = _combat(world);
  const player = world.player;
  if (player.health <= 0) return;
  for (const enemy of _aliveEnemies(world)) {
    if (world.clock < enemy.nextShotAt) continue;
    enemy.nextShotAt = world.clock + c.rng.range(ENEMY_SHOT_MIN, ENEMY_SHOT_MAX);
    const dist = Math.hypot(player.pos.x - enemy.pos.x, player.pos.z - enemy.pos.z);
    if (dist > PISTOL_RANGE) continue;
    // 30% at 20 m, worse further away, better up close (capped at 60%).
    const chance = Math.max(0.05, Math.min(0.6, ENEMY_HIT_AT_20M * (20 / Math.max(dist, 1))));
    c.bullets.push({
      from: { x: enemy.pos.x, y: 1.3, z: enemy.pos.z },
      to: { x: player.pos.x, y: 1.3, z: player.pos.z },
      ttl: 0.08,
    });
    if (c.rng.chance(chance)) {
      if (player.onFoot) {
        applyDamage(world, 'player', ENEMY_DAMAGE, 'enemy');
      } else if (player.vehicleId) {
        damageVehicle(world, player.vehicleId, ENEMY_DAMAGE * 0.75);
      }
    }
  }
}

function _pickups(world) {
  const c = _combat(world);
  const player = world.player;
  if (!player.onFoot || player.health <= 0) return;
  for (const pickup of c.pickups) {
    if (pickup.taken) continue;
    const d = Math.hypot(player.pos.x - pickup.x, player.pos.z - pickup.z);
    if (d > PICKUP_RADIUS) continue;
    pickup.taken = true;
    if (pickup.kind === 'health') {
      const healed = heal(world, pickup.amount);
      _emit(world, 'pickup', { kind: 'health', amount: healed });
    } else if (pickup.kind === 'ammo') {
      world.player.ammo = (world.player.ammo || 0) + pickup.amount;
      _emit(world, 'pickup', { kind: 'ammo', amount: pickup.amount });
    }
  }
  c.pickups = c.pickups.filter((p) => !p.taken);
}

export function updateCombat(world, dt) {
  if (world.paused) return;
  if (world.screen && world.screen !== 'play') return;
  const c = _combat(world);
  _spawnClinicPickup(world);

  if (c.punchCooldown > 0) c.punchCooldown -= dt;
  if (c.shootCooldown > 0) c.shootCooldown -= dt;

  // Reload: 1.2 s, then move rounds from the player's ammo pool into the magazine.
  if (c.reloading) {
    c.reloadTimer -= dt;
    if (c.reloadTimer <= 0) {
      c.reloading = false;
      const need = MAG_SIZE - c.magAmmo;
      const moved = Math.min(need, world.player.ammo || 0);
      c.magAmmo += moved;
      world.player.ammo -= moved;
    }
  } else if (c.magAmmo <= 0 && (world.player.ammo || 0) > 0) {
    reloadWeapon(world);
  }

  // Bullet tracers fade out fast; they are presentation only.
  for (const b of c.bullets) b.ttl -= dt;
  c.bullets = c.bullets.filter((b) => b.ttl > 0);

  // Health regen: +2/s after 8 s without taking damage, up to 100.
  const player = world.player;
  if (player.health > 0 && player.health < 100 && world.clock - c.lastDamageAt >= REGEN_DELAY) {
    player.health = Math.min(100, player.health + REGEN_RATE * dt);
  }

  _enemyFire(world, dt);
  _pickups(world);
}
