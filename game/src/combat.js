import { createRng } from './random.js';
import { addHeat, clearWanted } from './police.js';
import { collidesBuilding, clampToCity } from './city.js';
const PUNCH_R = 1.2, PUNCH_DMG = 12, PUNCH_CD = 0.5;
const PISTOL_DMG = 34, PISTOL_CD = 0.25, PISTOL_R = 60;
const MAG = 12, RELOAD_T = 1.2;
const E_HP = 100, E_MIN = 0.8, E_MAX = 1.6, E_HIT = 0.3, E_BULLET = 120;
const E_DMG = 12, E_CHASE = 2.2, E_RANGE = 25;
const REGEN_D = 8, REGEN_R = 2, SCARE_R = 12, TOL_P = 1.0, TOL_C = 2.2;
let _rt = null;
function rt(w) { const s = (w && w.seed) || 1;
  if (!_rt || _rt.w !== w || _rt.s !== s) _rt = { w, s, rng: createRng(s + 505),
    seq: 0, punchCd: 0, shootCd: 0, reloadT: 0, reloading: false, mag: 0, reserve: 0, lastHurt: -100, pending: [] };
  return _rt;
}
function ev(emit, t, p) { if (typeof emit === 'function') emit(t, p); }
function ensure(w) { if (!w.player) return false;
  if (!Array.isArray(w.pedestrians)) w.pedestrians = [];
  if (!Array.isArray(w.vehicles)) w.vehicles = [];
  if (!w.police) w.police = { wanted: 0, heat: 0, officers: [], cars: [], escapeTimer: 0, bustTimer: 0 };
  if (!Array.isArray(w.police.officers)) w.police.officers = [];
  return true;
}
function syncAmmo(w) { const r = rt(w), total = w.player.ammo || 0;
  if (r.mag + r.reserve !== total) { r.mag = Math.min(MAG, total); r.reserve = total - r.mag; r.reloading = false; }
}
function startReload(w) { const r = rt(w);
  if (r.reloading || r.reserve <= 0) return false;
  r.reloading = true; r.reloadT = RELOAD_T;
  return true;
}
function scare(w, x, z, emit) { for (const p of w.pedestrians) { if (p.hostile || p.state === 'down' || p.state === 'flee') continue;
    const dx = p.pos.x - x, dz = p.pos.z - z;
    if (dx * dx + dz * dz <= SCARE_R * SCARE_R) { p.state = 'flee'; p.scared = true;
      if (w.stats) w.stats.pedsScared = (w.stats.pedsScared || 0) + 1;
      ev(emit, 'ped-scared', { pedId: p.id });
    }
  }
}
export function punch(w, emit) { if (!ensure(w)) return false;
  const r = rt(w), pl = w.player;
  if (!pl.onFoot || r.punchCd > 0) return false;
  r.punchCd = PUNCH_CD;
  let best = null, bestD = PUNCH_R;
  const near = (id, x, z) => { const d = Math.hypot(x - pl.pos.x, z - pl.pos.z);
    if (d < bestD) { bestD = d; best = id; }
  };
  for (const p of w.pedestrians) if (p.state !== 'down') near(p.id, p.pos.x, p.pos.z);
  for (const o of w.police.officers) near(o.id, o.pos.x, o.pos.z);
  ev(emit, 'punch', { pos: { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z } });
  if (best) applyDamage(w, best, PUNCH_DMG, 'punch', emit);
  scare(w, pl.pos.x, pl.pos.z, emit);
  return true;
}
export function shoot(w, tp, emit) { if (!ensure(w)) return false;
  const r = rt(w), pl = w.player;
  if (!pl.onFoot || pl.weapon !== 'pistol') return false;
  syncAmmo(w);
  if (r.reloading || r.shootCd > 0) return false;
  if (r.mag <= 0) { startReload(w); return false; }
  r.mag -= 1; pl.ammo -= 1; r.shootCd = PISTOL_CD;
  if (w.stats) w.stats.shotsFired = (w.stats.shotsFired || 0) + 1;
  ev(emit, 'shot-fired', { pos: { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z } });
  addHeat(w, 10, emit);
  ev(emit, 'crime', { kind: 'shooting', amount: 10 });
  scare(w, pl.pos.x, pl.pos.z, emit);
  const hit = ray(w, pl.pos, tp, pl.heading);
  if (hit) applyDamage(w, hit.id, PISTOL_DMG, 'shot', emit);
  return true;
}
function ray(w, from, tp, heading) { let dx, dz;
  if (tp && typeof tp.x === 'number') { dx = tp.x - from.x; dz = tp.z - from.z; }
  else { dx = Math.sin(heading); dz = -Math.cos(heading); }
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return null;
  dx /= len; dz /= len;
  let best = null, bestT = PISTOL_R;
  const consider = (id, x, z, tol) => { const rx = x - from.x, rz = z - from.z, t = rx * dx + rz * dz;
    if (t <= 0 || t > bestT) return;
    const px = rx - t * dx, pz = rz - t * dz;
    if (px * px + pz * pz > tol * tol) return;
    bestT = t; best = { id, dist: t };
  };
  for (const p of w.pedestrians) if (p.state !== 'down') consider(p.id, p.pos.x, p.pos.z, TOL_P);
  for (const o of w.police.officers) consider(o.id, o.pos.x, o.pos.z, TOL_P);
  for (const v of w.vehicles) if (v.state !== 'wrecked') consider(v.id, v.pos.x, v.pos.z, TOL_C);
  return best;
}
export function applyDamage(w, target, amount, source, emit) { if (!w || !target || !(amount > 0) || !ensure(w)) return false;
  const r = rt(w);
  if (target === 'player') { const pl = w.player;
    let rest = amount;
    if (pl.armour > 0) { const a = Math.min(pl.armour, rest); pl.armour -= a; rest -= a; }
    if (rest > 0) pl.health = Math.max(0, pl.health - rest);
    r.lastHurt = w.clock || 0;
    ev(emit, 'damage', { amount, source: source || 'unknown' });
    if (pl.health <= 0) wasted(w, emit, amount, source);
    return true;
  }
  for (const v of w.vehicles) { if (v.id === target) { v.health = Math.max(0, v.health - amount);
      if (v.health <= 0) { v.state = 'wrecked';
        if (w.player.vehicleId === v.id) { w.player.onFoot = true; w.player.vehicleId = null; w.player.speed = 0;
        }
      }
      return true;
    }
  }
  const cops = w.police.officers;
  for (let i = 0; i < cops.length; i++) { if (cops[i].id === target) { const o = cops[i];
      o.health = (o.health == null ? 100 : o.health) - amount;
      if (o.health <= 0) { cops.splice(i, 1);
        addHeat(w, 35, emit);
        ev(emit, 'crime', { kind: 'cop-kill', amount: 35 });
      }
      return true;
    }
  }
  for (const p of w.pedestrians) { if (p.id === target) { if (p.hostile) { p.health = (p.health == null ? E_HP : p.health) - amount;
        if (p.health <= 0) { p.health = 0; p.state = 'down'; }
      } else { p.state = 'down'; p.scared = true; }
      return true;
    }
  }
  return false;
}
function wasted(w, emit, amount, source) { const pl = w.player, cash = pl.cash || 0, f = Math.min(100, Math.floor(cash * 0.1));
  if (f > 0) { pl.cash = cash - f; ev(emit, 'cash-changed', { cash: pl.cash, delta: -f }); }
  const ds = w.city && w.city.districts, d = ds && ds.find(r => r.name === 'Marina Quarter');
  pl.pos.x = d ? (d.x0 + d.x1) / 2 : 0; pl.pos.z = d ? (d.z0 + d.z1) / 2 + 12 : 12; pl.pos.y = 0;
  pl.heading = 0; pl.speed = 0;
  pl.health = 100; pl.onFoot = true; pl.vehicleId = null;
  clearWanted(w, emit);
  ev(emit, 'player-down', { amount: amount || 0, source: source || 'unknown', fine: f });
}
export function heal(w, amount, emit) { if (!w || !w.player || !(amount > 0)) return false;
  w.player.health = Math.min(100, w.player.health + amount);
  ev(emit, 'healed', { amount, source: 'pickup' });
  return true;
}
export function spawnEnemies(w, x, z, count, emit) { if (!ensure(w)) return 0;
  const r = rt(w);
  let made = 0;
  for (let i = 0; i < count; i++) { const a = r.rng.range(0, Math.PI * 2), d = r.rng.range(2, 9);
    let px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    if (w.city) { const s = clampToCity(w.city, px, pz); px = s.x; pz = s.z; }
    w.pedestrians.push({ id: 'enemy-' + w.tick + '-' + (++r.seq), pos: { x: px, y: 0, z: pz }, heading: r.rng.range(0, Math.PI * 2), speed: 0,
      state: 'hostile', colour: r.rng.pick([0x2b2b2b, 0x3a3a3a, 0x1a1a1a]),
      shirtColour: r.rng.pick([0x8a2a2a, 0x2a2a8a, 0x3a3a3a]), walkPhase: 0, scared: false,
      hostile: true, armed: true, health: E_HP, shootCooldown: r.rng.range(0.5, 1.5) });
    made++;
  }
  return made;
}
export function enemyCount(w) { if (!w || !w.pedestrians) return 0;
  let n = 0;
  for (const p of w.pedestrians) if (p.hostile && p.state !== 'down') n++;
  return n;
}
function updateEnemies(w, dt, emit) { const r = rt(w), pl = w.player;
  for (const e of w.pedestrians) { if (!e.hostile || e.state === 'down') continue;
    const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 0.001;
    e.heading = Math.atan2(dx, -dz);
    if (d > E_RANGE) { e.speed = E_CHASE;
      const step = E_CHASE * dt, nx = e.pos.x + (dx / d) * step, nz = e.pos.z + (dz / d) * step;
      if (!w.city || !collidesBuilding(w.city, nx, nz, 0.6)) { e.pos.x = nx; e.pos.z = nz; }
      e.walkPhase = (e.walkPhase || 0) + dt * 6;
    } else if (d > 3) { e.speed = 0;
      e.shootCooldown = (e.shootCooldown || 0) - dt;
      if (e.shootCooldown <= 0) { e.shootCooldown = r.rng.range(E_MIN, E_MAX);
        const blocked = w.city && collidesBuilding(w.city, (e.pos.x + pl.pos.x) / 2, (e.pos.z + pl.pos.z) / 2, 2);
        if (!blocked) { const p = Math.max(0.05, Math.min(0.5, E_HIT * (20 / Math.max(d, 5))));
          if (r.rng.chance(p)) r.pending.push({ timer: Math.max(0.05, d / E_BULLET), amount: E_DMG });
          ev(emit, 'shot-fired', { pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
        }
      }
    } else e.speed = 0;
  }
}
export function updateCombat(w, dt, emit) { if (!w || !w.player) return;
  if (w.screen && w.screen !== 'play') return;
  const r = rt(w);
  ensure(w);
  r.punchCd = Math.max(0, r.punchCd - dt);
  r.shootCd = Math.max(0, r.shootCd - dt);
  syncAmmo(w);
  if (r.reloading) { r.reloadT -= dt;
    if (r.reloadT <= 0) { r.reloading = false;
      const t = Math.min(MAG - r.mag, r.reserve);
      r.mag += t; r.reserve -= t;
    }
  } else if (w.player.weapon === 'pistol' && r.mag <= 0 && r.reserve > 0) startReload(w);
  const pl = w.player;
  if (pl.health > 0 && pl.health < 100 && (w.clock || 0) - r.lastHurt > REGEN_D)
    pl.health = Math.min(100, pl.health + REGEN_R * dt);
  for (let i = r.pending.length - 1; i >= 0; i--) { const s = r.pending[i];
    s.timer -= dt;
    if (s.timer <= 0) { r.pending.splice(i, 1); applyDamage(w, 'player', s.amount, 'enemy-shot', emit); }
  }
  updateEnemies(w, dt, emit);
}
