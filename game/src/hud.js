import { getSafehousePos } from './save.js';
const MINIMAP_SIZE = 180;
const MINIMAP_VIEW = 240;
const CITY_HALF = 288;
const HINT_SECONDS = 60;
function _fmtCash(cash) { const n = Math.max(0, Math.floor(cash || 0));
  return '$' + n.toLocaleString('en-US');
}
function _fmtClock(timeOfDay) { const t = ((timeOfDay || 0) % 24 + 24) % 24;
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
function _fmtTimer(seconds) { if (seconds === null || seconds === undefined) return '';
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function _districtAt(world, x, z) { const districts = world.city && world.city.districts;
  if (districts) { for (let i = 0; i < districts.length; i++) { const d = districts[i];
      if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d.name;
    }
  }
  return 'Solmar Bay';
}
function _vehicleOfPlayer(world) { if (!world.player || !world.player.vehicleId || !world.vehicles) return null;
  for (let i = 0; i < world.vehicles.length; i++) { if (world.vehicles[i].id === world.player.vehicleId) return world.vehicles[i];
  }
  return null;
}
function _currentObjective(world) { if (!world.mission || !world.mission.activeId) return null;
  const obj = world.mission.objectives && world.mission.objectives[world.mission.stage];
  return obj || null;
}
export function getHudState(world) { const p = world.player || {};
  const wanted = world.police ? (world.police.wanted || 0) : 0;
  const obj = _currentObjective(world);
  const veh = _vehicleOfPlayer(world);
  let timerText = '';
  if (world.mission && typeof world.mission.timer === 'number') { timerText = _fmtTimer(world.mission.timer);
  }
  return { health: Math.max(0, Math.min(100, p.health === undefined ? 100 : p.health)),
    armour: Math.max(0, Math.min(100, p.armour || 0)), cashText: _fmtCash(p.cash || 0), stars: wanted, clockText: _fmtClock(world.timeOfDay),
    district: _districtAt(world, p.pos ? p.pos.x : 0, p.pos ? p.pos.z : 0),
    speedKmh: (!p.onFoot && p.speed !== undefined) ? Math.round(Math.abs(p.speed) * 3.6) : 0, driving: !p.onFoot,
    vehicleText: veh ? (veh.make + ' ' + veh.model + (veh.stolen ? ' — stolen' : '')) : '', objectiveText: obj ? (obj.label || '') : '', timerText: timerText,
    missionTitle: world.mission && world.mission.activeId ? world.mission.activeId : '',
    hintVisible: (world.clock || 0) < HINT_SECONDS, crosshairVisible: !!p.isAiming, screen: world.screen || 'title', };
}
export function createHud(doc) { const hud = { doc: doc || null, el: {}, message: null, briefing: null, flashUntil: -1, minimapCanvas: null, };
  if (!doc) return hud;
  const byId = (id) => { try { return doc.getElementById(id); } catch (e) { return null; }
  };
  hud.el.health = byId('hud-health-fill') || byId('hud-health');
  hud.el.armour = byId('hud-armour-fill') || byId('hud-armour');
  hud.el.cash = byId('hud-cash');
  hud.el.wanted = byId('hud-wanted');
  hud.el.clock = byId('hud-clock');
  hud.el.district = byId('hud-district');
  hud.el.objective = byId('hud-objective');
  hud.el.message = byId('hud-message');
  hud.el.speed = byId('hud-speed');
  hud.el.vehicle = byId('hud-vehicle');
  hud.el.hint = byId('hud-hint');
  hud.el.hud = byId('hud');
  hud.el.title = byId('title-screen');
  hud.el.pause = byId('pause-screen');
  hud.el.gameover = byId('gameover-screen');
  hud.el.help = byId('help-panel');
  hud.el.crosshair = byId('crosshair');
  hud.el.damage = byId('damage-flash');
  hud.minimapCanvas = byId('minimap');
  const mk = (id, css) => { let el = byId(id);
    if (!el && hud.el.hud) { el = doc.createElement('div');
      el.id = id;
      el.style.cssText = css;
      hud.el.hud.appendChild(el);
    }
    return el;
  };
  hud.el.briefing = mk('hud-briefing', 'position:fixed;left:50%;top:14%;transform:translateX(-50%);max-width:520px;' +
    'background:rgba(10,14,24,0.88);color:#f5f0e6;padding:14px 18px;display:none;' + 'border-left:4px solid #f2c14e;');
  hud.el.legend = mk('hud-minimap-legend', 'position:fixed;left:12px;bottom:196px;color:#cfd6e4;font-size:11px;' +
    'line-height:1.5;text-shadow:0 1px 2px #000;pointer-events:none;');
  if (hud.el.legend) { hud.el.legend.textContent = '◆ Objective   ● Police   ● Traffic   ▲ You   ⌂ Safehouse   ☎ Rosa';
  }
  return hud;
}
function _setText(el, text) { if (el && el.textContent !== text) el.textContent = text;
}
function _setDisplay(el, show) { if (el) el.style.display = show ? '' : 'none';
}
function _show(el, visible) { if (!el) return;
  if (el.classList) el.classList.toggle('hidden', !visible);
  else el.style.display = visible ? '' : 'none';
}
export function drawMinimap(world, canvas) { if (!canvas) return false;
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch (e) { return false; }
  if (!ctx) return false;
  const S = MINIMAP_SIZE;
  const scale = S / MINIMAP_VIEW;
  const p = world.player || {};
  const px = p.pos ? p.pos.x : 0;
  const pz = p.pos ? p.pos.z : 0;
  const half = MINIMAP_VIEW / 2;
  let cx = px;
  let cz = pz;
  if (cx < -CITY_HALF + half) cx = -CITY_HALF + half;
  if (cx > CITY_HALF - half) cx = CITY_HALF - half;
  if (cz < -CITY_HALF + half) cz = -CITY_HALF + half;
  if (cz > CITY_HALF - half) cz = CITY_HALF - half;
  const toX = (wx) => (wx - (cx - half)) * scale;
  const toY = (wz) => (wz - (cz - half)) * scale;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#101725';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#16385c';
  const seaX = toX(-CITY_HALF);
  if (seaX > 0) ctx.fillRect(0, 0, Math.min(seaX, S), S);
  ctx.strokeStyle = '#2c3a52';
  ctx.lineWidth = 12 * scale;
  const pitch = 72;
  for (let k = 0; k <= 8; k++) { const c = -CITY_HALF + k * pitch;
    ctx.beginPath(); ctx.moveTo(toX(c), 0); ctx.lineTo(toX(c), S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, toY(c)); ctx.lineTo(S, toY(c)); ctx.stroke();
  }
  ctx.fillStyle = '#1a2436';
  for (let bx = 0; bx < 8; bx++) { for (let bz = 0; bz < 8; bz++) { const x0 = -CITY_HALF + bx * pitch + 12;
      const z0 = -CITY_HALF + bz * pitch + 12;
      ctx.fillRect(toX(x0), toY(z0), 60 * scale, 60 * scale);
    }
  }
  const inView = (wx, wz) => wx >= cx - half && wx <= cx + half && wz >= cz - half && wz <= cz + half;
  const safe = getSafehousePos(world);
  if (inView(safe.x, safe.z)) { ctx.fillStyle = '#f2c14e';
    const sx = toX(safe.x);
    const sy = toY(safe.z);
    ctx.fillRect(sx - 3, sy - 1, 6, 5);
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy - 1); ctx.lineTo(sx, sy - 5); ctx.lineTo(sx + 4, sy - 1);
    ctx.closePath(); ctx.fill();
  }
  const obj = _currentObjective(world);
  if (obj && obj.target && inView(obj.target.x, obj.target.z)) { const pulse = 5 + 2 * Math.sin((world.clock || 0) * 4);
    const ox = toX(obj.target.x);
    const oy = toY(obj.target.z);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(ox, oy - pulse); ctx.lineTo(ox + pulse, oy);
    ctx.lineTo(ox, oy + pulse); ctx.lineTo(ox - pulse, oy);
    ctx.closePath(); ctx.fill();
  }
  if (!obj && world.mission) { const done = world.mission.doneIds || [];
    if (done.length < 7 && inView(safe.x, safe.z)) { ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.arc(toX(safe.x), toY(safe.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const flashOn = Math.floor((world.clock || 0) * 2) % 2 === 0;
  if (world.vehicles) { for (let i = 0; i < world.vehicles.length; i++) { const v = world.vehicles[i];
      if (!v.pos || !inView(v.pos.x, v.pos.z)) continue;
      if (world.player && v.id === world.player.vehicleId) continue;
      if (v.state === 'police') { if (!flashOn) continue;
        ctx.fillStyle = '#3a86ff';
        ctx.beginPath();
        ctx.arc(toX(v.pos.x), toY(v.pos.z), 3, 0, Math.PI * 2);
        ctx.fill();
      } else { ctx.fillStyle = '#9aa5b1';
        ctx.fillRect(toX(v.pos.x) - 1, toY(v.pos.z) - 1, 3, 3);
      }
    }
  }
  const heading = p.heading || 0;
  ctx.save();
  ctx.translate(toX(px), toY(pz));
  ctx.rotate(heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  return true;
}
export function showMessage(hud, world, text, seconds) { if (!hud) return;
  hud.message = { text: text, until: (world.clock || 0) + (seconds || 3) };
  _setText(hud.el.message, text);
  _setDisplay(hud.el.message, true);
}
export function showBriefing(hud, world, title, text) { if (!hud) return;
  hud.briefing = { title: title, text: text, until: (world.clock || 0) + 8 };
  const card = hud.el.briefing;
  if (card && hud.doc) { while (card.firstChild) card.removeChild(card.firstChild);
    const rows = [ [title, 'font-weight:bold;font-size:17px;margin-bottom:4px;'], [text, 'font-size:13px;line-height:1.45;'],
      ['Press Enter to continue', 'font-size:11px;opacity:0.7;margin-top:6px;'], ];
    for (let i = 0; i < rows.length; i++) { const d = hud.doc.createElement('div');
      d.textContent = rows[i][0];
      d.style.cssText = rows[i][1];
      card.appendChild(d);
    }
    _setDisplay(card, true);
  }
}
export function hideBriefing(hud) { if (!hud) return;
  hud.briefing = null;
  _setDisplay(hud.el.briefing, false);
}
export function showHelp(hud) { if (hud) _show(hud.el.help, true);
}
export function hideHelp(hud) { if (hud) _show(hud.el.help, false);
}
export function flashDamage(hud, world) { if (!hud) return;
  hud.flashUntil = (world.clock || 0) + 0.3;
}
export function setCrosshairVisible(hud, visible) { if (hud) _show(hud.el.crosshair, !!visible);
}
export function applyScreen(hud, world) { if (!hud || !hud.doc) return;
  const screen = world.screen || 'title';
  _show(hud.el.hud, screen === 'play');
  _show(hud.el.title, screen === 'title');
  _show(hud.el.pause, screen === 'pause');
  _show(hud.el.gameover, screen === 'busted' || screen === 'wasted');
  if (screen !== 'play') hideBriefing(hud);
}
export function updateHud(hud, world, dt) { if (!hud) return;
  const st = getHudState(world);
  if (hud.el.health) { const pct = st.health;
    hud.el.health.style.width = pct + '%';
    hud.el.health.style.background = pct > 50 ? '#3fae5a'
      : (pct > 25 ? '#e0a030' : '#c0392b');
  }
  if (hud.el.armour) { hud.el.armour.style.width = st.armour + '%';
    _setDisplay(hud.el.armour, st.armour > 0);
  }
  _setText(hud.el.cash, st.cashText);
  _setText(hud.el.clock, st.clockText);
  _setText(hud.el.district, st.district);
  if (hud.el.wanted) { _setDisplay(hud.el.wanted, st.stars > 0);
    if (st.stars > 0) { let stars = '';
      for (let i = 0; i < 5; i++) stars += i < st.stars ? '★' : '☆';
      _setText(hud.el.wanted, stars);
    }
  }
  if (hud.el.objective) { let line = '';
    if (st.objectiveText) { line = (st.missionTitle ? st.missionTitle.toUpperCase() + ': ' : '') + st.objectiveText;
      if (st.timerText) line += ' — ' + st.timerText + ' left';
    } else { line = 'Free roam — find the green ☎ blip for Rosa\'s next job';
    }
    _setText(hud.el.objective, line);
  }
  if (st.driving) { _setText(hud.el.speed, st.speedKmh + ' km/h');
    _setDisplay(hud.el.speed, true);
    _setText(hud.el.vehicle, st.vehicleText);
    _setDisplay(hud.el.vehicle, st.vehicleText !== '');
  } else { _setDisplay(hud.el.speed, false);
    _setDisplay(hud.el.vehicle, false);
  }
  if (hud.message && (world.clock || 0) >= hud.message.until) { hud.message = null;
    _setDisplay(hud.el.message, false);
  }
  if (hud.briefing && (world.clock || 0) >= hud.briefing.until) hideBriefing(hud);
  if (hud.el.damage) { const remain = hud.flashUntil - (world.clock || 0);
    hud.el.damage.style.opacity = remain > 0 ? String(remain / 0.3) : '0';
  }
  setCrosshairVisible(hud, st.crosshairVisible);
  if (hud.el.hint) { _setText(hud.el.hint, 'WASD move · E enter car · F punch · Right mouse aim · Esc pause');
    _setDisplay(hud.el.hint, st.hintVisible && world.screen === 'play');
  }
  drawMinimap(world, hud.minimapCanvas);
}
export const update = updateHud;
