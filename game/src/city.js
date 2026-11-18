// city.js — procedural Solmar Bay: 8x8 blocks, roads, buildings, props.
// Generated once at boot from the seed; read-only afterwards. All other
// modules ask this file spatial questions instead of guessing layout.
// Layout: pitch 72 m (60 m block + 12 m road). Road centrelines at
// -288, -216, ..., 288 on both axes; block centres at -246, -174, ..., 258.
// City spans -294..294 on x and z; the sea is visual-only (render.js).
import { CITY_CONFIG } from './config.js';

const PITCH = CITY_CONFIG.pitch;
const HALF = CITY_CONFIG.halfSize;
const ROAD_HALF = CITY_CONFIG.roadWidth / 2;

function roadCentres() {
  const centres = [];
  for (let i = 0; i <= 8; i += 1) centres.push(-HALF + 6 + i * PITCH);
  return centres;
}

function blockCentres() {
  const centres = [];
  for (let i = 0; i < 8; i += 1) centres.push(-HALF + 6 + 12 + 30 + i * PITCH);
  return centres;
}

function nearestCentre(value, centres) {
  let best = centres[0];
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < centres.length; i += 1) {
    const d = Math.abs(value - centres[i]);
    if (d < bestDist) {
      bestDist = d;
      best = centres[i];
    }
  }
  return { centre: best, dist: bestDist };
}

