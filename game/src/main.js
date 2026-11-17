import { GAME_CONFIG, KEY_BINDINGS } from './config.js';
import { createRng } from './random.js';
import { buildCity } from './city.js';
import * as render from './render.js';
import { createInput, updateInput, isDown, wasPressed, getLookDelta, consumeAction } from './input.js';
import { updateVehicles } from './vehicles.js';
import { updateTraffic } from './traffic.js';
import { updatePedestrians } from './pedestrians.js';
import { updateMission, startMission, retryMission, failMission, getNextMissionMarker } from './missions.js';
import { updatePolice } from './police.js';
import { updateCombat, punch, shoot } from './combat.js';
import { createHud, updateHud, showMessage, showBriefing, flashDamage, hideBriefing } from './hud.js';
import { initAudio, playSfx, setMuted, isMuted, updateAudio, audioEvent } from './audio.js';
import { saveGame, loadGame, applySaveToWorld, hasSave, autosaveIfDue, clearSave } from './save.js';
import { stageShot, updateAutopilot, countShotFrame, markShotReady, isShotMode, getShotInput } from './shots.js';
function createEvents() { const queue = [];
  let tick = 0;
  return { emit(type, payload) { queue.push({ type, payload: payload || {}, tick });
    }, drain() { const out = queue.slice();
      queue.length = 0;
      return out;
    }, setTick(n) { tick = n;
    }, };
}
export function createWorld(seed) { const cityRng = createRng(seed);
  const city = buildCity(cityRng);
  const spawn = { x: -252, y: 0, z: -120 };
  return { seed, tick: 0, clock: 0, timeOfDay: GAME_CONFIG.timeOfDayStart, screen: 'title', paused: true, muted: false,
    city, player: { pos: { ...spawn }, heading: Math.PI / 2, speed: 0, onFoot: true, vehicleId: null, health: 100,
      cash: 0, armour: 0, weapon: 'fists', ammo: 0, wantedHeat: 0, isRunning: false, isAiming: false, },
    vehicles: [], pedestrians: [], police: { wanted: 0, heat: 0, officers: [], cars: [], escapeTimer: 0,
      bustTimer: 0, }, mission: { activeId: null, doneIds: [], stage: 0, objectives: [], briefing: '',
      timer: null, reward: 0, }, stats: { carsStolen: 0, missionsDone: 0, distanceDriven: 0, distanceWalked: 0,
      pedsScared: 0, copsEvaded: 0, shotsFired: 0, bestCash: 0, }, flags: { metRosa: false, harbourOpen: false, ownsPistol: false }, };
}
function activeInput() { const shot = getShotInput();
  if (shot) return shot;
  return currentGame ? currentGame.input : null;
}
function missionSlot(world, dt) { const game = currentGame;
  const emit = game ? game.events.emit : null;
  const inp = activeInput();
  if (world.screen === 'play' && !world.mission.activeId && inp && wasPressed(inp, 'enterCar')) { const marker = getNextMissionMarker(world);
    if (marker && marker.kind === 'phone' && marker.missionId) { const dx = world.player.pos.x - marker.x;
      const dz = world.player.pos.z - marker.z;
      if (dx * dx + dz * dz < 36) { if (startMission(world, marker.missionId, emit)) {
          if (marker.missionId === 'm4' && world.player.weapon !== 'pistol') { world.player.weapon = 'pistol';
            world.player.ammo = (world.player.ammo || 0) + 48;
            world.flags.ownsPistol = true;
          }
          consumeAction(inp, 'enterCar');
        }
      }
    }
  }
  updateMission(world, dt, emit);
}
function combatSlot(world, dt) { const game = currentGame;
  const emit = game ? game.events.emit : null;
  const inp = activeInput();
  const p = world.player;
  if (world.screen === 'play' && p && p.onFoot && inp) { p.isAiming = isDown(inp, 'aim');
    if (wasPressed(inp, 'punch')) punch(world, emit);
    else if (isDown(inp, 'shoot')) { if (p.isAiming || p.weapon === 'pistol') shoot(world, null, emit);
      else if (wasPressed(inp, 'shoot')) punch(world, emit);
    }
  } else if (p) p.isAiming = false;
  updateCombat(world, dt, emit);
}
function inputSlot(world, dt) { const inp = activeInput();
  if (!inp) return;
  updateInput(inp);
  const look = getLookDelta(inp);
  currentCamera.yaw -= look.dx * GAME_CONFIG.mouseSensitivity;
  currentCamera.pitch = Math.max(GAME_CONFIG.pitchMin, Math.min(GAME_CONFIG.pitchMax, currentCamera.pitch + look.dy * GAME_CONFIG.mouseSensitivity));
  if (wasPressed(inp, 'pause') || wasPressed(inp, 'pauseAlt')) { if (world.screen === 'play') setScreen(world, 'pause');
    else if (world.screen === 'pause') setScreen(world, 'play');
  }
  if (wasPressed(inp, 'mute')) toggleMute(world);
  if (wasPressed(inp, 'help')) { const panel = typeof document !== 'undefined' ? document.getElementById('help-panel') : null;
    toggleHelp(panel ? panel.classList.contains('hidden') : true);
  }
  if (wasPressed(inp, 'horn') && !world.player.onFoot) playSfx('horn');
  if (wasPressed(inp, 'confirm') && currentGame) hideBriefing(currentGame.hud);
}
function routeEvent(world, e) { const game = currentGame;
  if (!game) return;
  const hud = game.hud;
  audioEvent(e.type, e.payload, world);
  if (!hud) return;
  if (e.type === 'car-stolen') { showMessage(hud, world, 'Stolen: ' + (e.payload.make || '') + ' ' + (e.payload.model || ''), 3);
  } else if (e.type === 'crime') { const texts = { theft: 'Car stolen!', 'hit-ped': 'You hit a pedestrian!',
      shooting: 'Shots heard!', 'cop-kill': 'Cop down!', speeding: 'Speeding!', };
    showMessage(hud, world, texts[e.payload.kind] || 'Crime committed', 3);
  } else if (e.type === 'wanted-changed') { if (e.payload.wanted > 0) {
      showMessage(hud, world, 'Wanted: ' + e.payload.wanted + ' star' + (e.payload.wanted > 1 ? 's' : ''), 3);
    }
  } else if (e.type === 'mission-started') { showBriefing(hud, world, e.payload.label || 'New job', world.mission.briefing || '');
  } else if (e.type === 'objective-done') { showMessage(hud, world, 'Done: ' + (e.payload.label || ''), 3);
  } else if (e.type === 'mission-done') { showMessage(hud, world, 'Job done — $' + (e.payload.reward || 0), 4);
  } else if (e.type === 'mission-failed') { showMessage(hud, world, 'Job failed: ' + (e.payload.label || ''), 4);
  } else if (e.type === 'escaped') { showMessage(hud, world, 'You lost them.', 3);
  } else if (e.type === 'damage') { flashDamage(hud, world);
  } else if (e.type === 'shot-fired') { render.flashEffect('muzzle');
  }
}
let currentCamera = { mode: 'title', yaw: 0, pitch: 0.1 };
export function createGame(canvas, opts = {}) { const seed = opts.seed || 1;
  const world = createWorld(seed);
  const events = createEvents();
  const input = createInput(canvas, KEY_BINDINGS, { onLockLost() { if (world.screen === 'play') setScreen(world, 'pause');
    }, });
  const hud = createHud(typeof document !== 'undefined' ? document : null);
  initAudio();
  const renderer = render.createRenderer(canvas);
  let rafId = 0;
  let lastFrameMs = 0;
  let accumulator = 0;
  let firstFrameDone = false;
  let watchdogFired = false;
  const bootMs = typeof performance !== 'undefined' ? performance.now() : 0;
  function step() { tick(world, GAME_CONFIG.step);
    world.tick++;
    world.clock += GAME_CONFIG.step;
  }
  function frame(nowMs) { rafId = requestAnimationFrame(frame);
    const realDt = Math.min( (nowMs - lastFrameMs) / 1000 || 0, GAME_CONFIG.maxFrameDt, );
    lastFrameMs = nowMs;
    if (!world.paused) { accumulator += realDt;
      let steps = 0;
      while (accumulator >= GAME_CONFIG.step && steps < GAME_CONFIG.maxStepsPerFrame) { step();
        accumulator -= GAME_CONFIG.step;
        steps++;
      }
      if (steps === GAME_CONFIG.maxStepsPerFrame) accumulator = 0;
    } else if (currentGame) { inputSlot(world, GAME_CONFIG.step);
    }
    renderFrame(world);
    if (typeof window !== 'undefined' && isShotMode() && countShotFrame()) markShotReady();
    if (!firstFrameDone) { firstFrameDone = true;
      if (typeof performance !== 'undefined' && performance.now() - bootMs > GAME_CONFIG.renderWatchdogSeconds * 1000) { watchdogFired = true;
        render.enableFallback();
      }
    }
  }
  const game = { world, events, input, hud, renderer, camera: currentCamera, start() { lastFrameMs = typeof performance !== 'undefined' ? performance.now() : 0;
      rafId = requestAnimationFrame(frame);
      if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', onVisibilityHidden);
      }
    }, stop() { cancelAnimationFrame(rafId);
      if (typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVisibilityHidden);
      }
    }, step, tick: (dt) => tick(world, dt), setScreen: (screen) => setScreen(world, screen), };
  currentGame = game;
  return game;
}
export function tick(world, dt) { world.timeOfDay = (GAME_CONFIG.timeOfDayStart + world.clock * GAME_CONFIG.timeOfDayRate) % 24;
  if (currentGame && isShotMode()) updateAutopilot(world, dt);
  if (currentGame) { const emit = currentGame.events.emit;
    inputSlot(world, dt);
    missionSlot(world, dt);
    updateVehicles(world, dt, activeInput(), emit);
    updateTraffic(world, dt, emit);
    updatePedestrians(world, dt, emit);
    updatePolice(world, dt, emit);
    combatSlot(world, dt);
    updateAudio(world, dt);
    updateHud(currentGame.hud, world, dt);
    autosaveIfDue(world, dt);
  }
  if (currentGame) { const drained = currentGame.events.drain();
    for (const e of drained) { if (e.type === 'busted' && world.screen === 'play') { setScreen(world, 'busted');
      } else if (e.type === 'player-down' && world.screen === 'play') { setScreen(world, 'wasted');
      }
      routeEvent(world, e);
    }
  }
  if (currentGame) currentGame.events.setTick(world.tick);
}
let currentGame = null;
export function renderFrame(world) { const view = { ...currentCamera };
  if (world.screen === 'title') view.mode = 'title';
  else if (world.player.onFoot) view.mode = 'foot';
  else view.mode = 'chase';
  render.renderWorld(world, view);
}
export function setScreen(world, screen) { world.screen = screen;
  world.paused = screen !== 'play';
  if (screen !== 'play' && typeof document !== 'undefined' && document.pointerLockElement) { try { document.exitPointerLock(); } catch (err) {  }
  }
  if (screen === 'title') { currentCamera.mode = 'title';
    render.setCameraMode('title');
  } else if (screen === 'play') { render.setCameraMode(world.player.onFoot ? 'foot' : 'chase');
  }
  if (currentGame) currentGame.events.emit('screen-changed', { screen });
  updateScreenDom(screen);
}
export function updateScreenDom(screen) { if (typeof document === 'undefined') return;
  const show = (id, visible) => { const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !visible);
  };
  show('title-screen', screen === 'title');
  show('pause-screen', screen === 'pause');
  show('gameover-screen', screen === 'busted' || screen === 'wasted');
  show('hud', screen === 'play');
  if (screen === 'title') { const cont = document.getElementById('btn-continue');
    if (cont) { try { cont.disabled = !hasSave(); } catch (err) { cont.disabled = true; }
    }
  }
  const title = document.getElementById('gameover-title');
  if (title) { title.textContent = screen === 'busted' ? 'BUSTED' : screen === 'wasted' ? 'WASTED' : '';
  }
  const sub = document.getElementById('gameover-sub');
  if (sub && (screen === 'busted' || screen === 'wasted')) { sub.textContent = screen === 'busted'
      ? 'The police took you in. You lost the fine.'
      : 'Mara is down. The clinic patches her up.';
  }
}
export function onVisibilityHidden() { if (typeof document === 'undefined') return;
  if (document.hidden && currentGame && currentGame.world.screen === 'play') { setScreen(currentGame.world, 'pause');
  }
}
function readParams() { const params = new URLSearchParams(window.location.search);
  const seedRaw = parseInt(params.get('seed') || '1', 10);
  return { seed: Number.isFinite(seedRaw) ? seedRaw : 1,
    shot: params.get('shot') || null, render: params.get('render') || null, scene: params.get('scene') || null, };
}
export function boot() { const canvas = document.getElementById('game-canvas');
  const params = readParams();
  const game = createGame(canvas, { seed: params.seed });
  currentGame = game;
  if (typeof window !== 'undefined') window.__game = game;
  window.__shotReady = false;
  window.__shot = params.shot || params.scene || null;
  window.__renderMode = render.getRenderMode();
  if (params.render === 'canvas2d') render.enableFallback();
  const bind = (id, fn) => { const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { playSfx('ui-click'); fn(); });
  };
  const newGame = () => { clearSave();
    resetForNewGame(game.world);
    setScreen(game.world, 'play');
  };
  const retry = () => retryFlow(game.world);
  const freeroam = () => freeroamFlow(game.world);
  [ ['btn-new', newGame], ['btn-continue', () => { if (applySaveToWorld(game.world, loadGame())) { setMuted(!!game.world.muted);
        syncMuteLabel(game.world);
        setScreen(game.world, 'play');
      }
    }], ['btn-help', () => toggleHelp(true)], ['btn-help-close', () => toggleHelp(false)], ['btn-mute', () => toggleMute(game.world)],
    ['btn-resume', () => setScreen(game.world, 'play')], ['btn-help-pause', () => toggleHelp(true)],
    ['btn-quit', () => { saveGame(game.world); setScreen(game.world, 'title'); }], ['btn-retry', retry],
    ['btn-freeroam', freeroam], ['btn-title', () => { saveGame(game.world); setScreen(game.world, 'title'); }], ].forEach(([id, fn]) => bind(id, fn));
  const seedLine = document.getElementById('seed-line');
  if (seedLine) seedLine.textContent = 'Seed ' + params.seed;
  const continueBtn = document.getElementById('btn-continue');
  if (continueBtn) { try { continueBtn.disabled = !hasSave();
    } catch (err) { continueBtn.disabled = true;
    }
  }
  try { const saved = loadGame();
    if (saved && saved.muted) { setMuted(true);
      game.world.muted = true;
      syncMuteLabel(game.world);
    }
  } catch (err) {  }
  if (params.shot === 'start') setScreen(game.world, 'title');
  else if (params.shot === 'play') setScreen(game.world, 'play');
  else if (params.shot === 'end') setScreen(game.world, 'busted');
  else setScreen(game.world, 'title');
  if (params.shot) { stageShot(game.world, { shot: params.shot, seed: params.seed, scene: params.scene, render: params.render, game, });
  }
  resizeToWindow();
  window.addEventListener('resize', resizeToWindow);
  game.start();
  return game;
}
function resizeToWindow() { render.resize(window.innerWidth, window.innerHeight);
}
function toggleHelp(showIt) { const panel = document.getElementById('help-panel');
  if (panel) panel.classList.toggle('hidden', !showIt);
}
function toggleMute(world) { const mutedNow = setMuted(!isMuted());
  world.muted = mutedNow;
  syncMuteLabel(world);
}
function syncMuteLabel(world) { if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-mute');
  if (btn) btn.textContent = world.muted ? 'Sound: Muted' : 'Sound: On';
}
function resetForNewGame(world) { const keepMuted = world.muted;
  const fresh = createWorld(world.seed);
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, fresh);
  world.muted = keepMuted;
  currentCamera.mode = 'foot';
  currentCamera.yaw = 0;
  currentCamera.pitch = 0.1;
}
function retryFlow(world) { const game = currentGame;
  const emit = game ? game.events.emit : null;
  respawn(world);
  if (world.mission.lastFailed) { retryMission(world, emit);
  } else if (world.mission.activeId) { const id = world.mission.activeId;
    const stage = world.mission.stage;
    world.mission.activeId = null;
    world.mission.objectives = [];
    startMission(world, id, emit, stage);
  }
  setScreen(world, 'play');
}
function freeroamFlow(world) { const game = currentGame;
  const emit = game ? game.events.emit : null;
  if (world.mission.activeId) failMission(world, 'Left the job', emit);
  world.mission.lastFailed = null;
  respawn(world);
  setScreen(world, 'play');
}
function respawn(world) { world.player.pos = { x: -252, y: 0, z: -120 };
  world.player.heading = Math.PI / 2;
  world.player.health = 100;
  world.player.onFoot = true;
  world.player.vehicleId = null;
  world.player.isAiming = false;
  world.player.wantedHeat = 0;
  world.police.heat = 0;
  world.police.wanted = 0;
  world.police.bustTimer = 0;
  world.police.escapeTimer = 0;
  world.mission.timer = null;
}
if (typeof document !== 'undefined') { boot();
}
