// config.js — single source of truth for tuning numbers, palette and keys.
// No logic, no imports. Other modules import these values and never
// hard-code a tuned number twice. Mission list lives here (single home);
// missions.js imports MISSION_LIST from this file.
export const GAME_CONFIG = {
  step: 1 / 60,
  maxStepsPerFrame: 5,
  maxFrameDt: 0.25,
  walkSpeed: 4.2,
  runSpeed: 6.8,
  aimWalkSpeed: 2.4,
  jumpHeight: 0.4,
  topSpeed: 38,
  sportTopSpeed: 46,
  policeTopSpeed: 42,
  driveAccel: 14,
  brakeDecel: 22,
  reverseSpeed: 10,
  handbrakeGrip: 0.35,
  stealTime: 0.8,
  stealDistance: 3,
  trafficCruiseMin: 8,
  trafficCruiseMax: 14,
  trafficTarget: 14,
  pedTarget: 26,
  pedWalkMin: 1,
  pedWalkMax: 1.8,
  pedFleeSpeed: 3.5,
  copChaseSpeed: 4.5,
  arrestDistance: 2,
  arrestTime: 2,
  heatDecayUnseen: 2,
  heatDecayCalm: 6,
  escapeTimeLow: 12,
  escapeTimeHigh: 20,
  autosaveInterval: 30,
  clockHoursPerSim: 1 / 120,
  dayStartHour: 10.5,
  duskHour: 17,
  renderWatchdogMs: 5000,
  cameraFov: 62,
  footCamBehind: 3.2,
  footCamUp: 1.6,
  chaseCamBehind: 7,
  chaseCamUp: 3,
  titleCamHeight: 40,
};

export const CITY_CONFIG = {
  blocksX: 8,
  blocksZ: 8,
  blockSize: 60,
  roadWidth: 12,
  pitch: 72,
  halfSize: 294,
  minBuildingsPerBlock: 1,
  maxBuildingsPerBlock: 3,
  minBuildingHeight: 8,
  maxBuildingHeight: 48,
  pavementWidth: 4.5,
};

export const PALETTE = {
  sky: 0x87bfe8,
  skyDusk: 0xff9a5c,
  sun: 0xfff2d0,
  sunDusk: 0xffb36b,
  sea: 0x2a7fa8,
  road: 0x3a3d42,
  roadLine: 0xd8d3a8,
  pavement: 0x9a938a,
  blockGround: 0x6f7a5e,
  buildingHues: [0xe8c9a0, 0xd9a08a, 0xa8c4d4, 0xe8e0d0, 0xc4b49a, 0x9fb8a8, 0xd4a8b8],
  glass: 0x4a6a7a,
  carColours: [0xc0392b, 0x2e6db4, 0xe8e8e8, 0x2c2c30, 0xe8b820, 0x3a8a5a, 0x8a5ab4, 0xd4702a],
  policeColour: 0x1a2a5a,
  policeBlue: 0x2a4ad8,
  taxiColour: 0xe8c020,
  palmTrunk: 0x7a5a38,
  palmLeaf: 0x3a8a4a,
  lampGlow: 0xffe8a0,
  playerShirt: 0xd4503a,
  minimapBg: 0x14181f,
  minimapRoad: 0x8a8f98,
  minimapBlock: 0x2a2f38,
  minimapSea: 0x1f4a68,
};

export const KEY_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  sprintAlt: 'ShiftRight',
  handbrake: 'Space',
  enterCar: 'KeyE',
  punch: 'KeyF',
  aim: 'MouseRight',
  shoot: 'MouseLeft',
  reload: 'KeyR',
  horn: 'KeyH',
  pause: 'Escape',
  pauseAlt: 'KeyP',
  mute: 'KeyM',
  help: 'F1',
  confirm: 'Enter',
  up: 'ArrowUp',
  down: 'ArrowDown',
  leftArrow: 'ArrowLeft',
  rightArrow: 'ArrowRight',
};

