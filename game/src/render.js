import * as THREE from 'three';
import { GAME_CONFIG, CITY_CONFIG, PALETTE } from './config.js';
const CITY_HALF = CITY_CONFIG.citySize / 2;
const PITCH = CITY_CONFIG.blockSize + CITY_CONFIG.roadWidth;
let mode = 'webgl';
let canvas = null;
let threeRenderer = null;
let scene = null;
let camera3 = null;
let sun = null;
let hemi = null;
let lampHeadMaterial = null;
let groundTexture = null;
let buildingMaterials = [];
let windowTexture = null;
let sceneBuilt = false;
let cameraMode = 'title';
let frameCount = 0;
let seaMesh = null;
let beaconMesh = null;
let beaconDiamond = null;
let muzzleLight = null;
let boomLight = null;
let boomMesh = null;
let boomLife = 0;
let muzzleLife = 0;
let lastPlayerPos = { x: 0, y: 0, z: 0 };
const POLICE_BAR_COLOUR = 0x2244cc;
const vehicleMeshes = new Map();
const pedMeshes = new Map();
let playerMesh = null;
let ctx2d = null;
function forwardOf(heading) { return { x: Math.sin(heading), z: -Math.cos(heading) };
}
function lerp(a, b, t) { return a + (b - a) * t;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v));
}
function lambert(color) { return new THREE.MeshLambertMaterial({ color });
}
function mesh(geo, mat) { return new THREE.Mesh(geo, mat);
}
function makeWindowTexture() { const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#2a3f4d';
  for (let y = 8; y < 128; y += 16) { for (let x = 8; x < 128; x += 16) { g.fillStyle = (x * 7 + y * 13) % 5 === 0 ? '#ffd98a' : '#2a3f4d';
      g.fillRect(x, y, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function makeGroundTexture() { const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const px = (v) => ((v + 700) / 1400) * size;
  const rw = (CITY_CONFIG.roadWidth / 1400) * size;
  const bw = ((CITY_CONFIG.blockSize - 8) / 1400) * size;
  const lo = px(-CITY_HALF), hi = px(CITY_HALF);
  g.fillStyle = '#5a6a52';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#2f7fb8';
  g.fillRect(0, 0, px(-CITY_HALF - 14), size);
  g.fillStyle = '#e8d9a8';
  g.fillRect(px(-CITY_HALF - 14), 0, lo - px(-CITY_HALF - 14), size);
  g.fillStyle = '#9aa0a3';
  g.fillRect(lo, lo, hi - lo, hi - lo);
  g.fillStyle = '#2f3337';
  for (let i = 0; i <= CITY_CONFIG.blocksX; i++) { const line = -CITY_HALF + i * PITCH;
    g.fillRect(px(line - CITY_CONFIG.roadWidth / 2), lo, rw, hi - lo);
    g.fillRect(lo, px(line - CITY_CONFIG.roadWidth / 2), hi - lo, rw);
  }
  g.fillStyle = '#d8c95a';
  for (let i = 0; i <= CITY_CONFIG.blocksX; i++) { const line = -CITY_HALF + i * PITCH;
    for (let t = -CITY_HALF + 10; t < CITY_HALF - 10; t += 16) { g.fillRect(px(line) - 1, px(t), 2, 6);
      g.fillRect(px(t), px(line) - 1, 6, 2);
    }
  }
  g.fillStyle = '#7d838a';
  for (let bx = 0; bx < CITY_CONFIG.blocksX; bx++) { for (let bz = 0; bz < CITY_CONFIG.blocksZ; bz++) {
      g.fillRect( px(-CITY_HALF + bx * PITCH + CITY_CONFIG.roadWidth / 2 + 4), px(-CITY_HALF + bz * PITCH + CITY_CONFIG.roadWidth / 2 + 4), bw, bw, );
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
function buildScene(world) { scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDay);
  scene.fog = new THREE.Fog(PALETTE.fogDay, 220, 900);
  camera3 = new THREE.PerspectiveCamera( GAME_CONFIG.cameraFov, 16 / 9, 0.1, 2000, );
  sun = new THREE.DirectionalLight(PALETTE.sunDay, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -320;
  sun.shadow.camera.right = 320;
  sun.shadow.camera.top = 320;
  sun.shadow.camera.bottom = -320;
  sun.shadow.camera.far = 900;
  scene.add(sun);
  scene.add(sun.target);
  hemi = new THREE.HemisphereLight(0xbfd9e8, 0x8a7a5a, 0.9);
  scene.add(hemi);
  groundTexture = makeGroundTexture();
  const ground = mesh( new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: groundTexture }), );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  seaMesh = mesh( new THREE.PlaneGeometry(CITY_CONFIG.seaWidth, 1400),
    new THREE.MeshLambertMaterial({ color: PALETTE.sea, transparent: true, opacity: 0.85 }), );
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(-CITY_HALF - CITY_CONFIG.seaWidth / 2, -0.4, 0);
  scene.add(seaMesh);
  windowTexture = makeWindowTexture();
  buildingMaterials = PALETTE.buildingHues.map( (hue) => new THREE.MeshLambertMaterial({ color: hue, map: windowTexture }), );
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const b of world.city.buildings) { const mat = buildingMaterials[b.hue % buildingMaterials.length];
    const building = mesh(unitBox, mat);
    building.scale.set(b.w, b.h, b.d);
    building.position.set(b.x, b.h / 2, b.z);
    building.castShadow = true;
    building.receiveShadow = true;
    scene.add(building);
    if (b.roof === 'garden') { const garden = mesh( new THREE.BoxGeometry(b.w * 0.7, 1.2, b.d * 0.7), lambert(PALETTE.roofGarden), );
      garden.position.set(b.x, b.h + 0.6, b.z);
      scene.add(garden);
    }
  }
  const palms = world.city.props.filter((p) => p.kind === 'palm');
  const lamps = world.city.props.filter((p) => p.kind === 'lamp');
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 5, 6);
  const trunkMat = lambert(PALETTE.palmTrunk);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, palms.length));
  const crownGeo = new THREE.IcosahedronGeometry(1.9, 0);
  const crownMat = lambert(PALETTE.palmCrown);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, palms.length));
  const dummy = new THREE.Object3D();
  palms.forEach((p, i) => { dummy.position.set(p.x, 2.5, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 5.6, p.z);
    dummy.scale.set(1, 0.55, 1);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  scene.add(trunks);
  scene.add(crowns);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const poleMat = lambert(PALETTE.lampPole);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, lamps.length));
  lampHeadMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.lampGlow, emissive: PALETTE.lampGlow, emissiveIntensity: 0, });
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const heads = new THREE.InstancedMesh(headGeo, lampHeadMaterial, Math.max(1, lamps.length));
  lamps.forEach((p, i) => { dummy.position.set(p.x, 3, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 6.1, p.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles);
  scene.add(heads);
  for (const p of world.city.props) { if (p.kind === 'bench') { const bench = mesh( new THREE.BoxGeometry(1.8, 0.5, 0.6), lambert(PALETTE.benchWood), );
      bench.position.set(p.x, 0.45, p.z);
      bench.rotation.y = p.rot;
      scene.add(bench);
    } else if (p.kind === 'hydrant') { const hyd = mesh( new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), lambert(PALETTE.hydrantRed), );
      hyd.position.set(p.x, 0.4, p.z);
      scene.add(hyd);
    }
  }
  beaconMesh = mesh( new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23b, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false, }), );
  beaconMesh.visible = false;
  scene.add(beaconMesh);
  beaconDiamond = mesh( new THREE.OctahedronGeometry(1.4), new THREE.MeshBasicMaterial({ color: 0xffd23b }), );
  beaconDiamond.visible = false;
  scene.add(beaconDiamond);
  muzzleLight = new THREE.PointLight(0xffc36b, 0, 18);
  scene.add(muzzleLight);
  boomLight = new THREE.PointLight(0xff7a2a, 0, 40);
  scene.add(boomLight);
  boomMesh = mesh( new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0 }), );
  scene.add(boomMesh);
  sceneBuilt = true;
}
function makeCarMesh(vehicle) { const group = new THREE.Group();
  const bodyMat = lambert(vehicle.colour);
  const isPolice = vehicle.kind === 'police';
  const body = mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = mesh( new THREE.BoxGeometry(1.7, 0.5, 2.1), lambert(PALETTE.glass), );
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
  const wheelMat = lambert(0x1a1a1a);
  for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) { const wheel = mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.34, wz);
    group.add(wheel);
  }
  if (isPolice) { const bar = mesh( new THREE.BoxGeometry(1.2, 0.18, 0.4), lambert(POLICE_BAR_COLOUR), );
    bar.position.set(0, 1.38, -0.2);
    group.add(bar);
    group.userData.lightBar = bar;
  }
  if (vehicle.health < 30) { const smoke = mesh( new THREE.ConeGeometry(0.7, 2.2, 8),
      new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55 }), );
    smoke.position.set(0, 2.2, 1.2);
    group.add(smoke);
    group.userData.smoke = smoke;
  }
  return group;
}
function makePersonMesh(colour, shirtColour) { const group = new THREE.Group();
  const torso = mesh( new THREE.BoxGeometry(0.55, 0.7, 0.32), lambert(shirtColour), );
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);
  const head = mesh( new THREE.SphereGeometry(0.21, 10, 8), lambert(PALETTE.playerSkin), );
  head.position.y = 1.62;
  group.add(head);
  const legMat = lambert(colour);
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const legL = mesh(legGeo, legMat);
  legL.position.set(-0.14, 0.35, 0);
  const legR = mesh(legGeo, legMat);
  legR.position.set(0.14, 0.35, 0);
  group.add(legL);
  group.add(legR);
  const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  const armMat = lambert(shirtColour);
  const armL = mesh(armGeo, armMat);
  armL.position.set(-0.36, 1.05, 0);
  const armR = mesh(armGeo, armMat);
  armR.position.set(0.36, 1.05, 0);
  group.add(armL);
  group.add(armR);
  group.userData = { legL, legR, armL, armR };
  return group;
}
function syncPool(pool, entities, makeMesh) { const seen = new Set();
  for (const e of entities) { seen.add(e.id);
    let mesh = pool.get(e.id);
    if (!mesh) { mesh = makeMesh(e);
      pool.set(e.id, mesh);
      scene.add(mesh);
    }
    mesh.position.set(e.pos.x, e.pos.y || 0, e.pos.z);
    mesh.rotation.y = e.heading;
  }
  for (const [id, mesh] of pool) { if (!seen.has(id)) { scene.remove(mesh);
      pool.delete(id);
    }
  }
}
function updateSun(world) { const t = clamp((world.timeOfDay - 6) / 12, 0, 1);
  const elevation = Math.sin(t * Math.PI);
  const azimuth = Math.PI * (1 - t);
  const dist = 420;
  sun.position.set( Math.cos(azimuth) * dist, Math.max(40, elevation * dist), Math.sin(azimuth) * dist * 0.6, );
  sun.target.position.set(0, 0, 0);
  const dusk = world.timeOfDay >= GAME_CONFIG.duskHour || world.timeOfDay < 6.5;
  const warm = dusk ? 1 : 0;
  sun.color.setHex(warm ? PALETTE.sunDusk : PALETTE.sunDay);
  sun.intensity = warm ? 1.5 : 2.4;
  scene.background.setHex(warm ? PALETTE.skyDusk : PALETTE.skyDay);
  scene.fog.color.setHex(warm ? 0xe8a06a : PALETTE.fogDay);
  if (lampHeadMaterial) { lampHeadMaterial.emissiveIntensity = warm ? 1.6 : 0;
  }
}
function updateCameraWebGL(world, view) { const p = world.player;
  if (view.mode === 'title' || world.screen === 'title') { const angle = world.clock * 0.045;
    camera3.position.set( Math.cos(angle) * GAME_CONFIG.cameraTitleRadius, GAME_CONFIG.cameraTitleHeight, Math.sin(angle) * GAME_CONFIG.cameraTitleRadius, );
    camera3.lookAt(0, 10, 0);
    return;
  }
  if (view.mode === 'top') { camera3.position.set(p.pos.x, 130, p.pos.z + 0.01);
    camera3.lookAt(p.pos.x, 0, p.pos.z);
    return;
  }
  if (!p.onFoot && view.mode === 'chase') { const v = world.vehicles.find((car) => car.id === p.vehicleId);
    const heading = v ? v.heading : p.heading;
    const vf = forwardOf(heading);
    const speed = v ? Math.abs(v.speed) : 0;
    const dist = GAME_CONFIG.cameraChaseDist + speed * 0.08;
    const tx = p.pos.x;
    const tz = p.pos.z;
    const cx = tx - vf.x * dist;
    const cz = tz - vf.z * dist;
    const gap = Math.hypot(camera3.position.x - cx, camera3.position.z - cz);
    const k = gap > 12 ? 1 : 0.12;
    camera3.position.set( lerp(camera3.position.x, cx, k), GAME_CONFIG.cameraChaseHeight + speed * 0.03, lerp(camera3.position.z, cz, k), );
    camera3.lookAt(tx + vf.x * 6, 1.2, tz + vf.z * 6);
    return;
  }
  const yaw = view.yaw || 0;
  const pitch = clamp(view.pitch || 0, GAME_CONFIG.pitchMin, GAME_CONFIG.pitchMax);
  const cx = Math.sin(yaw) * Math.cos(pitch);
  const cz = Math.cos(yaw) * Math.cos(pitch);
  const cy = Math.sin(pitch);
  const dist = GAME_CONFIG.cameraFootDist;
  camera3.position.set( p.pos.x + cx * dist, p.pos.y + GAME_CONFIG.cameraFootHeight + cy * dist, p.pos.z + cz * dist, );
  camera3.lookAt(p.pos.x, p.pos.y + 1.4, p.pos.z);
}
function updateBeacon(world) { const obj = world.mission.objectives.find((o) => !o.done);
  if (!obj || !obj.target) { beaconMesh.visible = false;
    beaconDiamond.visible = false;
    return;
  }
  beaconMesh.visible = true;
  beaconDiamond.visible = true;
  beaconMesh.position.set(obj.target.x, 30, obj.target.z);
  const bob = Math.sin(frameCount * 0.05) * 1.5;
  beaconDiamond.position.set(obj.target.x, 14 + bob, obj.target.z);
  beaconDiamond.rotation.y = frameCount * 0.03;
}
function renderWebGL(world, view) { if (!sceneBuilt) buildScene(world);
  frameCount++;
  updateSun(world);
  lastPlayerPos = world.player.pos;
  if (!playerMesh) { playerMesh = makePersonMesh(PALETTE.playerTrousers, PALETTE.playerShirt);
    scene.add(playerMesh);
  }
  playerMesh.visible = world.player.onFoot;
  if (world.player.onFoot) { const p = world.player;
    playerMesh.position.set(p.pos.x, p.pos.y || 0, p.pos.z);
    playerMesh.rotation.y = p.heading;
    const swing = Math.abs(p.speed) > 0.3 ? Math.sin(p.walkPhase || 0) * 0.55 : 0;
    const u = playerMesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
  }
  syncPool( vehicleMeshes, world.vehicles, makeCarMesh, );
  for (const v of world.vehicles) { const mesh = vehicleMeshes.get(v.id);
    if (!mesh) continue;
    mesh.rotation.z = clamp(-(v.steer || 0) * 0.06, -0.06, 0.06);
    if (mesh.userData.smoke) { mesh.userData.smoke.material.opacity = 0.35 + 0.2 * Math.sin(frameCount * 0.12);
      mesh.userData.smoke.scale.y = 1 + 0.15 * Math.sin(frameCount * 0.09);
    }
    if (mesh.userData.lightBar) { mesh.userData.lightBar.material.color.setHex( Math.floor(frameCount / 8) % 2 === 0 ? 0xcc2222 : 0x2244cc, );
    }
  }
  syncPool( pedMeshes, world.pedestrians, (ped) => makePersonMesh(ped.colour, ped.shirtColour), );
  for (const ped of world.pedestrians) { const mesh = pedMeshes.get(ped.id);
    if (!mesh) continue;
    const moving = ped.state === 'walk' || ped.state === 'flee';
    const swing = moving ? Math.sin(ped.walkPhase || 0) * 0.5 : 0;
    const u = mesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.7;
    u.armR.rotation.x = swing * 0.7;
  }
  updateBeacon(world);
  if (muzzleLife > 0) { muzzleLife--;
    muzzleLight.intensity = muzzleLife * 0.6;
  } else { muzzleLight.intensity = 0;
  }
  if (boomLife > 0) { boomLife--;
    const t = boomLife / 24;
    boomLight.intensity = t * 8;
    boomMesh.material.opacity = t * 0.8;
    boomMesh.scale.setScalar(1 + (1 - t) * 9);
  } else { boomLight.intensity = 0;
    boomMesh.material.opacity = 0;
  }
  if (muzzleLight.intensity > 0) { muzzleLight.position.set( world.player.pos.x, world.player.pos.y + 1.4, world.player.pos.z, );
  }
  updateCameraWebGL(world, view);
  threeRenderer.render(scene, camera3);
}
function renderCanvas2d(world, view) { if (!ctx2d) ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  frameCount++;
  const w = canvas.width;
  const h = canvas.height;
  const g = ctx2d;
  g.fillStyle = '#20262b';
  g.fillRect(0, 0, w, h);
  const wholeCity = view.mode === 'title' || view.mode === 'top' || world.screen === 'title';
  const scale = wholeCity ? Math.min(w, h) / (CITY_CONFIG.citySize + 80) : Math.min(w, h) / GAME_CONFIG.minimapViewMetres;
  const cx = wholeCity ? 0 : world.player.pos.x;
  const cz = wholeCity ? 0 : world.player.pos.z;
  const toPx = (x, z) => ({ x: w / 2 + (x - cx) * scale, y: h / 2 + (z - cz) * scale, });
  g.fillStyle = '#2f7fb8';
  g.fillRect(0, 0, toPx(-CITY_HALF, 0).x, h);
  g.fillStyle = '#e8d9a8';
  g.fillRect(toPx(-CITY_HALF - 14, 0).x, 0, 14 * scale, h);
  g.fillStyle = '#2f3337';
  for (let i = 0; i <= CITY_CONFIG.blocksX; i++) { const line = -CITY_HALF + i * PITCH;
    const a = toPx(line - CITY_CONFIG.roadWidth / 2, -CITY_HALF);
    g.fillRect(a.x, 0, CITY_CONFIG.roadWidth * scale, h);
    const b = toPx(-CITY_HALF, line - CITY_CONFIG.roadWidth / 2);
    g.fillRect(0, b.y, w, CITY_CONFIG.roadWidth * scale);
  }
  g.fillStyle = '#7d838a';
  for (let bx = 0; bx < CITY_CONFIG.blocksX; bx++) { for (let bz = 0; bz < CITY_CONFIG.blocksZ; bz++) {
      const p = toPx( -CITY_HALF + bx * PITCH + CITY_CONFIG.roadWidth / 2, -CITY_HALF + bz * PITCH + CITY_CONFIG.roadWidth / 2, );
      g.fillRect(p.x, p.y, CITY_CONFIG.blockSize * scale, CITY_CONFIG.blockSize * scale);
    }
  }
  for (const b of world.city.buildings) { const p = toPx(b.x - b.w / 2, b.z - b.d / 2);
    const shadow = Math.min(10, b.h * 0.12) * scale;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(p.x + shadow, p.y + shadow, b.w * scale, b.d * scale);
    g.fillStyle = '#' + b.hue.toString(16).padStart(6, '0');
    g.fillRect(p.x, p.y, b.w * scale, b.d * scale);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(p.x, p.y, b.w * scale, 2);
  }
  for (const prop of world.city.props) { const p = toPx(prop.x, prop.z);
    if (p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) continue;
    g.fillStyle = prop.kind === 'palm' ? '#3d8a3d' : '#ffe9a8';
    g.beginPath();
    g.arc(p.x, p.y, prop.kind === 'palm' ? 3 : 2, 0, Math.PI * 2);
    g.fill();
  }
  function drawEntity(x, z, heading, colour, size, isPlayer) { const p = toPx(x, z);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(heading);
    g.fillStyle = colour;
    if (isPlayer) { g.beginPath();
      g.moveTo(0, -size);
      g.lineTo(size * 0.8, size);
      g.lineTo(-size * 0.8, size);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.stroke();
    } else { g.fillRect(-size / 2, -size, size, size * 2);
      g.fillStyle = '#ffffff';
      g.fillRect(-size / 2, -size, size, 2);
    }
    g.restore();
  }
  for (const v of world.vehicles) { drawEntity(
      v.pos.x, v.pos.z, v.heading, '#' + v.colour.toString(16).padStart(6, '0'), v.kind === 'police' ? 7 : 6, false, );
  }
  for (const ped of world.pedestrians) { drawEntity(ped.pos.x, ped.pos.z, ped.heading, '#e8b88a', 3, false);
  }
  const obj = world.mission.objectives.find((o) => !o.done);
  if (obj && obj.target) { const p = toPx(obj.target.x, obj.target.z);
    const r = 8 + 3 * Math.sin(frameCount * 0.08);
    g.fillStyle = '#ffd23b';
    g.beginPath();
    g.moveTo(p.x, p.y - r);
    g.lineTo(p.x + r, p.y);
    g.lineTo(p.x, p.y + r);
    g.lineTo(p.x - r, p.y);
    g.closePath();
    g.fill();
  }
  drawEntity(world.player.pos.x, world.player.pos.z, world.player.heading, '#ffffff', 9, true);
}
export function createRenderer(canvasEl) { canvas = canvasEl;
  try { threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', });
    const ctx = threeRenderer.getContext();
    if (!ctx || ctx.isContextLost()) throw new Error('WebGL context unavailable');
    threeRenderer.setPixelRatio( Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2), );
    threeRenderer.shadowMap.enabled = true;
    threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault();
      enableFallback();
    });
    mode = 'webgl';
  } catch (err) { if (typeof window !== 'undefined') window.__renderError = String(err && err.stack || err);
    enableFallback();
  }
  if (typeof window !== 'undefined') window.__renderMode = mode;
  return { canvas, mode: getRenderMode() };
}
export function renderWorld(world, view) { const v = view || {};
  if (mode === 'canvas2d') { renderCanvas2d(world, v);
    return;
  }
  try { renderWebGL(world, v);
  } catch (err) { if (typeof window !== 'undefined') window.__renderError = String(err && err.stack || err);
    enableFallback();
    renderCanvas2d(world, v);
  }
}
export function setCameraMode(nextMode) { cameraMode = nextMode;
}
export function resize(width, height) { if (canvas) { canvas.width = width;
    canvas.height = height;
  }
  if (threeRenderer) threeRenderer.setSize(width, height, false);
  if (camera3) { camera3.aspect = width / Math.max(1, height);
    camera3.updateProjectionMatrix();
  }
}
export function flashEffect(name) { if (name === 'muzzle') { muzzleLife = 5;
  } else if (name === 'explosion') { boomLife = 24;
    if (boomMesh) { boomMesh.position.set(lastPlayerPos.x, 1, lastPlayerPos.z);
    }
  } else if (name === 'damage') { muzzleLife = Math.max(muzzleLife, 3);
  }
}
export function getRenderMode() { return mode;
}
export function enableFallback() { if (mode === 'canvas2d') return;
  mode = 'canvas2d';
  if (threeRenderer) { try { threeRenderer.dispose();
    } catch (err) { }
    threeRenderer = null;
  }
  scene = null;
  sceneBuilt = false;
  vehicleMeshes.clear();
  pedMeshes.clear();
  playerMesh = null;
  if (typeof window !== 'undefined') window.__renderMode = 'canvas2d';
}
