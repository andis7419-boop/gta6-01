// hud.js — HUD, minimap, messages (W4).
// Reads world + events ONLY. Never mutates world. All presentation state
// (toast timer, vignette fade, briefing timer) lives in the closure below.
// Owns the DOM ids in DESIGN §1.4 plus the extra elements it creates here
// (armour bar, clock/district, vehicle label, crosshair, briefing card,
// damage vignette, controls hint).

import { getDistrictAt } from './city.js';
import { getNextMissionOffer, getActiveMission } from './missions.js';

const MAP_SIZE = 180;
const MAP_VIEW = 240; // metres across the minimap view
const CITY_HALF = 288;
const TOAST_DEFAULT = 3;
const BRIEFING_DEFAULT = 6;

function el(doc, id, parent, tag, cls) {
  let node = doc.getElementById(id);
  if (node) return node;
  node = doc.createElement(tag || 'div');
  node.id = id;
  if (cls) node.className = cls;
  (parent || doc.body).appendChild(node);
  return node;
}

function formatCash(n) {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.floor(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return sign + '$' + out;
}

function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  const hh = h < 10 ? '0' + h : String(h);
  const mm = m < 10 ? '0' + m : String(m);
  return hh + ':' + mm;
}

function formatTimer(seconds) {
  if (typeof seconds !== 'number' || seconds <= 0) return '';
  const total = Math.ceil(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' + s : String(s));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createHud(document) {
  const root = el(document, 'hud', document.body, 'div', 'hud');
  const hud = {
    doc: document,
    root,
    health: el(document, 'hud-health', root, 'div', 'hud-bar hud-health'),
    armour: el(document, 'hud-armour', root, 'div', 'hud-bar hud-armour'),
    cash: el(document, 'hud-cash', root, 'div', 'hud-cash'),
    wanted: el(document, 'hud-wanted', root, 'div', 'hud-wanted'),
    clock: el(document, 'hud-clock', root, 'div', 'hud-clock'),
    district: el(document, 'hud-district', root, 'div', 'hud-district'),
    objective: el(document, 'hud-objective', root, 'div', 'hud-objective'),
    message: el(document, 'hud-message', root, 'div', 'hud-message'),
    speed: el(document, 'hud-speed', root, 'div', 'hud-speed'),
    vehicle: el(document, 'hud-vehicle', root, 'div', 'hud-vehicle'),
    minimap: el(document, 'minimap', root, 'canvas', 'hud-minimap'),
    crosshair: el(document, 'hud-crosshair', root, 'div', 'hud-crosshair'),
    briefing: el(document, 'hud-briefing', root, 'div', 'hud-briefing'),
    vignette: el(document, 'hud-vignette', root, 'div', 'hud-vignette'),
    hint: el(document, 'hud-hint', root, 'div', 'hud-hint'),
    toastLeft: 0,
    briefingLeft: 0,
    vignetteAlpha: 0,
    saveWarned: false,
  };
  hud.minimap.width = MAP_SIZE;
  hud.minimap.height = MAP_SIZE;
  hud.crosshair.textContent = '+';
  hud.hint.textContent =
    'WASD move · E enter car · F punch · Right mouse aim · Esc pause';
  hud.vignette.style.opacity = '0';
  hudSingleton = hud;
  return hud;
}

// The HUD object main.js keeps is the one createHud returned. main.js
// calls updateHud(world, dt) without passing the handle, so createHud also
// keeps a module-level reference: updateHud (and the show*/flash helpers)
// use world._hud when main stored it there, else this singleton.
let hudSingleton = null;

function activeHud(world) {
  if (world && world._hud) return world._hud;
  return hudSingleton;
}
export function showMessage(world, text, seconds) {
  const hud = activeHud(world);
  if (hud) showMessageOn(hud, text, seconds);
}

export function showMessageOn(hud, text, seconds) {
  if (!hud || !hud.message) return;
  hud.message.textContent = text;
  hud.message.style.display = 'block';
  hud.toastLeft = typeof seconds === 'number' ? seconds : TOAST_DEFAULT;
}

export function showBriefing(world, title, text) {
  const hud = activeHud(world);
  if (hud) showBriefingOn(hud, title, text);
}

export function showBriefingOn(hud, title, text) {
  if (!hud || !hud.briefing) return;
  hud.briefing.textContent = '';
  const head = hud.doc.createElement('div');
  head.className = 'hud-briefing-title';
  head.textContent = title;
  const body = hud.doc.createElement('div');
  body.className = 'hud-briefing-text';
  body.textContent = text;
  hud.briefing.appendChild(head);
  hud.briefing.appendChild(body);
  hud.briefing.style.display = 'block';
  hud.briefingLeft = BRIEFING_DEFAULT;
}

export function showHelp(world) {
  const hud = activeHud(world);
  const panel = hud ? hud.doc.getElementById('help-panel') : null;
  if (panel) panel.style.display = 'block';
}

export function hideHelp(world) {
  const hud = activeHud(world);
  const panel = hud ? hud.doc.getElementById('help-panel') : null;
  if (panel) panel.style.display = 'none';
}

export function flashDamage(world) {
  const hud = activeHud(world);
  if (hud) {
    hud.vignetteAlpha = 0.55;
    hud.vignette.style.opacity = '0.55';
  }
}

export function setCrosshairVisible(visible) {
  // Called with the hud object by main.js via hud.crosshair directly;
  // kept as a named export per DESIGN §3.11.
  if (typeof document !== 'undefined') {
    const node = document.getElementById('hud-crosshair');
    if (node) node.style.display = visible ? 'block' : 'none';
  }
}

function setBar(node, pct, colour) {
  if (!node) return;
  node.style.display = pct > 0 ? 'block' : 'none';
  node.style.width = clamp(pct, 0, 100) + '%';
  node.style.background = colour;
}

function currentVehicle(world) {
  if (!world.player.vehicleId) return null;
  for (const v of world.vehicles) {
    if (v.id === world.player.vehicleId) return v;
  }
  return null;
}

function objectiveLine(world) {
  const m = world.mission;
  // A staged objective line (shots.js chase scene sets one with no active
  // mission) wins over the phone offer below.
  const obj = m.objectives && m.objectives[m.stage];
  if (obj) {
    const def = getActiveMission(world);
    const title = def ? def.title : (m.activeId || 'Solmar Bay');
    const timer = formatTimer(m.timer);
    return title + ': ' + obj.label + (timer ? ' — ' + timer + ' left' : '');
  }
  if (!m.activeId) {
    const offer = getNextMissionOffer(world);
    if (offer) {
      return 'New job from Rosa — find the green phone on the map, press E';
    }
    if (Array.isArray(m.doneIds) && m.doneIds.length >= 7) {
      return 'Debt cleared — Solmar Bay is yours. Free roam.';
    }
    return '';
  }
  return '';
}

export function updateHud(world, dt) {
  const hud = activeHud(world);
  if (!hud) return;
  const playing = world.screen === 'play' || world.screen === 'pause';
  hud.root.style.display = playing ? 'block' : 'none';
  if (!playing) return;

  // Top-left: health, armour, cash.
  const health = clamp(world.player.health, 0, 100);
  const healthColour = health > 50 ? '#3fae5a' : health > 25 ? '#e0a030' : '#d23c2e';
  setBar(hud.health, health, healthColour);
  setBar(hud.armour, clamp(world.player.armour, 0, 100), '#3a7bd5');
  hud.cash.textContent = formatCash(world.player.cash);

  // Top-right: wanted stars (hidden at 0), clock, district.
  const wanted = world.police ? world.police.wanted : 0;
  if (wanted > 0) {
    hud.wanted.style.display = 'block';
    hud.wanted.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
  } else {
    hud.wanted.style.display = 'none';
  }
  hud.clock.textContent = formatClock(world.timeOfDay);
  try {
    hud.district.textContent = getDistrictAt(world.city,
      world.player.pos.x, world.player.pos.z);
  } catch (err) {
    hud.district.textContent = 'Solmar Bay';
  }

  // Bottom-left: speed + vehicle name, driving only.
  const car = currentVehicle(world);
  if (car && !world.player.onFoot) {
    hud.speed.style.display = 'block';
    hud.speed.textContent = Math.round(Math.abs(car.speed) * 3.6) + ' km/h';
    hud.vehicle.style.display = 'block';
    hud.vehicle.textContent = car.make + ' ' + car.model
      + (car.stolen ? ' — stolen' : '');
  } else {
    hud.speed.style.display = 'none';
    hud.vehicle.style.display = 'none';
  }

  // Bottom-centre: objective line + toast.
  hud.objective.textContent = objectiveLine(world);
  if (hud.toastLeft > 0) {
    hud.toastLeft -= dt;
    if (hud.toastLeft <= 0) hud.message.style.display = 'none';
  }
  if (hud.briefingLeft > 0) {
    hud.briefingLeft -= dt;
    if (hud.briefingLeft <= 0) hud.briefing.style.display = 'none';
  }

  // Centre crosshair: aiming (or pistol out) on foot only.
  const aiming = world.player.isAiming
    && world.player.onFoot && world.player.weapon === 'pistol';
  hud.crosshair.style.display = aiming ? 'block' : 'none';

  // Damage vignette fades out over ~300 ms.
  if (hud.vignetteAlpha > 0) {
    hud.vignetteAlpha = Math.max(0, hud.vignetteAlpha - dt * 1.8);
    hud.vignette.style.opacity = String(hud.vignetteAlpha);
  }

  // Controls hint for the first 60 sim seconds.
  hud.hint.style.display = world.clock < 60 ? 'block' : 'none';

  drawMinimap(world, hud);
}

// North-up minimap, 240 m view centred on the player, clamped to the city.
export function drawMinimap(world, hudArg) {
  const hud = hudArg || activeHud(world);
  if (!hud || !hud.minimap) return;
  const canvas = hud.minimap;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = MAP_SIZE / MAP_VIEW;
  const px = world.player.pos.x;
  const pz = world.player.pos.z;
  const half = MAP_VIEW / 2;
  // Clamp the view window so it never shows past the city edge.
  const viewX = clamp(px, -CITY_HALF + half, CITY_HALF - half);
  const viewZ = clamp(pz, -CITY_HALF + half, CITY_HALF - half);
  const toMapX = (x) => (x - (viewX - half)) * scale;
  const toMapZ = (z) => (z - (viewZ - half)) * scale;

  ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  // Sea strip on the west edge.
  const seaX = toMapX(-CITY_HALF);
  if (seaX > 0) {
    ctx.fillStyle = '#1d4e6b';
    ctx.fillRect(0, 0, Math.min(seaX, MAP_SIZE), MAP_SIZE);
  }

  // Street grid from city data: roads as light lines on dark blocks.
  const pitch = (world.city.blockSize || 60) + (world.city.roadWidth || 12);
  const roadW = (world.city.roadWidth || 12) * scale;
  ctx.fillStyle = '#2a2f3a';
  for (let i = 0; i <= (world.city.blocksX || 8); i++) {
    const gx = -CITY_HALF + i * pitch;
    const gz = -CITY_HALF + i * pitch;
    ctx.fillRect(toMapX(gx - 6), 0, roadW, MAP_SIZE);
    ctx.fillRect(0, toMapZ(gz - 6), MAP_SIZE, roadW);
  }

  const dot = (x, z, r, colour) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(toMapX(x), toMapZ(z), r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Traffic: small grey dots.
  for (const v of world.vehicles) {
    if (v.state === 'traffic') dot(v.pos.x, v.pos.z, 2, '#9aa0aa');
  }

  // Police: flashing blue dots.
  const blink = Math.floor(world.tick / 15) % 2 === 0;
  if (world.police && Array.isArray(world.police.cars)) {
    for (const id of world.police.cars) {
      for (const v of world.vehicles) {
        if (v.id === id) dot(v.pos.x, v.pos.z, 3, blink ? '#3a9bff' : '#ff3a3a');
      }
    }
  }

  // Safehouse: small house icon at the Marina.
  const shX = toMapX(-222);
  const shZ = toMapZ(96);
  ctx.fillStyle = '#7ee2a0';
  ctx.fillRect(shX - 3, shZ - 1, 6, 5);
  ctx.beginPath();
  ctx.moveTo(shX - 4, shZ - 1);
  ctx.lineTo(shX, shZ - 5);
  ctx.lineTo(shX + 4, shZ - 1);
  ctx.closePath();
  ctx.fill();

  // Phone offer: green icon when a job is waiting.
  const offer = getNextMissionOffer(world);
  if (offer) {
    ctx.fillStyle = '#37d67a';
    ctx.fillRect(toMapX(offer.x) - 2, toMapZ(offer.z) - 4, 4, 7);
    ctx.fillRect(toMapX(offer.x) - 2, toMapZ(offer.z) + 3, 4, 1);
  }

  // Objective: yellow pulsing diamond.
  const m = world.mission;
  if (m.activeId && m.objectives && m.objectives[m.stage]) {
    const obj = m.objectives[m.stage];
    const t = obj.target || { x: 0, z: 0 };
    const cx = toMapX(t.x);
    const cy = toMapZ(t.z);
    const r = 5 + Math.sin(world.tick / 8) * 1.5;
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Player: white arrow rotated to heading.
  const cx = toMapX(px);
  const cy = toMapZ(pz);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(world.player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Events drained by main.js after each fixed step.
export function handleEvents(world, events) {
  const hud = activeHud(world);
  if (!hud) return;
  for (const event of events) {
    const p = event.payload || {};
    switch (event.type) {
      case 'mission-started':
        showBriefingOn(hud, p.label || 'New job',
          world.mission.briefing || '');
        showMessageOn(hud, 'Job started: ' + (p.label || ''), 3);
        break;
      case 'objective-done':
        showMessageOn(hud, 'Objective complete', 3);
        break;
      case 'mission-done':
        showMessageOn(hud, 'Job complete — ' + formatCash(p.reward || 0), 4);
        showBriefingOn(hud, 'Job complete',
          (p.label || 'Job') + ' paid ' + formatCash(p.reward || 0) + '.');
        break;
      case 'mission-failed':
        showMessageOn(hud, 'Job failed — talk to Rosa to try again', 4);
        break;
      case 'cash-changed':
        hud.cash.textContent = formatCash(p.cash || 0);
        break;
      case 'damage':
        hud.vignetteAlpha = 0.55;
        hud.vignette.style.opacity = '0.55';
        break;
      case 'car-stolen':
        showMessageOn(hud, 'Car stolen — the law is coming', 3);
        break;
      case 'busted':
        showMessageOn(hud, 'Busted — the Tide Crew will want its money back', 4);
        break;
      case 'escaped':
        showMessageOn(hud, 'You lost them', 3);
        break;
      case 'pickup':
        showMessageOn(hud, 'Picked up ' + (p.kind || 'something'), 3);
        break;
      case 'screen-changed':
        hud.root.style.display = p.screen === 'play' ? 'block' : 'none';
        break;
      default:
        break;
    }
  }
}
