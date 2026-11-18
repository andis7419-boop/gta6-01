// audio.js — synthesised WebAudio sound: SFX, engine, sirens, music.
// Oscillators and noise only; no audio files, no external samples, no
// copyrighted melody. Reads world state only — NEVER mutates it.
// If the AudioContext fails, the game continues silently, never throws.

const SFX_VOLUME = 0.5;
const MUSIC_VOLUME = 0.25;
const MUSIC_DUCKED = 0.1;
const SIREN_HIGH = 950;
const SIREN_LOW = 700;

// Original 8-bar loop in C major pentatonic, 96 BPM, one bar per chord.
// Bass roots (Hz) and the pentatonic colour notes each bar may use.
const MUSIC_BPM = 96;
const MUSIC_BARS = [
  { bass: 130.81, keys: [261.63, 329.63, 392.0] }, // C
  { bass: 110.0, keys: [220.0, 261.63, 329.63] }, // Am
  { bass: 87.31, keys: [174.61, 220.0, 261.63] }, // F
  { bass: 98.0, keys: [196.0, 246.94, 293.66] }, // G
  { bass: 130.81, keys: [261.63, 329.63, 392.0] }, // C
  { bass: 110.0, keys: [220.0, 261.63, 329.63] }, // Am
  { bass: 87.31, keys: [174.61, 220.0, 261.63] }, // F
  { bass: 98.0, keys: [196.0, 246.94, 293.66] }, // G
];
const BAR_SECONDS = (60 / MUSIC_BPM) * 4;

let ctx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let engineNodes = null; // { oscA, oscB, filter, gain }
let sirenNodes = null; // { osc, lfo, lfoGain, gain }
let musicTimer = null;
let musicNextBarAt = 0;
let musicBar = 0;
let muted = false;
let sirenWanted = false;

function _ensureContext() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_VOLUME;
    sfxGain.connect(masterGain);
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(masterGain);
  } catch (err) {
    ctx = null; // audio unavailable: stay silent, never throw
  }
  return ctx;
}

function _resume() {
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// Creates the context on the first user gesture, as browsers require.
export function initAudio() {
  const c = _ensureContext();
  if (!c) return false;
  _resume();
  const wake = () => _resume();
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  return true;
}

function _tone(freq, dur, type, vol, when, dest) {
  if (!ctx) return;
  const t0 = when || ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(dest || sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Deterministic noise source: one 1-second buffer filled once from a
// fixed-seed LCG. Audio noise must never use unseeded randomness (banned in game
// code), and a shared buffer is cheaper than filling one per effect.
let noiseBuffer = null;
let noiseSeed = 1234;
function _noiseSample() {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
  return noiseSeed / 4294967296 - 0.5;
}

function _getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = ctx.sampleRate; // 1 second
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * _noiseSample() * 2) / 1.02; // gentle brown-ish tilt
    data[i] = last * 3;
  }
  return noiseBuffer;
}

function _noise(dur, vol, filterFreq, filterType, when, dest) {
  if (!ctx) return;
  const t0 = when || ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = _getNoiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || 'lowpass';
  filter.frequency.value = filterFreq || 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest || sfxGain);
  src.start(t0);
  src.stop(t0 + dur);
}

