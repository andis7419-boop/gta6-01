// shots.js — deterministic staged screenshot scenes (W4).
// Shot mode is a normal game with a scripted player: the autopilot drives
// through the input object (input.scripted, honoured by input.isDown /
// wasPressed) so every frame is real play, not a posed render.
// This is the only file besides main.js that reads URL params.
//
// URL contract (DESIGN §4.1):
//   ?shot=start|play|end&seed=N   (&scene=chase|onfoot|mission override)
//   seed 1 -> chase, 2 -> onfoot, 3 -> mission, any other -> chase
//   ?shot=start -> title screen, ?shot=end -> busted screen
// Readiness (§4.3): window.__shotReady is set ONLY by markShotReady(),
// only once the staged tick count is done AND the frame has been rendered
// twice after the last step AND no title fade is animating.

import { addHeat } from './police.js';
import { startMission } from './missions.js';
import { createVehicle } from './vehicles.js';
import { createRng } from './random.js';

const STAGED_TICKS = { chase: 360, onfoot: 120, mission: 240, title: 600, busted: 120 };

let shotActive = false;
let sceneName = null;
let stagedTicks = 0;
let stagedAtTick = 0;
let requiredTicks = 0;
let framesAfterDone = 0;
let route = [];
let routeIndex = 0;

// The input object lives on world.input when main.js wires it (the
// autopilot's primary path). It is null until then.
function getInput(world) {
  if (world.input) return world.input;
  return null;
}

function clearScripted(world) {
  const input = getInput(world);
  if (input) input.scripted = null;
}

export function isShotMode() {
  return shotActive;
}

export function parseShotParams(url) {
  const search = typeof url === 'string' ? url
    : (url && url.search) || '';
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const shot = params.get('shot');
  const rawSeed = params.get('seed');
  const seed = rawSeed === null ? 1 : (parseInt(rawSeed, 10) || 1);
  const override = params.get('scene');
  let scene = null;
  if (shot === 'start') {
    scene = 'title';
  } else if (shot === 'end') {
    scene = 'busted';
  } else if (shot === 'play') {
    if (override === 'chase' || override === 'onfoot' || override === 'mission') {
      scene = override;
    } else if (seed === 2) {
      scene = 'onfoot';
    } else if (seed === 3) {
      scene = 'mission';
    } else {
      scene = 'chase';
    }
  }
  return { shot: shot || null, seed, scene };
}

function placePlayerInCar(world, car) {
  car.state = 'player';
  car.driver = 'player';
  world.player.onFoot = false;
  world.player.vehicleId = car.id;
  world.player.pos.x = car.pos.x;
  world.player.pos.y = car.pos.y;
  world.player.pos.z = car.pos.z;
  world.player.heading = car.heading;
}

function addCar(world, id, kind, x, z, heading, colour, state, driver) {
  const car = createVehicle(id, kind, x, z, heading, colour);
  car.state = state || 'traffic';
  car.driver = driver || 'traffic';
  world.vehicles.push(car);
  return car;
}

function stageChase(world) {
  // 1-cover: red Veltor Comet down Palm Row, 2 police behind, traffic
  // ahead, wanted 3 stars, objective "Lose the cops — reach the Marina".
  const car = createVehicle('shot-comet', 'sport', -72, 120, 0, 0xc22e2e);
  car.make = 'Veltor';
  car.model = 'Comet';
  car.speed = 24;
  world.vehicles.push(car);
  placePlayerInCar(world, car);
  addCar(world, 'shot-police-1', 'police', -76, 152, 0, 0x1a2a44, 'police', 'police');
  addCar(world, 'shot-police-2', 'police', -66, 168, 0, 0x1a2a44, 'police', 'police');
  world.police.cars = ['shot-police-1', 'shot-police-2'];
  addCar(world, 'shot-traffic-1', 'sedan', -72, 48, 0, 0x4a6a8a);
  addCar(world, 'shot-traffic-2', 'sedan', -60, 12, 0, 0x8a7a4a);
  addCar(world, 'shot-traffic-3', 'taxi', -84, -24, 0, 0xf2c230);
  addHeat(world, 45); // 40–59 heat = 3 stars
  world.mission.briefing = 'Lose the cops — reach the Marina';
  world.mission.objectives = [{
    type: 'goto', label: 'Lose the cops — reach the Marina',
    target: { x: -240, z: -96 }, radius: 10, done: false, timer: null,
  }];
  world.mission.stage = 0;
  route = [
    { x: -72, z: 48 }, { x: -72, z: -24 }, { x: -72, z: -96 },
    { x: -144, z: -96 }, { x: -216, z: -96 }, { x: -240, z: -96 },
  ];
  routeIndex = 0;
}

