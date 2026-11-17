import { CITY_CONFIG, PALETTE } from './config.js';
const PITCH = CITY_CONFIG.blockSize + CITY_CONFIG.roadWidth;
const HALF = CITY_CONFIG.citySize / 2;
const ROAD_HALF = CITY_CONFIG.roadWidth / 2;
function gridLine(index) { return -HALF + index * PITCH;
}
function mod(a, n) { return ((a % n) + n) % n;
}
const DISTRICT_RECTS = [ { name: 'Marina Quarter', x0: -HALF, z0: -HALF, x1: -108, z1: -36 }, { name: 'Old Solmar', x0: -108, z0: -HALF, x1: 108, z1: -36 },
  { name: 'North Hills', x0: 108, z0: -HALF, x1: HALF, z1: -36 }, { name: 'Palm Row', x0: -HALF, z0: -36, x1: 36, z1: 180 },
  { name: 'Market Mile', x0: 36, z0: -36, x1: HALF, z1: 180 }, { name: 'Harbour Yards', x0: -HALF, z0: 180, x1: HALF, z1: HALF }, ];
function districtNameAt(x, z) { for (const d of DISTRICT_RECTS) { if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  return 'Solmar Bay';
}
function buildBlockBuildings(rng, bx, bz, idStart) { const bx0 = gridLine(bx) + ROAD_HALF;
  const bz0 = gridLine(bz) + ROAD_HALF;
  const bx1 = gridLine(bx + 1) - ROAD_HALF;
  const bz1 = gridLine(bz + 1) - ROAD_HALF;
  const out = [];
  const count = rng.nextInt( CITY_CONFIG.buildingsPerBlockMin, CITY_CONFIG.buildingsPerBlockMax + 1, );
  const centreX = (bx0 + bx1) / 2;
  const marinaFactor = 1 - (centreX + HALF) / CITY_CONFIG.citySize;
  let id = idStart;
  for (let i = 0; i < count; i++) { const w = rng.range(14, 30);
    const d = rng.range(14, 30);
    const margin = 4;
    const x = rng.range(bx0 + margin + w / 2, bx1 - margin - w / 2);
    const z = rng.range(bz0 + margin + d / 2, bz1 - margin - d / 2);
    const h = CITY_CONFIG.buildingMinHeight + rng.range(0, 1) * (CITY_CONFIG.buildingMaxHeight - CITY_CONFIG.buildingMinHeight) *
        (0.55 + 0.45 * marinaFactor) + marinaFactor * CITY_CONFIG.marinaHeightBonus * rng.range(0, 0.6);
    out.push({ id: id++, blockX: bx, blockZ: bz, x, z, w, d, h: Math.round(Math.min(h, CITY_CONFIG.buildingMaxHeight + 8)), hue: rng.pick(PALETTE.buildingHues),
      floors: Math.max(2, Math.round(h / 3)), roof: rng.chance(0.25) ? 'garden' : 'flat', });
  }
  return out;
}
function buildProps(rng, buildings) { const props = [];
  let id = 0;
  const add = (kind, x, z, rot) => props.push({ id: id++, kind, x, z, rot: rot || 0 });
  function clearPedSpot() { for (let tries = 0; tries < 6; tries++) { const spot = randomPedSpotRaw(rng);
      const hit = buildings.some( (b) => Math.abs(spot.x - b.x) < b.w / 2 + 0.5 && Math.abs(spot.z - b.z) < b.d / 2 + 0.5, );
      if (!hit) return spot;
    }
    return randomPedSpotRaw(rng);
  }
  const avenueX = gridLine(4);
  for (let z = -HALF + 20; z < HALF - 10; z += CITY_CONFIG.palmSpacing) {
    const onCrossRoad = mod(z + HALF, PITCH) < CITY_CONFIG.roadWidth + 2 || mod(z + HALF, PITCH) > PITCH - 2;
    if (onCrossRoad) continue;
    for (const side of [-1, 1]) { add('palm', avenueX + side * (ROAD_HALF + 1.5), z + rng.range(-2, 2), rng.range(0, Math.PI * 2));
    }
  }
  for (let ix = 0; ix <= CITY_CONFIG.blocksX; ix++) { for (let iz = 0; iz <= CITY_CONFIG.blocksZ; iz++) {
      add('lamp', gridLine(ix) + ROAD_HALF + 0.8, gridLine(iz) + ROAD_HALF + 0.8);
    }
  }
  for (let i = 0; i < CITY_CONFIG.propBenchCount; i++) { const spot = clearPedSpot();
    add('bench', spot.x, spot.z, rng.range(0, Math.PI * 2));
  }
  for (let i = 0; i < CITY_CONFIG.propHydrantCount; i++) { const spot = clearPedSpot();
    add('hydrant', spot.x, spot.z, rng.range(0, Math.PI * 2));
  }
  return props;
}
function randomPedSpotRaw(rng) { const bx = rng.nextInt(0, CITY_CONFIG.blocksX);
  const bz = rng.nextInt(0, CITY_CONFIG.blocksZ);
  const bx0 = gridLine(bx) + ROAD_HALF;
  const bz0 = gridLine(bz) + ROAD_HALF;
  const bx1 = gridLine(bx + 1) - ROAD_HALF;
  const bz1 = gridLine(bz + 1) - ROAD_HALF;
  const inset = rng.range(1.2, CITY_CONFIG.pavementWidth - 0.5);
  const edge = rng.nextInt(0, 4);
  if (edge === 0) return { x: rng.range(bx0 + 2, bx1 - 2), z: bz0 + inset };
  if (edge === 1) return { x: rng.range(bx0 + 2, bx1 - 2), z: bz1 - inset };
  if (edge === 2) return { x: bx0 + inset, z: rng.range(bz0 + 2, bz1 - 2) };
  return { x: bx1 - inset, z: rng.range(bz0 + 2, bz1 - 2) };
}
export function buildCity(rng) { const buildings = [];
  let nextId = 0;
  for (let bx = 0; bx < CITY_CONFIG.blocksX; bx++) { for (let bz = 0; bz < CITY_CONFIG.blocksZ; bz++) { const made = buildBlockBuildings(rng, bx, bz, nextId);
      nextId += made.length;
      buildings.push(...made);
    }
  }
  const props = buildProps(rng, buildings);
  const districts = DISTRICT_RECTS.map((d) => ({ ...d }));
  return { blocksX: CITY_CONFIG.blocksX, blocksZ: CITY_CONFIG.blocksZ, blockSize: CITY_CONFIG.blockSize,
    roadWidth: CITY_CONFIG.roadWidth, buildings, props, districts, };
}
export function getDistrictAt(city, x, z) { return districtNameAt(x, z);
}
export function isRoad(city, x, z) { const lx = mod(x + HALF, PITCH);
  const lz = mod(z + HALF, PITCH);
  return ( lx < ROAD_HALF || lx > PITCH - ROAD_HALF || lz < ROAD_HALF || lz > PITCH - ROAD_HALF
  );
}
export function isOnPavement(city, x, z) { if (isRoad(city, x, z)) return false;
  const bx = Math.floor((x + HALF) / PITCH);
  const bz = Math.floor((z + HALF) / PITCH);
  if (bx < 0 || bx >= city.blocksX || bz < 0 || bz >= city.blocksZ) return false;
  const lx = mod(x + HALF, PITCH) - ROAD_HALF;
  const lz = mod(z + HALF, PITCH) - ROAD_HALF;
  const pw = CITY_CONFIG.pavementWidth;
  return lx < pw || lx > CITY_CONFIG.blockSize - pw || lz < pw || lz > CITY_CONFIG.blockSize - pw;
}
export function nearestRoadPoint(city, x, z) { const kx = Math.round((x + HALF) / PITCH);
  const kz = Math.round((z + HALF) / PITCH);
  const lineX = gridLine(Math.max(0, Math.min(CITY_CONFIG.blocksX, kx)));
  const lineZ = gridLine(Math.max(0, Math.min(CITY_CONFIG.blocksZ, kz)));
  const dx = Math.abs(x - lineX);
  const dz = Math.abs(z - lineZ);
  if (dx <= dz) { return { x: lineX, z, heading: 0 };
  }
  return { x, z: lineZ, heading: Math.PI / 2 };
}
export function collidesBuilding(city, x, z, radius) { for (const b of city.buildings) {
    if ( Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius
    ) { return b;
    }
  }
  return null;
}
export function randomParkedSpot(city, rng) { const northSouth = rng.chance(0.5);
  const lineIndex = rng.nextInt(1, CITY_CONFIG.blocksX);
  const along = rng.range(-HALF + 30, HALF - 30);
  const side = rng.chance(0.5) ? 1 : -1;
  const kerb = ROAD_HALF - 2.2;
  if (northSouth) { const heading = side > 0 ? 0 : Math.PI;
    return { x: gridLine(lineIndex) + side * kerb, z: along, heading };
  }
  const heading = side > 0 ? Math.PI / 2 : (3 * Math.PI) / 2;
  return { x: along, z: gridLine(lineIndex) + side * kerb, heading };
}
export function randomPedSpot(city, rng) { for (let tries = 0; tries < 6; tries++) { const spot = randomPedSpotRaw(rng);
    if (!collidesBuilding(city, spot.x, spot.z, 0.5)) return spot;
  }
  return randomPedSpotRaw(rng);
}
export function clampToCity(city, x, z) { const limit = HALF - 2;
  return { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)), };
}