// One-shot sound effects. Unknown names are ignored silently.
export function playSfx(name, opts) {
  if (muted) return;
  if (!_ensureContext()) return;
  _resume();
  const o = opts || {};
  const vol = typeof o.volume === 'number' ? o.volume : 1;
  const t = ctx.currentTime;
  if (name === 'shot') {
    _noise(0.12, 0.9 * vol, 900, 'lowpass', t);
    _tone(90, 0.14, 'sine', 0.8 * vol, t);
  } else if (name === 'punch') {
    _noise(0.1, 0.6 * vol, 500, 'lowpass', t);
    _tone(120, 0.09, 'sine', 0.5 * vol, t);
  } else if (name === 'alarm') {
    _tone(880, 0.12, 'square', 0.25 * vol, t);
    _tone(880, 0.12, 'square', 0.25 * vol, t + 0.18);
    _tone(880, 0.12, 'square', 0.25 * vol, t + 0.36);
  } else if (name === 'pickup') {
    _tone(523.25, 0.1, 'sine', 0.4 * vol, t);
    _tone(783.99, 0.16, 'sine', 0.4 * vol, t + 0.09);
  } else if (name === 'crash') {
    _noise(0.35, 0.8 * vol, 700, 'lowpass', t);
    _tone(70, 0.3, 'sine', 0.7 * vol, t);
  } else if (name === 'screech') {
    _noise(0.4, 0.35 * vol, 2400, 'bandpass', t);
  } else if (name === 'ui-click') {
    _tone(880, 0.06, 'sine', 0.35 * vol, t);
  } else if (name === 'sting') {
    _tone(261.63, 0.22, 'triangle', 0.4 * vol, t);
    _tone(329.63, 0.22, 'triangle', 0.4 * vol, t + 0.11);
    _tone(392.0, 0.4, 'triangle', 0.45 * vol, t + 0.22);
  } else if (name === 'phone') {
    _tone(1046.5, 0.14, 'sine', 0.3 * vol, t);
    _tone(1318.5, 0.14, 'sine', 0.3 * vol, t + 0.2);
    _tone(1046.5, 0.14, 'sine', 0.3 * vol, t + 0.4);
  } else if (name === 'busted') {
    _tone(392.0, 0.25, 'square', 0.3 * vol, t);
    _tone(311.13, 0.25, 'square', 0.3 * vol, t + 0.25);
    _tone(233.08, 0.5, 'square', 0.3 * vol, t + 0.5);
  } else if (name === 'wasted') {
    _tone(220.0, 0.4, 'sawtooth', 0.3 * vol, t);
    _tone(174.61, 0.4, 'sawtooth', 0.3 * vol, t + 0.4);
    _tone(130.81, 0.9, 'sawtooth', 0.3 * vol, t + 0.8);
  } else if (name === 'engine-start') {
    _noise(0.5, 0.3 * vol, 400, 'lowpass', t);
    _tone(55, 0.5, 'sawtooth', 0.25 * vol, t);
    _tone(110, 0.4, 'sawtooth', 0.2 * vol, t + 0.35);
  } else if (name === 'siren') {
    setSirenOn(true);
  }
}

// Continuous engine hum: two detuned oscillators through a low-pass filter,
// pitch tied to speed. Call every tick; silent when speed is 0 and on foot.
export function setEngineSound(speed, rpm) {
  if (muted || !_ensureContext()) return;
  _resume();
  if (!engineNodes) {
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    oscA.type = 'sawtooth';
    oscB.type = 'square';
    oscA.frequency.value = 50;
    oscB.frequency.value = 75;
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    gain.gain.value = 0;
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    oscA.start();
    oscB.start();
    engineNodes = { oscA, oscB, filter, gain };
  }
  const revs = Math.max(0, rpm || 0) + Math.max(0, speed || 0) * 3;
  const freq = 45 + revs * 2.2;
  engineNodes.oscA.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
  engineNodes.oscB.frequency.setTargetAtTime(freq * 1.5 + 2, ctx.currentTime, 0.08);
  engineNodes.filter.frequency.setTargetAtTime(400 + revs * 22, ctx.currentTime, 0.1);
  const target = (speed || 0) > 0.5 ? 0.12 : 0;
  engineNodes.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
}

// Two-tone siren loop, alternating 700/950 Hz. Volume is set per tick by
// updateAudio from the distance to the nearest police car.
export function setSirenOn(on) {
  sirenWanted = !!on;
  if (!_ensureContext()) return;
  if (on && !sirenNodes) {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = SIREN_LOW;
    lfo.type = 'square';
    lfo.frequency.value = 0.55; // ~0.9 s per tone
    lfoGain.gain.value = (SIREN_HIGH - SIREN_LOW) / 2;
    gain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.frequency.value = (SIREN_HIGH + SIREN_LOW) / 2;
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start();
    lfo.start();
    sirenNodes = { osc, lfo, lfoGain, gain };
  }
  if (sirenNodes) {
    sirenNodes.gain.gain.setTargetAtTime(on ? 0.1 : 0, ctx.currentTime, 0.2);
  }
}

