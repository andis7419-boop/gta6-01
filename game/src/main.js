// main.js — boot, fixed-step loop, screen state machine, event bus.
// Owns the world object and wires the modules together. No game rules here:
// rules live in the modules called from tick(), in the frozen §2.3 order.
import { GAME_CONFIG, KEY_BINDINGS } from './config.js';
import { createRng } from './random.js';
import { buildCity } from './city.js';
import * as render from './render.js';
import * as inputMod from './input.js';
import * as vehicles from './vehicles.js';
import * as traffic from './traffic.js';
import * as pedestrians from './pedestrians.js';
import * as police from './police.js';
import * as combat from './combat.js';
import * as missions from './missions.js';
import * as hud from './hud.js';
import * as audio from './audio.js';
import * as save from './save.js';
import * as shots from './shots.js';

const STEP = GAME_CONFIG.step;

function makeEventBus() {
  const queue = [];
  return {
    emit(type, payload) {
      queue.push({ type, payload: payload || {}, tick: 0 });
    },
    drain() {
      const out = queue.splice(0, queue.length);
      return out;
    },
  };
}

function buildWorld(seed) {
  const cityRng = createRng(seed);
  const world = {
    seed,
    tick: 0,
    clock: 0,
    timeOfDay: GAME_CONFIG.dayStartHour,
    screen: 'title',
    paused: false,
    city: null,
    player: {
      pos: { x: -222, y: 0, z: 96 },
      heading: 0,
      speed: 0,
      onFoot: true,
      vehicleId: null,
      health: 100,
      cash: 0,
      armour: 0,
      weapon: 'fists',
      ammo: 0,
      wantedHeat: 0,
      isRunning: false,
      isAiming: false,
    },
    vehicles: [],
    pedestrians: [],
    police: {
      wanted: 0,
      heat: 0,
      officers: [],
      cars: [],
      escapeTimer: 0,
      bustTimer: 0,
    },
    mission: {
      activeId: null,
      stage: 0,
      objectives: [],
      briefing: '',
      timer: null,
      reward: 0,
    },
    stats: {
      carsStolen: 0,
      missionsDone: 0,
      distanceDriven: 0,
      distanceWalked: 0,
      pedsScared: 0,
      copsEvaded: 0,
      shotsFired: 0,
      bestCash: 0,
    },
    flags: { metRosa: false, harbourOpen: false, ownsPistol: false },
    events: null,
  };
  world.city = buildCity(cityRng);
  return world;
}

function spawnWorld(world) {
  const parkedRng = createRng(world.seed + 404);
  const trafficRng = createRng(world.seed + 101);
  const pedRng = createRng(world.seed + 202);
  vehicles.spawnParkedCars(world, parkedRng, 18);
  traffic.spawnTraffic(world, trafficRng, GAME_CONFIG.trafficTarget);
  pedestrians.spawnPedestrians(world, pedRng, GAME_CONFIG.pedTarget);
}

