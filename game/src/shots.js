import { GAME_CONFIG } from './config.js';
import { nearestRoadPoint } from './city.js';
import { createVehicle, enterVehicle } from './vehicles.js';
import { startMission } from './missions.js';
import { addHeat, spawnPoliceCar } from './police.js';
import { showMessage } from './hud.js';
var _shot = null;
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function gridLine(v) { return -288 + 72 * Math.round((v + 288) / 72); }
function freshInput() { return { down: new Set(), pressed: new Set(), pressedTick: new Set(),
    lookDx: 0, lookDy: 0, lookTickDx: 0, lookTickDy: 0, mouseX: 0, mouseY: 0, pointerLocked: false };
}
function applyActions(input, want) { var acts = ['forward', 'back', 'left', 'right'];
  for (var i = 0; i < acts.length; i++) { var a = acts[i];
    if (want[a]) { if (!input.down.has(a)) input.pressed.add(a); input.down.add(a); }
    else input.down.delete(a);
  }
}
function driveToward(world, tx, tz) { var p = world.player;
  var dx = tx - p.pos.x, dz = tz - p.pos.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  var want = wrapAngle(Math.atan2(dx, -dz) - p.heading);
  var act = { forward: true, back: false, left: false, right: false };
  if (want > 0.08) act.right = true;
  else if (want < -0.08) act.left = true;
  applyActions(_shot.input, act);
  return dist;
}
function walkToward(world, tx, tz) { var p = world.player;
  var dx = tx - p.pos.x, dz = tz - p.pos.z;
  var want = wrapAngle(Math.atan2(dx, -dz) - p.heading);
  var delta = Math.max(-0.12, Math.min(0.12, want));
  _shot.input.lookDx = delta / 0.0026;
  applyActions(_shot.input, { forward: true, back: false, left: false, right: false });
  return Math.sqrt(dx * dx + dz * dz);
}
export function parseShotParams(search) { var q = new URLSearchParams(search || '');
  var seedRaw = parseInt(q.get('seed') || '1', 10);
  return { shot: q.get('shot') || null, seed: Number.isFinite(seedRaw) ? seedRaw : 1, scene: q.get('scene') || null, render: q.get('render') || null
  };
}
function sceneFor(params) { if (!params || !params.shot) return null;
  if (params.shot === 'start') return 'title';
  if (params.shot === 'end') return 'busted';
  if (params.shot === 'play') { if (params.scene === 'chase' || params.scene === 'onfoot' || params.scene === 'mission') return params.scene;
    if (params.seed === 2) return 'onfoot';
    if (params.seed === 3) return 'mission';
    return 'chase';
  }
  return null;
}
function stageChase(world, game) { var emit = game.events.emit;
  var car = createVehicle('shot-comet', 'sport', -144, 150, 0, 0xc23b2a);
  car.make = 'Veltor'; car.model = 'Comet';
  car.state = 'player'; car.driver = 'player'; car.stolen = true;
  world.vehicles.push(car);
  world.player.onFoot = false; world.player.vehicleId = car.id;
  world.player.pos.x = -144; world.player.pos.y = 0; world.player.pos.z = 150;
  world.player.heading = 0; world.player.speed = 0;
  addHeat(world, 45, emit);
  spawnPoliceCar(world, emit);
  spawnPoliceCar(world, emit);
  return [{ x: -144, z: 60 }, { x: -144, z: -180 }];
}
function stageOnfoot(world, game) { world.player.onFoot = true; world.player.vehicleId = null;
  world.player.pos.x = 140; world.player.pos.y = 0; world.player.pos.z = 66;
  world.player.heading = 0; world.player.speed = 0;
  var c1 = createVehicle('shot-parked-1', 'sedan', 147, 36, 0, 0x2a5fa8);
  c1.make = 'Veltor'; c1.model = 'Largo'; c1.state = 'parked';
  var c2 = createVehicle('shot-parked-2', 'pickup', 147, 52, 0, 0xe8a83b);
  c2.make = 'Veltor'; c2.model = 'Hauler'; c2.state = 'parked';
  world.vehicles.push(c1); world.vehicles.push(c2);
  return [{ x: 140, z: 24 }];
}
function stageMission(world, game) { var emit = game.events.emit;
  startMission(world, 'm5', emit);
  world.mission.timer = 108;
  var van = world.vehicles.find((v) => v.id === 'mission-m5-van') || null;
  if (van) { world.player.pos.x = van.pos.x + 2; world.player.pos.y = 0; world.player.pos.z = van.pos.z;
    world.player.onFoot = true; world.player.heading = 0;
    enterVehicle(world, van.id, emit);
    var kings = createVehicle('shot-kings', 'sport', van.pos.x + 8, van.pos.z, 0, 0x1a1a1a);
    kings.make = 'Veltor'; kings.model = 'Comet';
    kings.state = 'mission'; kings.driver = 'mission';
    world.vehicles.push(kings);
    _shot.kingsId = kings.id;
  }
  var s = nearestRoadPoint(world.city, 0, 234);
  return [s, { x: s.x, z: -144 }, { x: 216, z: -144 }, { x: 198, z: -162 }];
}
export function stageShot(world, params) { var scene = sceneFor(params);
  if (!scene || !params.game) return null;
  var game = params.game;
  var target = GAME_CONFIG.shotStagedTicks[scene] || 120;
  _shot = { scene: scene, target: target, ticks: 0, frames: 0, done: false, input: freshInput(), wps: [], wp: 0, game: game };
  if (scene === 'chase') _shot.wps = stageChase(world, game);
  else if (scene === 'onfoot') _shot.wps = stageOnfoot(world, game);
  else if (scene === 'mission') _shot.wps = stageMission(world, game);
  else if (scene === 'title') { world.paused = false; _shot.wps = []; }
  else if (scene === 'busted') { _shot.target = 60; _shot.wps = []; }
  if (typeof window !== 'undefined') window.__shot = scene;
  return _shot;
}
export function isShotMode() { return _shot !== null; }
export function getShotInput() { return _shot ? _shot.input : null; }
export function updateAutopilot(world, dt) { if (!_shot) return;
  _shot.ticks++;
  if (_shot.scene === 'mission' && _shot.kingsId) { var kings = world.vehicles.find((v) => v.id === _shot.kingsId) || null;
    var van = world.vehicles.find((v) => v.id === 'mission-m5-van') || null;
    if (kings && van) { var h = van.heading;
      kings.pos.x = van.pos.x + Math.cos(h) * 7 + Math.sin(h) * 2;
      kings.pos.z = van.pos.z + Math.sin(h) * 7 - Math.cos(h) * 2;
      kings.heading = h;
      kings.speed = van.speed;
    }
  }
  var wps = _shot.wps;
  if (!wps || wps.length === 0) return;
  var wp = wps[Math.min(_shot.wp, wps.length - 1)];
  var dist;
  if (_shot.scene === 'onfoot') { dist = walkToward(world, wp.x, wp.z);
    if (_shot.game && _shot.game.hud) showMessage(_shot.game.hud, world, 'Press E to steal this car', 5);
  } else { dist = driveToward(world, wp.x, wp.z);
  }
  if (dist < 8 && _shot.wp < wps.length - 1) _shot.wp++;
}
export function countShotFrame() { if (!_shot) return false;
  if (_shot.ticks < _shot.target) return false;
  _shot.frames++;
  if (_shot.frames >= 2 && !_shot.done) { _shot.done = true; return true; }
  return false;
}
export function markShotReady() { if (typeof window !== 'undefined') window.__shotReady = true;
}
