import { createRng } from './random.js';
import { GAME_CONFIG, CITY_CONFIG, PALETTE } from './config.js';
import { collidesBuilding, nearestRoadPoint, clampToCity, isRoad } from './city.js';
const BAND = 20, MAX = 100, SEE = 60, CLOSE = 25;
const PITCH = CITY_CONFIG.blockSize + CITY_CONFIG.roadWidth;
const HALF = CITY_CONFIG.citySize / 2;
const gridLine = (v) => -HALF + PITCH * Math.round((v + HALF) / PITCH);
const DECAY = 2, CALM = 6, ESC = [0, 12, 12, 20, 20, 20];
const FOOT = 4.5, PATROL = 1.2, ARREST_D = 2, ARREST_T = 2;
const SP_MIN = 50, SP_MAX = 85, RAM_D = 3.6, RAM_DMG = 6, RAM_SLOW = 0.5;
const TURN = 2.4, ACC = 16, BRK = 24;
const FORCE = [ { c: 0, o: 0 }, { c: 1, o: 0 }, { c: 2, o: 0 }, { c: 2, o: 2 }, { c: 3, o: 3 }, { c: 4, o: 4 }, ];
let _rt = null;
function rt(w) { const s = (w && w.seed) || 1;
  if (!_rt || _rt.w !== w || _rt.s !== s) _rt = { w, s, rng: createRng(s + 404), car: 0, cop: 0 };
  return _rt;
}
function ev(emit, t, p) { if (typeof emit === 'function') emit(t, p); }
function ensure(w) { if (!w.police) w.police = { wanted: 0, heat: 0, officers: [], cars: [], escapeTimer: 0, bustTimer: 0 };
  const p = w.police;
  if (!Array.isArray(p.officers)) p.officers = [];
  if (!Array.isArray(p.cars)) p.cars = [];
  if (!Array.isArray(w.vehicles)) w.vehicles = [];
  if (w.player && typeof w.player.wantedHeat !== 'number') w.player.wantedHeat = p.heat || 0;
}
function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function hdg(dx, dz) { return Math.atan2(dx, -dz); }
function dst(ax, az, bx, bz) { const x = ax - bx, z = az - bz; return Math.sqrt(x * x + z * z); }
function sees(w, fx, fz) { const p = w.player.pos, d = dst(fx, fz, p.x, p.z);
  if (d > SEE) return false;
  if (d < CLOSE) return true;
  if (!w.city || !w.city.buildings) return true;
  return collidesBuilding(w.city, (fx + p.x) / 2, (fz + p.z) / 2, 2) === null;
}
function anySees(w) { for (const v of w.vehicles)
    if (v.kind === 'police' && v.state === 'police' && v.health > 0 && sees(w, v.pos.x, v.pos.z)) return true;
  for (const o of w.police.officers) if (sees(w, o.pos.x, o.pos.z)) return true;
  return false;
}
function cars(w) { return w.vehicles.filter(v => v.kind === 'police' && v.state === 'police' && v.health > 0); }
function byId(w, id) { for (const v of w.vehicles) if (v.id === id) return v; return null; }
function farthest(list, w) { let f = list[0], fd = -1;
  for (const m of list) { const d = dst(m.pos.x, m.pos.z, w.player.pos.x, w.player.pos.z); if (d > fd) { fd = d; f = m; } }
  return f;
}
export function getWantedLevel(heat) { if (heat <= 0) return 0;
  return Math.min(5, Math.floor(heat / BAND) + 1);
}
function sync(w, emit) { const l = getWantedLevel(w.police.heat);
  if (w.player) w.player.wantedHeat = w.police.heat;
  if (l !== w.police.wanted) { w.police.wanted = l; ev(emit, 'wanted-changed', { wanted: l, heat: w.police.heat }); }
  return l;
}
export function addHeat(w, amount, emit) { if (!w || !w.police || !amount) return;
  ensure(w);
  const add = w.police.wanted >= 1 ? amount * 2 : amount;
  w.police.heat = Math.max(0, Math.min(MAX, w.police.heat + add));
  w.police.escapeTimer = 0;
  sync(w, emit);
}
export function clearWanted(w, emit) { if (!w || !w.police) return;
  ensure(w);
  w.police.heat = 0; w.police.escapeTimer = 0; w.police.bustTimer = 0;
  for (let i = w.vehicles.length - 1; i >= 0; i--) { const v = w.vehicles[i];
    if (v.kind === 'police' && v.state === 'police') w.vehicles.splice(i, 1);
  }
  w.police.cars = []; w.police.officers.length = 0;
  sync(w, emit);
}
export function spawnPoliceCar(w, emit) { ensure(w);
  const r = rt(w), p = w.player.pos;
  let x = p.x, z = p.z, h = 0, best = null;
  for (let i = 0; i < 4; i++) { const a = r.rng.range(0, Math.PI * 2), d = r.rng.range(SP_MIN, SP_MAX);
    let cx = p.x + Math.sin(a) * d, cz = p.z + Math.cos(a) * d, ch = hdg(p.x - cx, p.z - cz);
    if (w.city) { const road = nearestRoadPoint(w.city, cx, cz), s = clampToCity(w.city, road.x, road.z);
      cx = s.x; cz = s.z; ch = road.heading;
    }
    const dd = dst(cx, cz, p.x, p.z);
    if (dd >= SP_MIN && dd <= 70) { x = cx; z = cz; h = ch; best = null; break; }
    if (!best || Math.abs(dd - 60) < Math.abs(best.d - 60)) best = { x: cx, z: cz, h: ch, d: dd };
  }
  if (best) { x = best.x; z = best.z; h = best.h;
    if (best.d < SP_MIN) { const dir = Math.sin(h) * (x - p.x) - Math.cos(h) * (z - p.z) >= 0 ? 1 : -1;
      const push = SP_MIN + 5 - best.d;
      x += Math.sin(h) * dir * push; z += -Math.cos(h) * dir * push;
    }
  }
  const id = 'police-' + w.tick + '-' + (++r.car);
  const car = { id, make: 'Veltor', model: 'Interceptor', kind: 'police', pos: { x, y: 0, z }, heading: h, speed: 0, steer: 0, colour: PALETTE.policeBlue,
    state: 'police', health: 100, stolen: false, driver: 'police', lightsOn: true };
  w.vehicles.push(car); w.police.cars.push(id);
  ev(emit, 'police-spawned', { wanted: w.police.wanted });
  return car;
}
export function spawnOfficer(w, x, z, emit) { ensure(w);
  const r = rt(w);
  if (typeof x !== 'number' || typeof z !== 'number') { const a = r.rng.range(0, Math.PI * 2), d = r.rng.range(SP_MIN, SP_MAX - 15);
    x = w.player.pos.x + Math.sin(a) * d; z = w.player.pos.z + Math.cos(a) * d;
    if (w.city) { const s = clampToCity(w.city, x, z); x = s.x; z = s.z; }
  }
  const id = 'officer-' + w.tick + '-' + (++r.cop);
  const o = { id, pos: { x, y: 0, z }, heading: r.rng.range(0, Math.PI * 2), speed: 0, state: 'patrol', health: 100, patrolTimer: 0 };
  w.police.officers.push(o);
  return o;
}
function matchForce(w, wanted, emit) { const want = FORCE[wanted] || FORCE[0];
  let cs = cars(w);
  while (cs.length > want.c) { const f = farthest(cs, w); w.vehicles.splice(w.vehicles.indexOf(f), 1); cs = cars(w); }
  const live = new Set(cs.map(v => v.id));
  w.police.cars = w.police.cars.filter(id => live.has(id));
  while (w.police.officers.length > want.o) w.police.officers.splice(w.police.officers.indexOf(farthest(w.police.officers, w)), 1);
  if (cars(w).length < want.c) spawnPoliceCar(w, emit);
  if (w.police.officers.length < want.o) spawnOfficer(w, undefined, undefined, emit);
}
function driveCars(w, dt) { const pl = w.player, pv = !pl.onFoot && pl.vehicleId ? byId(w, pl.vehicleId) : null;
  for (const car of cars(w)) { let tx = pl.pos.x, tz = pl.pos.z;
    if (pv) { tx += Math.sin(pl.heading) * pl.speed * 0.4; tz += -Math.cos(pl.heading) * pl.speed * 0.4; }
    if (w.city) { const pr = nearestRoadPoint(w.city, tx, tz), cr = nearestRoadPoint(w.city, car.pos.x, car.pos.z);
      const dxn = Math.abs(car.pos.x - gridLine(car.pos.x)), dzn = Math.abs(car.pos.z - gridLine(car.pos.z));
      if (!isRoad(w.city, car.pos.x, car.pos.z)) { tx = cr.x; tz = cr.z; }
      else if (Math.abs(cr.x - pr.x) < 6) { tx = pr.x; tz = pl.pos.z; }
      else if (Math.abs(cr.z - pr.z) < 6) { tx = pl.pos.x; tz = pr.z; }
      else if (dxn <= dzn) { tx = gridLine(car.pos.x); tz = pr.z; }
      else { tx = pr.x; tz = gridLine(car.pos.z); }
    }
    const dx = tx - car.pos.x, dz = tz - car.pos.z, d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    const turn = wrap(hdg(dx, dz) - car.heading), step = TURN * dt;
    car.heading += Math.max(-step, Math.min(step, turn));
    car.steer = Math.max(-0.55, Math.min(0.55, turn));
    let target = GAME_CONFIG.policeTopSpeed;
    if (d < 8) target = 12;
    if (Math.abs(turn) > 1.0) target = Math.min(target, 6);
    else if (Math.abs(turn) > 0.5) target = Math.min(target, 14);
    if (pl.onFoot && d < 3) target = 0;
    car.speed = car.speed < target ? Math.min(target, car.speed + ACC * dt) : Math.max(target, car.speed - BRK * dt);
    if (pv && d < RAM_D) { pv.speed *= (1 - RAM_SLOW * dt);
      pv.health = Math.max(0, pv.health - RAM_DMG * dt);
      if (pv.health <= 0) pv.state = 'wrecked';
      car.speed = Math.max(car.speed, pv.speed || 0);
    }
    let mh = car.heading, sp = car.speed;
    const nxt = (h) => ({ x: car.pos.x + Math.sin(h) * sp * dt, z: car.pos.z + -Math.cos(h) * sp * dt });
    const blocked = (p) => w.city && collidesBuilding(w.city, p.x, p.z, 1.2);
    if (blocked(nxt(mh))) { let found = null;
      for (const off of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) { const h = hdg(dx, dz) + off;
        if (!blocked(nxt(h))) { found = h; break; }
      }
      if (found !== null) { car.heading = found; mh = found; sp = Math.min(sp, 14); }
      else sp *= 0.5;
    }
    const np = nxt(mh);
    car.pos.x = np.x; car.pos.z = np.z; car.speed = sp;
    if (w.city) { const s = clampToCity(w.city, np.x, np.z); car.pos.x = s.x; car.pos.z = s.z; }
  }
}
function bust(w, emit) { const wb = w.police.wanted, pl = w.player;
  const cash = pl.cash || 0, f = Math.min(100, Math.floor(cash * 0.1));
  if (f > 0) { pl.cash = cash - f; ev(emit, 'cash-changed', { cash: pl.cash, delta: -f }); }
  const ds = w.city && w.city.districts, d = ds && ds.find(r => r.name === 'Marina Quarter');
  pl.pos.x = d ? (d.x0 + d.x1) / 2 : 0; pl.pos.z = d ? (d.z0 + d.z1) / 2 : 0; pl.pos.y = 0;
  pl.heading = 0; pl.speed = 0;
  pl.onFoot = true; pl.vehicleId = null; w.police.bustTimer = 0;
  clearWanted(w, emit);
  ev(emit, 'busted', { wanted: wb, fine: f });
}
function moveOfficers(w, dt, emit) { const r = rt(w), pl = w.player;
  let near = false;
  for (const o of w.police.officers) { const dx = pl.pos.x - o.pos.x, dz = pl.pos.z - o.pos.z, d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    if (w.police.wanted > 0 && d < 60) { o.state = 'chase'; o.heading = hdg(dx, dz); o.speed = FOOT;
      if (pl.onFoot && d < ARREST_D) { near = true; o.state = 'arrest'; o.speed = 0; }
    } else { o.state = 'patrol'; o.speed = PATROL; o.patrolTimer -= dt;
      if (o.patrolTimer <= 0) { o.patrolTimer = r.rng.range(2, 5); o.heading += r.rng.range(-1.2, 1.2); }
    }
    if (o.speed > 0) { const blocked = (h) => w.city && collidesBuilding(w.city,
        o.pos.x + Math.sin(h) * o.speed * dt, o.pos.z + -Math.cos(h) * o.speed * dt, 0.5);
      let mh = null;
      for (const off of [0, 1.1, -1.1, 2.2, -2.2]) if (!blocked(o.heading + off)) { mh = o.heading + off; break; }
      if (mh === null) { o.heading += 1.1; continue; }
      o.heading = mh;
      o.pos.x += Math.sin(mh) * o.speed * dt; o.pos.z += -Math.cos(mh) * o.speed * dt;
      if (w.city) { const s = clampToCity(w.city, o.pos.x, o.pos.z); o.pos.x = s.x; o.pos.z = s.z; }
    }
  }
  if (near && pl.onFoot) { w.police.bustTimer += dt;
    if (w.police.bustTimer >= ARREST_T) bust(w, emit);
  } else w.police.bustTimer = Math.max(0, w.police.bustTimer - dt);
}
function wreckCheck(w) { const pl = w.player;
  if (pl.onFoot || !pl.vehicleId || w.police.wanted < 3) return;
  const car = byId(w, pl.vehicleId);
  if (!car || car.health > 0) return;
  car.state = 'wrecked';
  pl.onFoot = true; pl.vehicleId = null; pl.speed = 0;
  pl.pos.x = car.pos.x + 2; pl.pos.z = car.pos.z;
}
export function updatePolice(w, dt, emit) { if (!w || !w.police || !w.player) return;
  if (w.screen && w.screen !== 'play') return;
  ensure(w);
  sync(w, emit);
  const wb = w.police.wanted;
  matchForce(w, wb, emit);
  if (wb > 0) { if (anySees(w)) w.police.escapeTimer = 0;
    else { w.police.escapeTimer += dt;
      w.police.heat = Math.max(0, w.police.heat - DECAY * dt);
      if (w.police.escapeTimer >= (ESC[wb] || 12)) { w.police.escapeTimer = 0;
        w.police.heat = Math.max(0, w.police.heat - BAND);
      }
    }
  } else if (w.police.heat > 0) w.police.heat = Math.max(0, w.police.heat - CALM * dt);
  sync(w, emit);
  if (wb > 0 && w.police.wanted === 0) { if (w.stats) w.stats.copsEvaded = (w.stats.copsEvaded || 0) + 1;
    ev(emit, 'escaped', {});
  }
  driveCars(w, dt);
  moveOfficers(w, dt, emit);
  wreckCheck(w);
}