export function buildCity(rng) {
  const blocks = blockCentres();
  const buildings = [];
  const props = [];
  let id = 0;
  let propId = 0;

  const districts = [
    { name: 'Old Solmar', x0: -HALF, z0: -HALF, x1: 0, z1: -98 },
    { name: 'North Hills', x0: 0, z0: -HALF, x1: HALF, z1: -98 },
    { name: 'Marina Quarter', x0: -HALF, z0: -98, x1: 0, z1: 98 },
    { name: 'Palm Row', x0: 0, z0: -98, x1: HALF, z1: 98 },
    { name: 'Harbour Yards', x0: -HALF, z0: 98, x1: 0, z1: HALF },
    { name: 'Market Mile', x0: 0, z0: 98, x1: HALF, z1: HALF },
  ];

  for (let bx = 0; bx < 8; bx += 1) {
    for (let bz = 0; bz < 8; bz += 1) {
      const cx = blocks[bx];
      const cz = blocks[bz];
      const count = rng.nextInt(1, 4);
      const placed = [];
      for (let n = 0; n < count; n += 1) {
        let x = cx;
        let z = cz;
        let w = 18;
        let d = 18;
        let ok = false;
        for (let attempt = 0; attempt < 8 && !ok; attempt += 1) {
          w = rng.range(14, 26);
          d = rng.range(14, 26);
          x = cx + rng.range(-22 + w / 2, 22 - w / 2);
          z = cz + rng.range(-22 + d / 2, 22 - d / 2);
          ok = true;
          for (const other of placed) {
            if (Math.abs(x - other.x) < (w + other.w) / 2 + 4 && Math.abs(z - other.z) < (d + other.d) / 2 + 4) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        const westness = (HALF - x) / (2 * HALF);
        const tall = rng.range(0, 1) < 0.25 + westness * 0.45;
        const h = tall
          ? rng.range(26, CITY_CONFIG.maxBuildingHeight)
          : rng.range(CITY_CONFIG.minBuildingHeight, 26);
        const floors = Math.max(2, Math.round(h / 3.2));
        const building = {
          id: id++,
          blockX: bx,
          blockZ: bz,
          x,
          z,
          w,
          d,
          h,
          hue: rng.pick([0xe8c9a0, 0xd9a08a, 0xa8c4d4, 0xe8e0d0, 0xc4b49a, 0x9fb8a8, 0xd4a8b8]),
          floors,
          roof: rng.chance(0.3) ? 'garden' : 'flat',
        };
        buildings.push(building);
        placed.push(building);
      }
      // Pavement props: a bench or hydrant on some blocks.
      if (rng.chance(0.55)) {
        const edge = rng.pick(['n', 's', 'e', 'w']);
        let px = cx;
        let pz = cz;
        if (edge === 'n') { px = cx + rng.range(-24, 24); pz = cz - 27; }
        if (edge === 's') { px = cx + rng.range(-24, 24); pz = cz + 27; }
        if (edge === 'e') { px = cx + 27; pz = cz + rng.range(-24, 24); }
        if (edge === 'w') { px = cx - 27; pz = cz + rng.range(-24, 24); }
        props.push({ id: propId++, kind: rng.chance(0.5) ? 'bench' : 'hydrant', x: px, z: pz, rot: rng.range(0, Math.PI * 2) });
      }
    }
  }

  // Palms along Palm Row (the east-west avenue at z = 0) and the Marina.
  // Buildings reach at most 22 m from a block centre, so the 27 m pavement
  // ring used here and in randomPedSpot never lands inside a building.
  for (let x = -270; x <= 270; x += 36) {
    props.push({ id: propId++, kind: 'palm', x: x + 4, z: -8, rot: rng.range(0, Math.PI * 2) });
    props.push({ id: propId++, kind: 'palm', x: x - 4, z: 8, rot: rng.range(0, Math.PI * 2) });
  }
  for (let z = -270; z <= 270; z += 48) {
    props.push({ id: propId++, kind: 'palm', x: -282, z, rot: rng.range(0, Math.PI * 2) });
  }
  // Lamps at every intersection.
  const avenues = roadCentres();
  for (const rx of avenues) {
    for (const rz of avenues) {
      props.push({ id: propId++, kind: 'lamp', x: rx + 7, z: rz + 7, rot: 0 });
    }
  }

  return {
    blocksX: CITY_CONFIG.blocksX,
    blocksZ: CITY_CONFIG.blocksZ,
    blockSize: CITY_CONFIG.blockSize,
    roadWidth: CITY_CONFIG.roadWidth,
    buildings,
    props,
    districts,
  };
}

export function getDistrictAt(city, x, z) {
  for (const d of city.districts) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  return 'Solmar Bay';
}

export function isRoad(city, x, z) {
  const centres = roadCentres();
  return nearestCentre(x, centres).dist < ROAD_HALF || nearestCentre(z, centres).dist < ROAD_HALF;
}

export function isOnPavement(city, x, z) {
  if (isRoad(city, x, z)) return false;
  const centres = blockCentres();
  const bx = nearestCentre(x, centres);
  const bz = nearestCentre(z, centres);
  if (bx.dist > 30 || bz.dist > 30) return false;
  const edgeDist = Math.min(30 - bx.dist, 30 - bz.dist);
  return edgeDist < CITY_CONFIG.pavementWidth;
}

export function nearestRoadPoint(city, x, z) {
  const centres = roadCentres();
  const nx = nearestCentre(x, centres);
  const nz = nearestCentre(z, centres);
  if (nx.dist <= nz.dist) return { x: nx.centre, z, heading: z >= 0 ? 0 : Math.PI };
  return { x, z: nz.centre, heading: x >= 0 ? Math.PI / 2 : -Math.PI / 2 };
}

export function collidesBuilding(city, x, z, radius) {
  for (const b of city.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius) return b;
  }
  return null;
}

export function randomParkedSpot(city, rng) {
  const centres = roadCentres();
  const alongRoad = rng.chance(0.5);
  const road = rng.pick(centres);
  const along = rng.range(-HALF + 20, HALF - 20);
  const lane = rng.pick([-3, 3]);
  if (alongRoad) return { x: road + lane, z: along, heading: lane > 0 ? 0 : Math.PI };
  return { x: along, z: road + lane, heading: lane > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

export function randomPedSpot(city, rng) {
  const centres = blockCentres();
  const cx = rng.pick(centres);
  const cz = rng.pick(centres);
  const edge = rng.pick(['n', 's', 'e', 'w']);
  let x = cx;
  let z = cz;
  if (edge === 'n') { x = cx + rng.range(-26, 26); z = cz - 27; }
  if (edge === 's') { x = cx + rng.range(-26, 26); z = cz + 27; }
  if (edge === 'e') { x = cx + 27; z = cz + rng.range(-26, 26); }
  if (edge === 'w') { x = cx - 27; z = cz + rng.range(-26, 26); }
  return { x, z };
}

export function clampToCity(city, x, z) {
  const limit = HALF - 2;
  return {
    x: Math.max(-limit, Math.min(limit, x)),
    z: Math.max(-limit, Math.min(limit, z)),
  };
}
