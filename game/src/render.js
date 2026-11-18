// render.js — the ONLY file that imports three.js. Two backends, one
// interface: WebGL primary, 2D canvas fallback (same functions, same
// signatures). Logic modules never touch three.js or this canvas; render
// only reads world state and draws it. Meshes are pooled by entity id and
// never rebuilt per frame.
import * as THREE from 'three';
import { CITY_CONFIG, PALETTE } from './config.js';

let renderMode = 'webgl';
let fallbackForced = false;
let canvasEl = null;
let renderer = null;
let scene = null;
let camera = null;
let sun = null;
let hemi = null;
let cityBuilt = false;
let cameraMode = 'title';
let flashName = 'none';
let flashAge = 99;
let lastClock = 0;
let muzzleLight = null;
let explosionLight = null;
let flashDiv = null;
let objectiveBeacon = null;
let lampMaterial = null;
let duskApplied = false;

const vehicleMeshes = new Map();
const pedMeshes = new Map();
const buildingMaterials = new Map();
let playerMesh = null;
let seaMesh = null;

function windowTexture(hue) {
  if (buildingMaterials.has(hue)) return buildingMaterials.get(hue);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const hex = '#' + hue.toString(16).padStart(6, '0');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#2a3a48';
  for (let y = 10; y < 120; y += 18) {
    for (let x = 10; x < 120; x += 18) {
      ctx.fillRect(x, y, 10, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  buildingMaterials.set(hue, mat);
  return mat;
}

function makeFlashDiv() {
  if (flashDiv || typeof document === 'undefined') return;
  flashDiv = document.createElement('div');
  flashDiv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:14;opacity:0;background:radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.55) 100%);';
  document.body.appendChild(flashDiv);
}

function buildCityMeshes(world) {
  const city = world.city;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_CONFIG.halfSize * 2 + 240, CITY_CONFIG.halfSize * 2 + 240),
    new THREE.MeshLambertMaterial({ color: 0x6f7a5e })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads: dark strips along every road centreline, both axes.
  const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road });
  const centres = [];
  for (let i = 0; i <= 8; i += 1) centres.push(-CITY_CONFIG.halfSize + 6 + i * CITY_CONFIG.pitch);
  for (const rc of centres) {
    const along = new THREE.Mesh(new THREE.PlaneGeometry(CITY_CONFIG.halfSize * 2, CITY_CONFIG.roadWidth), roadMat);
    along.rotation.x = -Math.PI / 2;
    along.position.set(0, 0.02, rc);
    along.receiveShadow = true;
    scene.add(along);
    const across = new THREE.Mesh(new THREE.PlaneGeometry(CITY_CONFIG.roadWidth, CITY_CONFIG.halfSize * 2), roadMat);
    across.rotation.x = -Math.PI / 2;
    across.position.set(rc, 0.02, 0);
    across.receiveShadow = true;
    scene.add(across);
  }

  // Pavement slabs under each block.
  const paveMat = new THREE.MeshLambertMaterial({ color: PALETTE.pavement });
  for (let bx = 0; bx < 8; bx += 1) {
    for (let bz = 0; bz < 8; bz += 1) {
      const cx = -CITY_CONFIG.halfSize + 48 + bx * CITY_CONFIG.pitch;
      const cz = -CITY_CONFIG.halfSize + 48 + bz * CITY_CONFIG.pitch;
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), paveMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(cx, 0.01, cz);
      slab.receiveShadow = true;
      scene.add(slab);
    }
  }

  for (const b of city.buildings) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), windowTexture(b.hue));
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (b.roof === 'garden') {
      const garden = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.7, 0.6, b.d * 0.7),
        new THREE.MeshLambertMaterial({ color: 0x3a8a4a })
      );
      garden.position.set(b.x, b.h + 0.3, b.z);
      scene.add(garden);
    } else {
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.9, 0.4, b.d * 0.9),
        new THREE.MeshLambertMaterial({ color: 0x5a5a5a })
      );
      rim.position.set(b.x, b.h + 0.2, b.z);
      scene.add(rim);
    }
  }

  lampMaterial = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, emissive: 0x000000 });
  const palmTrunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk });
  const palmLeafMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf });
  for (const p of city.props) {
    if (p.kind === 'lamp') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 6), lampMaterial);
      pole.position.set(p.x, 2.5, p.z);
      scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampMaterial);
      bulb.position.set(p.x, 5.1, p.z);
      scene.add(bulb);
    } else if (p.kind === 'palm') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 6, 6), palmTrunkMat);
      trunk.position.set(p.x, 3, p.z);
      trunk.rotation.z = 0.08;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), palmLeafMat);
      crown.position.set(p.x + 0.4, 6.4, p.z);
      crown.scale.y = 0.55;
      scene.add(crown);
    } else if (p.kind === 'bench') {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.7), new THREE.MeshLambertMaterial({ color: 0x7a5a30 }));
      bench.position.set(p.x, 0.45, p.z);
      bench.rotation.y = p.rot;
      scene.add(bench);
    } else if (p.kind === 'hydrant') {
      const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
      hyd.position.set(p.x, 0.45, p.z);
      scene.add(hyd);
    }
  }

  seaMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(260, CITY_CONFIG.halfSize * 2 + 240),
    new THREE.MeshLambertMaterial({ color: PALETTE.sea })
  );
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(-CITY_CONFIG.halfSize - 130, -0.4, 0);
  scene.add(seaMesh);

  objectiveBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  objectiveBeacon.visible = false;
  scene.add(objectiveBeacon);

  muzzleLight = new THREE.PointLight(0xffc860, 0, 18);
  scene.add(muzzleLight);
  explosionLight = new THREE.PointLight(0xff6a00, 0, 40);
  scene.add(explosionLight);
  cityBuilt = true;
}

