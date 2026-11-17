export const GAME_CONFIG = { step: 1 / 60, maxStepsPerFrame: 5, maxFrameDt: 0.25, walkSpeed: 4.2, runSpeed: 6.8, jumpHeight: 0.4,
  jumpTime: 0.45, walkPhaseRate: 1.9, playerRadius: 0.45, cameraFov: 62,
  cameraFootDist: 3.2, cameraFootHeight: 1.6, cameraChaseDist: 7.0, cameraChaseHeight: 3.0,
  cameraTitleHeight: 40, cameraTitleRadius: 180, mouseSensitivity: 0.0026, pitchMin: -0.55,
  pitchMax: 0.65, driveAccel: 14, driveBrake: 22, driveReverseSpeed: 10, driveTopSpeed: 38, sportTopSpeed: 46, policeTopSpeed: 42, driveSteerMax: 0.55,
  driveSteerSpeedFalloff: 0.011, carCollisionDamageSpeed: 5, stealTime: 0.8,
  stealRange: 3, timeOfDayStart: 10.5, timeOfDayRate: 1 / 120, duskHour: 17,
  renderWatchdogSeconds: 5, minimapViewMetres: 240,
  shotStagedTicks: { chase: 360, onfoot: 120, mission: 240, title: 600 }, };
export const CITY_CONFIG = { blocksX: 8, blocksZ: 8, blockSize: 60, roadWidth: 12, citySize: 576, buildingMinHeight: 8, buildingMaxHeight: 48,
  marinaHeightBonus: 16, buildingsPerBlockMin: 1, buildingsPerBlockMax: 3, pavementWidth: 4,
  palmSpacing: 18, propBenchCount: 26, propHydrantCount: 18, seaWidth: 320, };
export const PALETTE = { skyDay: 0x8ec9e8, skyDusk: 0xff9a52, sunDay: 0xfff2d0, sunDusk: 0xffb36b, fogDay: 0xa8d0e6, road: 0x2f3337,
  pavement: 0x9aa0a3, sea: 0x2f7fb8,
  buildingHues: [0xe8c9a0, 0xd9a08c, 0xc9d6d2, 0xf2e3c9, 0xb8c9d9, 0xe0b8b0], glass: 0x2a3f4d,
  roofGarden: 0x4d8a4d, palmTrunk: 0x8a6a45, palmCrown: 0x3d8a3d, lampPole: 0x3a3f45, lampGlow: 0xffe9a8, benchWood: 0x8a6a45,
  hydrantRed: 0xc23b2a, carColours: [0xc23b2a, 0x2a5fa8, 0xe8e8e8, 0x2b2b2b, 0xe8a83b, 0x4d8a4d, 0x7a4d8a],
  policeBlue: 0x1e4da8, playerShirt: 0x2a7a8a, playerSkin: 0xd9a078, playerTrousers: 0x2b3a4d, };
export const KEY_BINDINGS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', sprintAlt: 'ShiftRight', handbrake: 'Space',
  enterCar: 'KeyE', punch: 'KeyF', aim: 'MouseRight', shoot: 'MouseLeft',
  reload: 'KeyR', horn: 'KeyH', pause: 'Escape', pauseAlt: 'KeyP', mute: 'KeyM', help: 'F1', confirm: 'Enter', };
export const ARROW_MIRRORS = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right', };
export const MISSION_LIST = [ { id: 'm1', title: 'First Fare', briefing: 'Take the taxi to Market Mile — twice.', reward: 150,
    objectives: [ { type: 'goto', label: 'Drive the taxi to Market Mile' },
      { type: 'goto', label: 'Drop the fare off' }, ], }, { id: 'm2', title: 'Borrowed Wheels',
    briefing: 'Steal the Palm Row sport car, bring it to Harbour Yards.', reward: 250,
    objectives: [ { type: 'drive', label: 'Steal the sport car on Palm Row' }, { type: 'deliver', label: 'Deliver the car to Harbour Yards' }, ], }, {
    id: 'm3', title: 'The Long Way Home', briefing: 'Tail the Kings van unseen, then report to Rosa.', reward: 300,
    objectives: [ { type: 'follow', label: 'Tail the Kings van unseen' }, { type: 'goto', label: 'Report back to Rosa' }, ], }, {
    id: 'm4', title: 'Smoke on Palm Row', briefing: 'Clear the Palm Row lock-up, then lose the police.', reward: 400,
    objectives: [ { type: 'shootout', label: 'Defeat the Kings at the lock-up' }, { type: 'escape', label: 'Escape the police' }, ], }, {
    id: 'm5', title: 'Harbour Run', briefing: 'Cross the city in the package car in 150s, undamaged.', reward: 500,
    objectives: [ { type: 'deliver', label: 'Deliver the package car' }, ], },
  { id: 'm6', title: 'The Getaway', briefing: 'Lose the cops, then reach the safehouse.', reward: 600, objectives: [
      { type: 'escape', label: 'Lose the 3 stars' }, { type: 'goto', label: 'Reach the safehouse' }, ], },
  { id: 'm7', title: 'Settling the Debt', briefing: 'Ram the getaway car to a stop, then meet Rosa.', reward: 1000, objectives: [
      { type: 'chase', label: 'Ram the getaway car to a stop' }, { type: 'goto', label: 'Meet Rosa' }, ], }, ];
export function getConfig() { return GAME_CONFIG;
}
export function getKeyBindings() { return KEY_BINDINGS;
}
