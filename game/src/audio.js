import { createRng } from './random.js';
var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
var engOsc = null, engOsc2 = null, engFilter = null, engGain = null;
var sirOsc = null, sirGain = null, sirenOn = false;
var muted = false, musicOn = false, ctxDead = false, lastBeat = -1, melody = null;
function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function ensureCtx() { if (ctx || ctxDead) return ctx;
  try { var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { ctxDead = true; return null; }
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.22; musicBus.connect(master);
    var buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var data = buf.getChannelData(0), rng = createRng(1234);
    for (var i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
    noiseBuf = buf;
    engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 55;
    engOsc2 = ctx.createOscillator(); engOsc2.type = 'square'; engOsc2.frequency.value = 55.5;
    engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter); engOsc2.connect(engFilter);
    engFilter.connect(engGain); engGain.connect(sfxBus);
    engOsc.start(); engOsc2.start();
    sirOsc = ctx.createOscillator(); sirOsc.type = 'square'; sirOsc.frequency.value = 700;
    sirGain = ctx.createGain(); sirGain.gain.value = 0;
    sirOsc.connect(sirGain); sirGain.connect(sfxBus); sirOsc.start();
    var mrng = createRng(777), penta = [60, 62, 64, 67, 69, 72, 74, 76];
    melody = [];
    for (var b = 0; b < 32; b++) melody.push(mrng.chance(0.55) ? penta[mrng.nextInt(0, penta.length)] : 0);
  } catch (err) { ctxDead = true; ctx = null; }
  return ctx;
}
function blip(isTone, f, f2, d, type, v, q, dest, delay) { if (!ctx) return;
  try { var t = ctx.currentTime + (delay || 0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    var src;
    if (isTone) { src = ctx.createOscillator(); src.type = type; src.frequency.setValueAtTime(f, t);
      if (f2 !== f) src.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
      src.connect(g);
    } else { if (!noiseBuf) return;
      src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      var fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q || 1;
      src.connect(fl); fl.connect(g);
    }
    g.connect(dest || sfxBus); src.start(t); src.stop(t + d + 0.02);
  } catch (err) {}
}
var TYPES = { s: 'sine', q: 'square', r: 'triangle', w: 'sawtooth', l: 'lowpass', b: 'bandpass', h: 'highpass' };
var SFX = { shot: 'n3200,.12,l,.7|t160,55,.12,s,.5',
  punch: 'n420,.09,l,.6|t95,55,.09,s,.5', alarm: 't1250,,.09,q,.25|t1250,,.09,q,.25,.14|t1250,,.09,q,.25,.28',
  pickup: 't660,,.08,s,.4|t990,,.12,s,.4,.08', crash: 'n750,.4,l,.8|t90,40,.35,s,.6',
  screech: 'n1900,.3,b,.35', 'ui-click': 't880,,.05,s,.35', sting: 't523,,.12,r,.4|t659,,.12,r,.4,.1|t784,,.22,r,.4,.2',
  phone: 't1150,,.09,q,.2|t1450,,.09,q,.2,.12|t1150,,.09,q,.2,.3|t1450,,.09,q,.2,.42', busted: 't400,,.18,q,.3|t300,,.18,q,.3,.2|t200,,.3,q,.3,.4',
  wasted: 't330,,.2,r,.35|t262,,.2,r,.35,.22|t196,130,.5,r,.35,.44', 'engine-start': 't70,140,.4,w,.3|n500,.35,l,.25',
  horn: 't370,,.3,q,.25|t466,,.3,q,.2', scream: 't980,1250,.16,s,.3', siren: 't700,,.18,q,.2|t950,,.18,q,.2,.2', reload: 't500,,.05,q,.2|t700,,.05,q,.2,.15'
};
export function initAudio() { if (typeof window === 'undefined') return;
  var wake = function () { ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
    startMusic();
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
}
export function playSfx(name) { if (muted) return;
  ensureCtx();
  if (!ctx) return;
  var steps = SFX[name];
  if (!steps) return;
  try { var parts = steps.split('|');
    for (var i = 0; i < parts.length; i++) { var f = parts[i].split(',');
      var kind = f[0].charAt(0), a = +f[0].slice(1);
      if (kind === 't') blip(true, a, f[1] ? +f[1] : a, +f[2], TYPES[f[3]], +f[4], 0, null, +f[5] || 0);
      else blip(false, a, a, +f[1], TYPES[f[2]], +f[3], 2.5, null, +f[4] || 0);
    }
  } catch (err) {}
}
export function setEngineSound(speed, rpm) { if (!ctx || !engOsc) return;
  try { var f = 52 + Math.abs(speed) * 3.2 + (rpm || 0) * 40;
    engOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.06);
    engOsc2.frequency.setTargetAtTime(f * 1.005 + 1, ctx.currentTime, 0.06);
    engFilter.frequency.setTargetAtTime(420 + Math.abs(speed) * 32, ctx.currentTime, 0.1);
  } catch (err) {}
}
export function setSirenOn(on) { sirenOn = !!on; }
export function startMusic() { musicOn = true; ensureCtx(); }
export function stopMusic() { musicOn = false; }
export function setMuted(m) { muted = !!m;
  if (master && ctx) { try { master.gain.value = muted ? 0 : 0.9; } catch (err) {} }
  return muted;
}
export function isMuted() { return muted; }
function nearestPoliceDist(world) { var best = 1e9;
  if (!world.vehicles) return best;
  for (var i = 0; i < world.vehicles.length; i++) { var v = world.vehicles[i];
    if (v.kind !== 'police' || v.state !== 'police') continue;
    var dx = v.pos.x - world.player.pos.x, dz = v.pos.z - world.player.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}
function musicBeat(world) { if (!ctx || !melody) return;
  var beat = Math.floor((world.clock || 0) * 2);
  if (beat <= lastBeat) return;
  lastBeat = beat;
  var bar = Math.floor(beat / 4) % 8, step = beat % 4;
  var roots = [48, 45, 41, 43, 48, 45, 41, 43];
  var duck = world.mission && world.mission.briefing ? 0.45 : 1;
  blip(true, midi(roots[bar]), midi(roots[bar]), 0.42, 'triangle', 0.5 * duck, 0, musicBus, 0);
  if (step === 2) blip(true, midi(roots[bar] + 7), midi(roots[bar] + 7), 0.3, 'triangle', 0.3 * duck, 0, musicBus, 0);
  blip(false, 6000, 6000, 0.05, 'highpass', 0.12 * duck, 1, musicBus, 0);
  var m = melody[(bar * 4 + step) % 32];
  if (m) blip(true, midi(m), midi(m), 0.22, 'sine', 0.28 * duck, 0, musicBus, 0);
}
export function updateAudio(world, dt) { if (!world || !world.player) return;
  if (!ctx) { if (musicOn || world.screen === 'play') ensureCtx(); if (!ctx) return; }
  if (ctx.state === 'suspended') return;
  try { var playing = world.screen === 'play';
    var speed = world.player.onFoot ? 0 : Math.abs(world.player.speed || 0);
    var top = world.player.onFoot ? 0 : 38;
    setEngineSound(speed, top ? speed / top : 0);
    if (engGain) engGain.gain.setTargetAtTime(playing ? (world.player.onFoot ? 0 : 0.045 + speed * 0.0012) : 0, ctx.currentTime, 0.08);
    var wanted = world.police ? world.police.wanted || 0 : 0;
    var on = sirenOn && wanted > 0 && playing;
    if (sirOsc && sirGain) { var phase = Math.floor((world.clock || 0) * 1.4) % 2;
      sirOsc.frequency.setTargetAtTime(phase === 0 ? 700 : 950, ctx.currentTime, 0.03);
      var d = nearestPoliceDist(world);
      sirGain.gain.setTargetAtTime(on ? Math.max(0, Math.min(0.22, 0.22 * (1 - d / 130))) : 0, ctx.currentTime, 0.1);
    }
    if (musicBus) musicBus.gain.setTargetAtTime(musicOn && playing ? 0.22 : (musicOn ? 0.05 : 0), ctx.currentTime, 0.2);
    if (musicOn && playing) musicBeat(world);
  } catch (err) {}
}
var EVENT_SFX = { 'car-stolen': 'alarm', 'car-entered': 'engine-start', 'shot-fired': 'shot', punch: 'punch', 'ped-scared': 'scream', pickup: 'pickup', healed: 'pickup', 'mission-started': 'phone', 'objective-done': 'sting', 'mission-done': 'sting', escaped: 'sting', 'mission-failed': 'wasted', 'player-down': 'wasted' };
export function audioEvent(type, payload, world) { if (type === 'damage') { playSfx(payload && payload.source === 'ram' ? 'crash' : 'punch'); return; }
  if (type === 'busted') { playSfx('busted'); setSirenOn(false); return; }
  if (type === 'wanted-changed') { setSirenOn(payload && payload.wanted > 0); return; }
  var sfx = EVENT_SFX[type];
  if (sfx) playSfx(sfx);
}