function forwardOf(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

function vehicleMeshFor(v) {
  let group = vehicleMeshes.get(v.id);
  if (group) return group;
  group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: v.colour });
  const glassMat = new THREE.MeshLambertMaterial({ color: PALETTE.glass });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, v.kind === 'van' ? 5.2 : 4.4), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, v.kind === 'van' ? 3.4 : 2.2), glassMat);
  cabin.position.set(0, 1.1, v.kind === 'van' ? -0.4 : -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
  }
  if (v.kind === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.4), new THREE.MeshLambertMaterial({ color: 0x2255ff, emissive: 0x1133aa }));
    bar.position.set(0, 1.5, -0.2);
    group.add(bar);
  }
  if (v.kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshLambertMaterial({ color: 0xffe800 }));
    sign.position.set(0, 1.5, -0.2);
    group.add(sign);
  }
  vehicleMeshes.set(v.id, group);
  scene.add(group);
  return group;
}

function pedMeshFor(p) {
  let group = pedMeshes.get(p.id);
  if (group) return group;
  group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: p.shirtColour || 0x888888 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.05, 8), shirt);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a184 }));
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2c3a4a });
  for (const lx of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), legMat);
    leg.position.set(lx, 0.28, 0);
    group.add(leg);
  }
  pedMeshes.set(p.id, group);
  scene.add(group);
  return group;
}

function ensurePlayerMesh() {
  if (playerMesh) return playerMesh;
  playerMesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.05, 8), new THREE.MeshLambertMaterial({ color: PALETTE.playerShirt }));
  body.position.y = 0.95;
  body.castShadow = true;
  playerMesh.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a184 }));
  head.position.y = 1.74;
  playerMesh.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  hair.position.y = 1.82;
  hair.scale.y = 0.6;
  playerMesh.add(hair);
  scene.add(playerMesh);
  return playerMesh;
}