export function createGame(canvas, opts) {
  const options = opts || {};
  const params = options.params || new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const seedRaw = parseInt(params.get('seed') || '1', 10);
  const seed = Number.isFinite(seedRaw) ? seedRaw : 1;
  const world = buildWorld(seed);
  const events = makeEventBus();
  world.events = events;

  const cameraState = { yaw: 0, pitch: 0.35, mode: 'title' };
  const input = inputMod.createInput(canvas, KEY_BINDINGS);
  world.input = input; // lets shots.js drive the autopilot through real input
  let hudHandle = null;
  let running = false;
  let rafId = 0;
  let lastFrameMs = 0;
  let accumulator = 0;
  let firstFrameDone = false;
  let watchdogFired = false;

  function setScreen(screen) {
    world.screen = screen;
    world.paused = screen !== 'play';
    input.playing = screen === 'play'; // gates pointer lock + key preventDefault
    // Leaving play must release the pointer: while locked, the browser
    // retargets every mouse event to the canvas, so pause-menu buttons
    // would never receive a click (headless keeps the lock after Esc).
    if (screen !== 'play' && typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock();
    }
    events.emit('screen-changed', { screen });
    render.setCameraMode(screen === 'title' ? 'title' : world.player.onFoot ? 'foot' : 'chase');
    if (typeof document !== 'undefined') {
      const show = (id, on) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('visible', on);
      };
      show('title-screen', screen === 'title');
      show('pause-screen', screen === 'pause');
      show('gameover-screen', screen === 'busted' || screen === 'wasted');
      show('hud', screen === 'play' || screen === 'pause');
      const title = document.getElementById('gameover-title');
      const sub = document.getElementById('gameover-sub');
      if (title) title.textContent = screen === 'busted' ? 'BUSTED' : 'WASTED';
      if (sub) sub.textContent = screen === 'busted' ? 'The law caught up with Mara' : 'Mara is down — the crew drags her to the clinic';
      const cont = document.getElementById('btn-continue');
      if (cont && screen === 'title') cont.disabled = !save.hasSave();
    }
  }

  function handleScreenEvents(drained) {
    for (const ev of drained) {
      if (ev.type === 'busted') setScreen('busted');
      else if (ev.type === 'player-down') setScreen('wasted');
    }
  }

  function drainEvents() {
    const drained = events.drain();
    const handlers = [missions, vehicles, traffic, pedestrians, police, combat, audio, hud, save];
    for (const mod of handlers) {
      if (typeof mod.handleEvents === 'function') {
        try { mod.handleEvents(world, drained); } catch (err) { /* one module must not kill the tick */ }
      }
    }
    handleScreenEvents(drained);
  }

  function tick(dt) {
    // Mouse look orbits the camera; on-foot movement and aiming are both
    // relative to this yaw — vehicles.js reads it as world.cameraYaw.
    // (The chase camera while driving follows the car heading instead,
    // inside render.js, so yaw is untouched there.)
    const look = inputMod.getLookDelta(input);
    // Mouse right turns the view right: yaw grows with positive look dx,
    // matching the forward vector (sin yaw, -cos yaw) the player walks along.
    cameraState.yaw += look.dx * 0.0032;
    cameraState.pitch = Math.max(-0.1, Math.min(1.2, cameraState.pitch + look.dy * 0.0022));
    world.cameraYaw = cameraState.yaw;

    inputMod.updateInput(input);
    if (shots.isShotMode && shots.isShotMode()) shots.updateAutopilot(world, dt);
    missions.updateMission(world, dt);
    vehicles.updateVehicles(world, dt, input);
    traffic.updateTraffic(world, dt);
    pedestrians.updatePedestrians(world, dt);
    police.updatePolice(world, dt);
    combat.updateCombat(world, dt);
    audio.updateAudio(world, dt);
    hud.updateHud(world, dt);
    save.autosaveIfDue(world, dt);

    world.tick += 1;
    world.clock += dt;
    world.timeOfDay = (GAME_CONFIG.dayStartHour + world.clock * GAME_CONFIG.clockHoursPerSim) % 24;

    // Camera mode follows screen and player state.
    if (world.screen === 'title') cameraState.mode = 'title';
    else if (world.player.onFoot) cameraState.mode = 'foot';
    else cameraState.mode = 'chase';
    render.setCameraMode(cameraState.mode);
    drainEvents();
  }

  function renderFrame() {
    render.renderWorld(world, cameraState);
    firstFrameDone = true;
    if (shots.isShotMode && shots.isShotMode() && typeof shots.updateShotReadiness === 'function') {
      shots.updateShotReadiness(world);
    }
  }

  function frame(nowMs) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const now = nowMs || 0;
    // Clamp wall-time stalls so a tab switch never fast-forwards the sim.
    // This is the ONLY place real frame time is measured; it never advances
    // game state directly — the fixed-step accumulator does that.
    let realDt = lastFrameMs ? (now - lastFrameMs) / 1000 : STEP;
    lastFrameMs = now;
    if (!Number.isFinite(realDt) || realDt < 0) realDt = 0;
    if (realDt > GAME_CONFIG.maxFrameDt) realDt = GAME_CONFIG.maxFrameDt;
    if (world.screen === 'play' && !world.paused) {
      accumulator += realDt;
      let steps = 0;
      while (accumulator >= STEP && steps < GAME_CONFIG.maxStepsPerFrame) {
        tick(STEP);
        accumulator -= STEP;
        steps += 1;
      }
      if (steps === GAME_CONFIG.maxStepsPerFrame) accumulator = 0;
    } else if (world.screen === 'title') {
      // Title keeps the city alive behind the menu: slow ambient steps.
      accumulator += realDt;
      let steps = 0;
      while (accumulator >= STEP && steps < 2) {
        world.tick += 1;
        world.clock += STEP;
        world.timeOfDay = (GAME_CONFIG.dayStartHour + world.clock * GAME_CONFIG.clockHoursPerSim) % 24;
        traffic.updateTraffic(world, STEP);
        pedestrians.updatePedestrians(world, STEP);
        accumulator -= STEP;
        steps += 1;
      }
    }
    renderFrame();
  }

  function start() {
    if (running) return;
    running = true;
    lastFrameMs = 0;
    accumulator = 0;
    rafId = requestAnimationFrame(frame);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        if (!firstFrameDone && !watchdogFired) {
          watchdogFired = true;
          render.enableFallback();
        }
      }, GAME_CONFIG.renderWatchdogMs);
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function onVisibilityHidden() {
    if (world.screen === 'play') setScreen('pause');
  }

  return { world, events, cameraState, input, start, stop, setScreen, tick, renderFrame, onVisibilityHidden };
}