function _scheduleBar(barIndex, when) {
  const bar = MUSIC_BARS[barIndex % MUSIC_BARS.length];
  const beat = BAR_SECONDS / 4;
  // Bass on beats 1 and 3, keys stab on 2 and 4, hat ticks every half beat.
  _tone(bar.bass, beat * 1.8, 'triangle', 0.5, when, musicGain);
  _tone(bar.bass, beat * 1.8, 'triangle', 0.4, when + beat * 2, musicGain);
  for (let i = 0; i < bar.keys.length; i++) {
    _tone(bar.keys[i], beat * 0.9, 'triangle', 0.22, when + beat, musicGain);
    _tone(bar.keys[i], beat * 0.9, 'triangle', 0.18, when + beat * 3, musicGain);
  }
  for (let h = 0; h < 8; h++) {
    _noise(0.03, 0.1, 6000, 'highpass', when + (beat / 2) * h, musicGain);
  }
}

export function startMusic() {
  if (!_ensureContext()) return;
  _resume();
  if (musicTimer) return;
  musicBar = 0;
  musicNextBarAt = ctx.currentTime + 0.1;
  musicTimer = window.setInterval(() => {
    if (!ctx) return;
    while (musicNextBarAt < ctx.currentTime + 0.5) {
      _scheduleBar(musicBar, musicNextBarAt);
      musicBar = (musicBar + 1) % MUSIC_BARS.length;
      musicNextBarAt += BAR_SECONDS;
    }
  }, 200);
}

export function stopMusic() {
  if (musicTimer) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

export function setMuted(m) {
  muted = !!m;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  }
  return muted;
}

export function isMuted() {
  return muted;
}

function _nearestPoliceDist(world) {
  const player = world.player;
  if (!player || !player.pos) return Infinity;
  let best = Infinity;
  const cars = (world.police && world.police.cars) || [];
  for (const id of cars) {
    const car = (world.vehicles || []).find((v) => v.id === id);
    if (!car) continue;
    best = Math.min(best, Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z));
  }
  return best;
}

// Per-tick audio: engine pitch, siren distance, music ducking.
export function updateAudio(world, dt) {
  if (!ctx) return;
  const player = world.player;
  const vehicle = !player.onFoot && player.vehicleId
    ? (world.vehicles || []).find((v) => v.id === player.vehicleId)
    : null;
  const speed = vehicle ? Math.abs(vehicle.speed || 0) : 0;
  setEngineSound(speed, vehicle ? (vehicle.rpm || 0) : 0);
  const wanted = (world.police && world.police.wanted) || 0;
  if (wanted > 0) {
    setSirenOn(true);
    const dist = _nearestPoliceDist(world);
    const vol = dist === Infinity ? 0 : Math.max(0.02, Math.min(0.22, 14 / Math.max(dist, 8)));
    if (sirenNodes) sirenNodes.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.15);
  } else if (sirenWanted) {
    setSirenOn(false);
    sirenWanted = false;
  }
  // Duck the music while a mission briefing is on screen.
  const briefing = world.mission && world.mission.briefing;
  if (musicGain) {
    musicGain.gain.setTargetAtTime(briefing ? MUSIC_DUCKED : MUSIC_VOLUME, ctx.currentTime, 0.3);
  }
  void dt;
}

// Drain one tick's events. main.js calls this after update, once per tick.
export function handleEvents(world, events) {
  for (const event of events) {
    const payload = event.payload || {};
    if (event.type === 'wanted-changed') {
      setSirenOn((payload.wanted || 0) > 0);
      if ((payload.wanted || 0) > 0) playSfx('alarm', { volume: 0.5 });
    } else if (event.type === 'police-spawned') {
      setSirenOn(true);
    } else if (event.type === 'escaped') {
      playSfx('sting', { volume: 0.7 });
    } else if (event.type === 'busted') {
      playSfx('busted');
      setSirenOn(false);
    } else if (event.type === 'mission-started') {
      playSfx('phone');
    } else if (event.type === 'objective-done') {
      playSfx('pickup', { volume: 0.8 });
    } else if (event.type === 'mission-done') {
      playSfx('sting');
    } else if (event.type === 'shot-fired') {
      playSfx('shot');
    } else if (event.type === 'punch') {
      playSfx('punch');
    } else if (event.type === 'pickup') {
      playSfx('pickup');
    } else if (event.type === 'damage') {
      if ((payload.amount || 0) >= 20) playSfx('crash', { volume: 0.6 });
      else playSfx('punch', { volume: 0.5 });
    }
  }
  void world;
}