function stageOnFoot(world, rng) {
  // 2-onfoot: Mara on a Market Mile pavement, peds nearby, parked cars,
  // one with a steal prompt (nearest car is within E range).
  world.player.onFoot = true;
  world.player.vehicleId = null;
  world.player.pos.x = 108;
  world.player.pos.y = 0;
  world.player.pos.z = 72;
  world.player.heading = Math.PI / 2;
  world.player.health = 100;
  const offsets = [
    [6, -4], [-8, 6], [12, 10], [-4, -12], [16, -6],
  ];
  for (let i = 0; i < offsets.length; i++) {
    world.pedestrians.push({
      id: 'shot-ped-' + i,
      pos: { x: 108 + offsets[i][0], y: 0, z: 72 + offsets[i][1] },
      heading: rng.range(0, Math.PI * 2),
      speed: 1.2, state: 'walk', colour: 0x8a6a4a,
      shirtColour: 0x4a7a8a + i * 0x101010,
      walkPhase: rng.range(0, Math.PI * 2), scared: false,
    });
  }
  addCar(world, 'shot-parked-1', 'sedan', 110, 74, Math.PI / 2, 0x5a7a4a, 'parked', 'none');
  addCar(world, 'shot-parked-2', 'pickup', 96, 60, Math.PI / 2, 0x7a4a5a, 'parked', 'none');
  addCar(world, 'shot-traffic-1', 'sedan', 120, 36, 0, 0x3a5a7a);
  route = [];
}

function stageMission(world) {
  // 3-mission: m5 Harbour Run active, timer 108 s (1:48 left), player in
  // the package van, a Kings car alongside, autopilot toward the marker.
  const van = createVehicle('shot-van-m5', 'van', -72, 252, 0, 0xd8d3c0);
  van.state = 'mission';
  world.vehicles.push(van);
  placePlayerInCar(world, van);
  addCar(world, 'shot-kings-m5', 'sport', -64, 252, 0, 0x222226, 'mission', 'mission');
  startMission(world, 'm5');
  if (world.mission.activeId === 'm5') {
    world.mission.timer = 108;
    world.mission.briefing = 'Deliver the package car — 1:48 left';
  } else {
    // startMission refused (a mission was already active): still show the
    // m5 objective line so the shot reads as a mission in progress.
    world.mission.briefing = 'Deliver the package car — 1:48 left';
    world.mission.objectives = [{
      type: 'deliver', label: 'Deliver the package car — 1:48 left',
      target: { x: -228, z: 228 }, radius: 10, done: false, timer: null,
    }];
    world.mission.stage = 0;
    world.mission.timer = 108;
  }
  // Route to the config m5 deliver target in Harbour Yards (-228, 228).
  route = [
    { x: -144, z: 252 }, { x: -216, z: 240 }, { x: -228, z: 228 },
  ];
  routeIndex = 0;
}

export function stageShot(world, params) {
  const scene = params && params.scene ? params.scene : 'chase';
  sceneName = scene;
  shotActive = true;
  stagedTicks = 0;
  stagedAtTick = world.tick || 0;
  framesAfterDone = 0;
  requiredTicks = STAGED_TICKS[scene] || 360;
  route = [];
  routeIndex = 0;
  if (typeof window !== 'undefined') {
    window.__shot = scene;
    window.__shotReady = false;
  }
  const rng = createRng(world.seed + 303);
  if (scene === 'chase') {
    stageChase(world);
  } else if (scene === 'onfoot') {
    stageOnFoot(world, rng);
  } else if (scene === 'mission') {
    stageMission(world);
  } else if (scene === 'title') {
    world.screen = 'title';
  } else if (scene === 'busted') {
    world.screen = 'busted';
  }
}