function applyLighting(world) {
  const t = world.timeOfDay;
  const dayFrac = Math.max(0, Math.min(1, (t - 6) / 12));
  const sunAngle = Math.PI * (0.15 + dayFrac * 0.7);
  const dusk = t >= 17 ? Math.min(1, (t - 17) / 2) : 0;
  sun.position.set(Math.cos(sunAngle) * 220, Math.sin(sunAngle) * 180 + 40, 120);
  const warm = new THREE.Color(PALETTE.sun);
  const duskCol = new THREE.Color(PALETTE.sunDusk);
  warm.lerp(duskCol, dusk);
  sun.color.copy(warm);
  sun.intensity = 1.25 - dusk * 0.45;
  hemi.intensity = 0.75 - dusk * 0.2;
  const sky = new THREE.Color(PALETTE.sky);
  sky.lerp(new THREE.Color(PALETTE.skyDusk), dusk);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 320, 900);
  if (lampMaterial) lampMaterial.emissive.setHex(dusk > 0.3 ? 0xffdf80 : 0x000000);
  duskApplied = dusk > 0.3;
}

function renderWebgl(world, cameraState) {
  if (!scene) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(PALETTE.sky);
    camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    sun = new THREE.DirectionalLight(PALETTE.sun, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -320;
    sun.shadow.camera.right = 320;
    sun.shadow.camera.top = 320;
    sun.shadow.camera.bottom = -320;
    scene.add(sun);
    scene.add(sun.target);
    hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a5a, 0.75);
    scene.add(hemi);
  }
  if (!cityBuilt) buildCityMeshes(world);
  applyLighting(world);

  const dt = Math.max(0, world.clock - lastClock);
  lastClock = world.clock;
  flashAge += dt;

  // Player figure.
  const pm = ensurePlayerMesh();
  pm.visible = world.player.onFoot;
  if (world.player.onFoot) {
    pm.position.set(world.player.pos.x, world.player.pos.y, world.player.pos.z);
    pm.rotation.y = world.player.heading;
  }

  // Vehicles, pooled by id; drop meshes for cars that left the world.
  const liveVehicleIds = new Set();
  for (const v of world.vehicles) {
    liveVehicleIds.add(v.id);
    const g = vehicleMeshFor(v);
    g.position.set(v.pos.x, v.pos.y, v.pos.z);
    g.rotation.y = v.heading;
    const smoke = v.health < 30 && v.health > 0;
    // A smoking car shudders slightly; a wrecked one sits low.
    if (smoke) g.position.y = v.pos.y + Math.sin(world.clock * 9 + v.id) * 0.03;
    else if (v.health <= 0) g.position.y = v.pos.y - 0.12;
  }
  for (const [id, g] of vehicleMeshes) {
    if (!liveVehicleIds.has(id)) {
      scene.remove(g);
      vehicleMeshes.delete(id);
    }
  }

  // Pedestrians, pooled by id, with walk-phase swing.
  const livePedIds = new Set();
  for (const p of world.pedestrians) {
    livePedIds.add(p.id);
    const g = pedMeshFor(p);
    g.position.set(p.pos.x, p.pos.y, p.pos.z);
    g.rotation.y = p.heading;
    const swing = p.state === 'walk' || p.state === 'flee' ? Math.sin(p.walkPhase) * 0.35 : 0;
    if (g.children[2]) g.children[2].rotation.x = swing;
    if (g.children[3]) g.children[3].rotation.x = -swing;
  }
  for (const [id, g] of pedMeshes) {
    if (!livePedIds.has(id)) {
      scene.remove(g);
      pedMeshes.delete(id);
    }
  }

  // Objective beacon over the current objective target.
  const obj = world.mission && world.mission.objectives && world.mission.objectives[world.mission.stage];
  if (objectiveBeacon) {
    if (obj && !obj.done && obj.target) {
      objectiveBeacon.visible = true;
      objectiveBeacon.position.set(obj.target.x, 13, obj.target.z);
      const pulse = 1 + Math.sin(world.clock * 4) * 0.12;
      objectiveBeacon.scale.set(pulse, 1, pulse);
      objectiveBeacon.material.opacity = 0.28 + Math.sin(world.clock * 4) * 0.08;
    } else {
      objectiveBeacon.visible = false;
    }
  }

  // Flash lights decay with sim time.
  if (muzzleLight) {
    muzzleLight.intensity = flashName === 'muzzle' && flashAge < 0.08 ? 26 : 0;
    if (flashName === 'muzzle') muzzleLight.position.set(world.player.pos.x, world.player.pos.y + 1.5, world.player.pos.z);
  }
  if (explosionLight) {
    explosionLight.intensity = flashName === 'explosion' && flashAge < 0.5 ? 40 * (1 - flashAge * 2) : 0;
    if (flashName === 'explosion') explosionLight.position.set(world.player.pos.x, world.player.pos.y + 2, world.player.pos.z);
  }
  if (flashDiv) {
    const show = (flashName === 'damage' && flashAge < 0.3) || (flashName === 'explosion' && flashAge < 0.4);
    flashDiv.style.opacity = show ? String(1 - flashAge * 2.5) : '0';
    flashDiv.style.background = flashName === 'explosion'
      ? 'radial-gradient(ellipse at center, rgba(255,140,0,0.35) 0%, rgba(255,60,0,0.25) 60%, transparent 100%)'
      : 'radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.55) 100%)';
  }

  // Cameras (frozen framings).
  const p = world.player.pos;
  if (cameraMode === 'title') {
    const a = world.clock * 0.05;
    camera.position.set(Math.cos(a) * 190, 40, Math.sin(a) * 190);
    camera.lookAt(0, 0, 0);
  } else if (cameraMode === 'top') {
    camera.position.set(p.x, 70, p.z + 0.01);
    camera.lookAt(p.x, 0, p.z);
  } else if (cameraMode === 'chase' || !world.player.onFoot) {
    const f = forwardOf(world.player.heading);
    const behind = 7 + Math.min(4, Math.abs(world.player.speed) * 0.08);
    camera.position.set(p.x - f.x * behind, p.y + 3, p.z - f.z * behind);
    camera.lookAt(p.x + f.x * 10, p.y + 1, p.z + f.z * 10);
  } else {
    const f = forwardOf(cameraState.yaw);
    const pitch = cameraState.pitch || 0.35;
    camera.position.set(p.x - f.x * 3.2, p.y + 1.6 + pitch * 1.2, p.z - f.z * 3.2);
    camera.lookAt(p.x + f.x * 4, p.y + 1.2 - pitch * 1.5, p.z + f.z * 4);
  }
  camera.fov = 62;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function renderCanvas2d(world, cameraState) {
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const w = canvasEl.width;
  const h = canvasEl.height;
  const dusk = world.timeOfDay >= 17;
  ctx.fillStyle = dusk ? '#e88a4a' : '#87bfe8';
  ctx.fillRect(0, 0, w, h);
  const span = CITY_CONFIG.halfSize * 2 + 40;
  const scale = Math.min(w, h) / span;
  const ox = w / 2;
  const oy = h / 2;
  const px = (x) => ox + x * scale;
  const pz = (z) => oy + z * scale;
  // Sea strip on the west edge.
  ctx.fillStyle = '#2a7fa8';
  ctx.fillRect(0, 0, px(-CITY_CONFIG.halfSize) - 0, h);
  // Ground, roads, blocks.
  ctx.fillStyle = '#6f7a5e';
  ctx.fillRect(px(-294), pz(-294), 588 * scale, 588 * scale);
  ctx.fillStyle = '#3a3d42';
  for (let i = 0; i <= 8; i += 1) {
    const rc = -288 + i * 72;
    ctx.fillRect(px(-294), pz(rc - 6), 588 * scale, 12 * scale);
    ctx.fillRect(px(rc - 6), pz(-294), 12 * scale, 588 * scale);
  }
  ctx.fillStyle = '#9a938a';
  for (let bx = 0; bx < 8; bx += 1) {
    for (let bz = 0; bz < 8; bz += 1) {
      const cx = -246 + bx * 72;
      const cz = -246 + bz * 72;
      ctx.fillRect(px(cx - 30), pz(cz - 30), 60 * scale, 60 * scale);
    }
  }
  // Buildings as shaded rectangles with a height shadow offset.
  for (const b of world.city.buildings) {
    const sh = b.h * 0.12 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px(b.x - b.w / 2) + sh, pz(b.z - b.d / 2) + sh, b.w * scale, b.d * scale);
    ctx.fillStyle = '#' + b.hue.toString(16).padStart(6, '0');
    ctx.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scale, b.d * scale);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scale, 2);
  }
  // Objective blip.
  const obj = world.mission && world.mission.objectives && world.mission.objectives[world.mission.stage];
  if (obj && !obj.done && obj.target) {
    const pulse = 6 + Math.sin(world.clock * 4) * 2;
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.moveTo(px(obj.target.x), pz(obj.target.z) - pulse);
    ctx.lineTo(px(obj.target.x) + pulse, pz(obj.target.z));
    ctx.lineTo(px(obj.target.x), pz(obj.target.z) + pulse);
    ctx.lineTo(px(obj.target.x) - pulse, pz(obj.target.z));
    ctx.closePath();
    ctx.fill();
  }
  // Vehicles as coloured rectangles with a heading tick.
  for (const v of world.vehicles) {
    ctx.save();
    ctx.translate(px(v.pos.x), pz(v.pos.z));
    ctx.rotate(-v.heading);
    ctx.fillStyle = '#' + v.colour.toString(16).padStart(6, '0');
    ctx.fillRect(-2.2 * scale, -1 * scale, 4.4 * scale, 2 * scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -0.4 * scale, 2.2 * scale, 0.8 * scale);
    ctx.restore();
  }
  // Pedestrians as dots.
  for (const p of world.pedestrians) {
    ctx.fillStyle = p.state === 'flee' ? '#ff6a5a' : '#e8e8e8';
    ctx.beginPath();
    ctx.arc(px(p.pos.x), pz(p.pos.z), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  ctx.save();
  ctx.translate(px(world.player.pos.x), pz(world.player.pos.z));
  ctx.rotate(-world.player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(-4.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Flash overlay for the fallback.
  const dt = Math.max(0, world.clock - lastClock);
  lastClock = world.clock;
  flashAge += dt;
  if (flashName === 'damage' && flashAge < 0.3) {
    ctx.fillStyle = 'rgba(255,0,0,' + String(0.3 * (1 - flashAge * 3)) + ')';
    ctx.fillRect(0, 0, w, h);
  }
  void cameraState;
}

export function createRenderer(canvas) {
  canvasEl = canvas;
  makeFlashDiv();
  if (fallbackForced) {
    renderMode = 'canvas2d';
    if (typeof window !== 'undefined') window.__renderMode = 'canvas2d';
    return { canvas, mode: 'canvas2d' };
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const ctx = renderer.getContext();
    if (!ctx || ctx.isContextLost()) throw new Error('no webgl context');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
    renderMode = 'webgl';
    if (typeof window !== 'undefined') window.__renderMode = 'webgl';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      enableFallback();
    });
  } catch (err) {
    renderMode = 'canvas2d';
    if (typeof window !== 'undefined') window.__renderMode = 'canvas2d';
  }
  return { canvas, mode: renderMode };
}

export function renderWorld(world, cameraState) {
  if (!canvasEl) return;
  if (renderMode === 'canvas2d') {
    renderCanvas2d(world, cameraState);
    return;
  }
  try {
    renderWebgl(world, cameraState);
  } catch (err) {
    enableFallback();
    renderCanvas2d(world, cameraState);
  }
}

export function setCameraMode(mode) {
  if (mode === 'foot' || mode === 'chase' || mode === 'title' || mode === 'top') cameraMode = mode;
}

export function resize(width, height) {
  if (!canvasEl) return;
  canvasEl.width = width;
  canvasEl.height = height;
  if (renderer && renderMode === 'webgl') {
    renderer.setSize(width, height, false);
    if (camera) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }
  }
}

export function flashEffect(name) {
  flashName = name;
  flashAge = 0;
}

export function getRenderMode() {
  return renderMode;
}

export function enableFallback() {
  if (renderMode === 'canvas2d') return;
  renderMode = 'canvas2d';
  fallbackForced = true;
  if (typeof window !== 'undefined') window.__renderMode = 'canvas2d';
  if (renderer) {
    try { renderer.dispose(); } catch (err) { /* already gone */ }
    renderer = null;
  }
}

export function forceFallbackForTests() {
  fallbackForced = true;
}