export const MISSION_LIST = [
  {
    id: 'm1',
    title: 'First Fare',
    briefing: 'Rosa Ibarra needs a favour. Drive her taxi across town to Market Mile. Keep it clean — the Tide Crew is watching.',
    reward: 150,
    objectives: [
      { type: 'goto', label: 'Pick up Rosa at the Marina taxi rank', target: { x: -222, z: 96 }, radius: 8, done: false, timer: null },
      { type: 'drive', label: 'Drive Rosa to Market Mile', target: { x: 228, z: 228 }, radius: 10, done: false, timer: null },
    ],
  },
  {
    id: 'm2',
    title: 'Borrowed Wheels',
    briefing: 'A Veltor Comet is parked near Palm Row and nobody will miss it tonight. Take it and deliver it to Harbour Yards.',
    reward: 250,
    objectives: [
      { type: 'goto', label: 'Find the Comet on Palm Row', target: { x: 36, z: 6 }, radius: 10, done: false, timer: null },
      { type: 'deliver', label: 'Deliver the Comet to Harbour Yards', target: { x: -228, z: 228 }, radius: 10, done: false, timer: null },
    ],
  },
  {
    id: 'm3',
    title: 'The Long Way Home',
    briefing: 'A Harbour Kings van is moving through Old Solmar. Tail it without being seen, then report back to Rosa.',
    reward: 300,
    objectives: [
      { type: 'follow', label: 'Tail the Kings van — stay close, stay unseen', target: { x: -102, z: -174 }, radius: 30, done: false, timer: null },
      { type: 'goto', label: 'Report back to Rosa at the Marina', target: { x: -222, z: 96 }, radius: 8, done: false, timer: null },
    ],
  },
  {
    id: 'm4',
    title: 'Smoke on Palm Row',
    briefing: 'The Kings are holding a lock-up on Palm Row. Clear them out, then lose the police before they box you in.',
    reward: 400,
    objectives: [
      { type: 'shootout', label: 'Defeat the Harbour Kings at the lock-up', target: { x: 108, z: 6 }, radius: 25, done: false, timer: null },
      { type: 'escape', label: 'Lose the wanted level', target: { x: 0, z: 0 }, radius: 0, done: false, timer: null },
    ],
  },
  {
    id: 'm5',
    title: 'Harbour Run',
    briefing: 'A package car has to cross the city in 150 seconds, intact. No shortcuts through the sea, Mara. Drive it like you own it.',
    reward: 500,
    objectives: [
      { type: 'deliver', label: 'Deliver the package car to Harbour Yards', target: { x: -228, z: 228 }, radius: 10, done: false, timer: 150 },
      { type: 'goto', label: 'Walk away clean — reach the Marina', target: { x: -222, z: 96 }, radius: 8, done: false, timer: null },
    ],
  },
  {
    id: 'm6',
    title: 'The Getaway',
    briefing: 'The job went wrong and the whole city is after you. Lose a 3-star wanted level, then reach the safehouse.',
    reward: 600,
    objectives: [
      { type: 'escape', label: 'Lose the 3-star wanted level', target: { x: 0, z: 0 }, radius: 0, done: false, timer: null },
      { type: 'goto', label: 'Reach the Marina safehouse', target: { x: -222, z: 96 }, radius: 10, done: false, timer: null },
    ],
  },
  {
    id: 'm7',
    title: 'Settling the Debt',
    briefing: 'Last job. Ram the Kings getaway car to a stop, then meet Rosa at the Marina. Clear the debt and Solmar Bay is yours.',
    reward: 1000,
    objectives: [
      { type: 'chase', label: 'Ram the Kings getaway car to a stop', target: { x: 108, z: -102 }, radius: 20, done: false, timer: null },
      { type: 'goto', label: 'Meet Rosa at the Marina', target: { x: -222, z: 96 }, radius: 8, done: false, timer: null },
    ],
  },
];

export function getConfig() {
  return GAME_CONFIG;
}

export function getKeyBindings() {
  return KEY_BINDINGS;
}

export function getMissionById(id) {
  return MISSION_LIST.find((m) => m.id === id) || null;
}