export function boot() {
  if (typeof window !== 'undefined') {
    window.__shotReady = false;
    window.__shot = '';
    window.__renderMode = 'webgl';
  }
  const canvas = document.getElementById('game-canvas');
  const params = new URLSearchParams(window.location.search);
  const renderParam = params.get('render');
  if (renderParam === 'canvas2d' && typeof render.forceFallbackForTests === 'function') {
    render.forceFallbackForTests();
  }
  const game = createGame(canvas, { params });
  const world = game.world;
  window.__game = game; // test/debug handle (smoke test + shots read state here)

  render.createRenderer(canvas);
  render.resize(window.innerWidth, window.innerHeight);
  spawnWorld(world);

  const shot = params.get('shot');
  if (shot) {
    window.__shot = shot;
    if (typeof shots.parseShotParams === 'function') {
      const parsed = shots.parseShotParams(window.location.search);
      shots.stageShot(world, parsed);
    }
  }
  if (typeof hud.createHud === 'function') hud.createHud(document);

  // First user gesture unlocks audio (browsers require it).
  const unlock = () => {
    if (typeof audio.initAudio === 'function') audio.initAudio();
    if (typeof audio.startMusic === 'function') audio.startMusic();
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  // Request pointer lock without ever surfacing a console error: the
  // browser refuses a re-lock for ~1.25 s after an exit, and that
  // rejection must not become an uncaught promise error.
  function lockPointer() {
    if (!canvas || !canvas.requestPointerLock) return;
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (err) { /* lock refused; a canvas click re-locks */ }
  }

  // Menu wiring.
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  const seedLine = document.getElementById('seed-line');
  if (seedLine) seedLine.textContent = 'Seed ' + world.seed;
  on('btn-new-game', () => {
    world.player.pos = { x: -222, y: 0, z: 96 };
    world.player.health = 100;
    world.player.cash = 0;
    world.player.onFoot = true;
    world.player.vehicleId = null;
    police.clearWanted(world);
    game.setScreen('play');
    lockPointer();
  });
  on('btn-continue', () => {
    const saved = save.loadGame();
    if (saved) {
      world.player.cash = saved.cash || 0;
      world.player.health = (saved.player && saved.player.health) || 100;
      world.player.ammo = (saved.player && saved.player.ammo) || 0;
      world.player.weapon = (saved.player && saved.player.weapon) || 'fists';
      if (saved.flags) world.flags = Object.assign(world.flags, saved.flags);
      if (saved.stats) world.stats = Object.assign(world.stats, saved.stats);
      world.player.pos = { x: -222, y: 0, z: 96 };
      world.player.onFoot = true;
      game.setScreen('play');
      lockPointer();
    }
  });
  on('btn-howto', () => {
    const help = document.getElementById('help-panel');
    if (help) help.classList.add('visible');
  });
  on('btn-pause-howto', () => {
    const help = document.getElementById('help-panel');
    if (help) help.classList.add('visible');
  });
  on('btn-close-help', () => {
    const help = document.getElementById('help-panel');
    if (help) help.classList.remove('visible');
  });
  let muted = false;
  const toggleMute = () => {
    muted = !muted;
    if (typeof audio.setMuted === 'function') audio.setMuted(muted);
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = 'Mute: ' + (muted ? 'On' : 'Off');
    return muted;
  };
  on('btn-mute', toggleMute);
  on('btn-resume', () => {
    game.setScreen('play');
    lockPointer();
  });
  on('btn-save-quit', () => {
    save.saveGame(world);
    game.setScreen('title');
  });
  on('btn-retry', () => {
    world.player.health = 100;
    world.player.pos = { x: -222, y: 0, z: 96 };
    world.player.onFoot = true;
    world.player.vehicleId = null;
    police.clearWanted(world);
    game.setScreen('play');
  });
  on('btn-freeroam', () => {
    world.mission.activeId = null;
    world.mission.objectives = [];
    world.player.health = 100;
    world.player.pos = { x: -222, y: 0, z: 96 };
    world.player.onFoot = true;
    police.clearWanted(world);
    game.setScreen('play');
  });
  on('btn-to-title', () => game.setScreen('title'));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.onVisibilityHidden();
  });
  // In a real browser Esc exits pointer lock without delivering the key,
  // so losing the lock while playing is itself the pause signal.
  // (The guard means the exitPointerLock in setScreen never re-triggers this.)
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && world.screen === 'play') game.setScreen('pause');
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (world.screen === 'play') game.setScreen('pause');
      else if (world.screen === 'pause') game.setScreen('play');
    } else if (e.code === 'Enter' && world.screen === 'title') {
      document.getElementById('btn-new-game').click();
    } else if (e.code === 'F1') {
      e.preventDefault();
      const help = document.getElementById('help-panel');
      if (help) help.classList.toggle('visible');
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });
  window.addEventListener('resize', () => render.resize(window.innerWidth, window.innerHeight));

  game.setScreen('title');
  game.start();
  return game;
}

if (typeof document !== 'undefined' && document.getElementById('game-canvas')) {
  boot();
}