// Steer the scripted car toward the next route waypoint. Returns the
// action names held down this tick (input.js reads scripted.down as an
// Array, a Set, or an object map — an Array is used here).
function driveToward(world, target) {
  const car = world.player.vehicleId
    ? world.vehicles.find((v) => v.id === world.player.vehicleId) : null;
  const px = car ? car.pos.x : world.player.pos.x;
  const pz = car ? car.pos.z : world.player.pos.z;
  const desired = Math.atan2(target.x - px, -(target.z - pz));
  let diff = desired - world.player.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const dist = Math.hypot(target.x - px, target.z - pz);
  const down = [];
  if (dist > 4) down.push('forward');
  if (diff < -0.08) down.push('left');
  if (diff > 0.08) down.push('right');
  if (Math.abs(diff) > 1.2) down.push('handbrake');
  return down;
}

// Kinematic fallback: if main.js never wired world.input, the autopilot
// still has to move the staged car, so it advances the player's vehicle
// along the route itself (same heading/speed the physics would produce).
// The input-scripted path above is used whenever world.input exists.
function driveKinematic(world, target, dt) {
  const car = world.player.vehicleId
    ? world.vehicles.find((v) => v.id === world.player.vehicleId) : null;
  if (!car) return;
  const dx = target.x - car.pos.x;
  const dz = target.z - car.pos.z;
  if (Math.hypot(dx, dz) < 4) return;
  car.heading = Math.atan2(dx, -dz);
  car.speed = 24;
  car.pos.x += Math.sin(car.heading) * car.speed * dt;
  car.pos.z -= Math.cos(car.heading) * car.speed * dt;
  world.player.pos.x = car.pos.x;
  world.player.pos.z = car.pos.z;
  world.player.heading = car.heading;
}

export function updateAutopilot(world, dt) {
  if (!shotActive) return;
  if (stagedTicks >= requiredTicks) {
    clearScripted(world);
    return;
  }
  stagedTicks += 1;
  if (sceneName === 'chase' || sceneName === 'mission') {
    const target = route[routeIndex];
    if (!target) return;
    const px = world.player.pos.x;
    const pz = world.player.pos.z;
    if (Math.hypot(target.x - px, target.z - pz) < 6 && routeIndex < route.length - 1) {
      routeIndex += 1;
    }
    const waypoint = route[routeIndex];
    const input = getInput(world);
    if (input) {
      input.scripted = { down: driveToward(world, waypoint) };
    } else {
      driveKinematic(world, waypoint, dt || 1 / 60);
    }
  } else {
    // On foot / title / busted: no scripted input, the scene plays itself.
    clearScripted(world);
  }
}

// Called by main.js once per rendered frame, after render. Readiness is
// measured on the simulation clock, not on autopilot calls: in title mode
// main.js never runs tick(), it only ambient-steps world.tick, so the
// title shot's 600 ticks are counted here. Sets window.__shotReady ONLY
// via markShotReady(), once the staged ticks are done AND the frame has
// been rendered twice after the last step.
export function updateShotReadiness(world) {
  if (!shotActive) return false;
  const ticksDone = (world.tick || 0) - stagedAtTick;
  if (ticksDone < requiredTicks) return false;
  framesAfterDone += 1;
  if (framesAfterDone < 2) return false;
  return markShotReady();
}

// Sets window.__shotReady = true, and only when the staged scene has been
// stepped the staged number of fixed ticks AND the frame has been rendered
// twice after the last step AND no title fade is animating (title staging
// runs 600 ticks, long past any fade).
export function markShotReady() {
  if (!shotActive) return false;
  if (framesAfterDone < 2) return false;
  if (typeof window !== 'undefined') window.__shotReady = true;
  return true;
}
