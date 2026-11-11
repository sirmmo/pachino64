// Capitan Pachino 64 — a 3D garden platformer.
// Vegetables are friends, steaks and fish are enemies. Collect the 7 Golden Stars.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { initAudio, sfx, startMusic, toggleMute } from './audio.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const GRAV = 34, MAX_FALL = 32, RUN = 9.5, STEP = 0.4;
const SEA = -1.0;
const POND = { x: 38, z: 8, r: 14, level: -0.6 };
const SPAWN = new THREE.Vector3(0, 0, 52);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
let seed = 1234567; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Renderer, scene, sky, lights
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xcfe9ff);
scene.fog = new THREE.Fog(HORIZON, 90, 300);
const camera = new THREE.PerspectiveCamera(window.innerWidth < window.innerHeight ? 72 : 55, window.innerWidth / window.innerHeight, 0.1, 900);

{ // gradient sky dome
  const g = new THREE.SphereGeometry(600, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3a8cf0) }, bottom: { value: HORIZON } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0); }',
  });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -1; scene.add(sky);
  scene.userData.sky = sky;
}
const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x5d7a3a, 1.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// ---------------------------------------------------------------------------
// Procedural textures (N64-ish crunchy noise)
// ---------------------------------------------------------------------------
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; return t;
}
function speckle(g, s, base, vars, n) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) { g.fillStyle = vars[(rand() * vars.length) | 0]; const w = 1 + rand() * 3; g.fillRect(rand() * s, rand() * s, w, w); }
}
const texGrass = canvasTex(64, (g, s) => speckle(g, s, '#e8f0d8', ['#c8d8b0', '#f8fff0', '#d0e0b8', '#b8cca0'], 500));
const texGrassTop = canvasTex(64, (g, s) => speckle(g, s, '#5fbf4a', ['#4fa83c', '#72d058', '#56b043', '#80d860'], 600));
const texDirt = canvasTex(64, (g, s) => {
  speckle(g, s, '#b07440', ['#9a6234', '#c08450', '#8a5630'], 300);
  for (let y = 0; y < s; y += 16) { g.fillStyle = 'rgba(80,40,20,0.35)'; g.fillRect(0, y + 12, s, 3); }
});
const texWater = canvasTex(128, (g, s) => {
  g.fillStyle = '#2f9be0'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
  for (let i = 0; i < 26; i++) { const x = rand() * s, y = rand() * s, w = 6 + rand() * 14; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke(); }
});
const texStone = canvasTex(64, (g, s) => speckle(g, s, '#c9c2b8', ['#b0a89c', '#dad4cc', '#a49c90'], 400));

const matGrassTop = new THREE.MeshLambertMaterial({ map: texGrassTop });
const matDirt = new THREE.MeshLambertMaterial({ map: texDirt });
const matStone = new THREE.MeshLambertMaterial({ map: texStone });

// ---------------------------------------------------------------------------
// World: heightfield, solids, water
// ---------------------------------------------------------------------------
function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = r < 70 ? 0 : r < 84 ? -3.4 * smoothstep(70, 84, r) : -3.4;
  // gentle rolling hills (faded out near the beach)
  h += 0.35 * Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11) * (1 - smoothstep(55, 68, r));
  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.r + 2) h = Math.min(h, lerp(h, -3, smoothstep(POND.r, POND.r - 7, dp)));
  return h;
}
function waterLevelAt(x, z) {
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r) return POND.level;
  if (Math.hypot(x, z) > 69) return SEA;
  return null;
}

const solids = [];   // {min:{x,y,z}, max:{x,y,z}, ramp?, kind?, ref?}
function addSolid(min, max, extra = {}) { const s = { min: { ...min }, max: { ...max }, ...extra }; solids.push(s); return s; }
function removeSolid(s) { const i = solids.indexOf(s); if (i >= 0) solids.splice(i, 1); }
function topAt(s, x, z) {
  if (!s.ramp) return s.max.y;
  const r = s.ramp;
  let t = r.axis === 'x' ? (x - s.min.x) / (s.max.x - s.min.x) : (z - s.min.z) / (s.max.z - s.min.z);
  t = clamp(t, 0, 1); if (r.dir < 0) t = 1 - t;
  return lerp(r.lo, s.max.y, t);
}

// Heightfield mesh with vertex colors
{
  const size = 220, seg = 176;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv; const col = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x63c24c), cGrass2 = new THREE.Color(0x4fae3e), cSand = new THREE.Color(0xf3dc95), cWet = new THREE.Color(0xc7a86a), cMud = new THREE.Color(0x7c8f5a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = groundHeight(x, z); pos.setY(i, h);
    uv.setXY(i, x / 3, z / 3);
    const r = Math.hypot(x, z), dp = Math.hypot(x - POND.x, z - POND.z);
    c.copy(cGrass).lerp(cGrass2, 0.5 + 0.5 * Math.sin(x * 0.31) * Math.sin(z * 0.27));
    if (r > 67) c.lerp(cSand, smoothstep(67, 71, r));
    if (r > 75) c.lerp(cWet, smoothstep(75, 82, r));
    if (dp < POND.r + 1) c.lerp(dp < POND.r - 1 ? cWet : cSand, smoothstep(POND.r + 1, POND.r - 1, dp));
    if (dp < POND.r - 6) c.lerp(cMud, 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texGrass, vertexColors: true }));
  m.receiveShadow = true; scene.add(m);
}
// Water surfaces
const waterMat = new THREE.MeshLambertMaterial({ map: texWater, transparent: true, opacity: 0.78, depthWrite: false });
{
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), waterMat); sea.rotation.x = -Math.PI / 2; sea.position.y = SEA;
  texWater.repeat.set(1, 1);
  const seaGeoUV = sea.geometry.attributes.uv; for (let i = 0; i < seaGeoUV.count; i++) seaGeoUV.setXY(i, seaGeoUV.getX(i) * 140, seaGeoUV.getY(i) * 140);
  scene.add(sea);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.5, 48), waterMat); pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, POND.level, POND.z);
  const pu = pond.geometry.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * 3, pu.getY(i) * 3);
  scene.add(pond);
}

// Terrain box with grass top + dirt sides (+ a little grass lip)
function worldUVBox(w, h, d, cx, cy, cz, sc = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx, y = p.getY(i) + cy, z = p.getZ(i) + cz;
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, x * sc, z * sc);
    else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, z * sc, y * sc);
    else uv.setXY(i, x * sc, y * sc);
  }
  return g;
}
function terrainBox(x0, x1, y0, y1, z0, z1, { mat = 'grass' } = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const mats = mat === 'stone' ? matStone : [matDirt, matDirt, matGrassTop, matDirt, matDirt, matDirt];
  const m = new THREE.Mesh(worldUVBox(w, h, d, cx, cy, cz), mats);
  m.position.set(cx, cy, cz); m.castShadow = m.receiveShadow = true; scene.add(m);
  if (mat === 'grass') {
    const lip = new THREE.Mesh(worldUVBox(w + 0.16, 0.3, d + 0.16, cx, y1 - 0.15, cz), matGrassTop);
    lip.position.set(cx, y1 - 0.15, cz); lip.receiveShadow = true; scene.add(lip);
  }
  return addSolid({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, { mesh: m });
}
// Ramp: rises along axis toward dir (+1/-1) from lo to hi
function ramp(x0, x1, z0, z1, base, lo, hi, axis, dir) {
  const shape = new THREE.Shape();
  const len = axis === 'x' ? x1 - x0 : z1 - z0, wid = axis === 'x' ? z1 - z0 : x1 - x0;
  shape.moveTo(0, base); shape.lineTo(len, base); shape.lineTo(len, hi); shape.lineTo(0, lo); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false });
  // shape x -> along axis, shape y -> height, extrude z -> width
  const p = g.attributes.position; const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let a = p.getX(i), y = p.getY(i), w = p.getZ(i);
    if (dir < 0) a = len - a;
    let x, z;
    if (axis === 'x') { x = x0 + a; z = z0 + w; } else { z = z0 + a; x = x0 + w; }
    p.setXYZ(i, x, y, z); uv.setXY(i, (x + z) * 0.25, y * 0.25 + (x - z) * 0.1);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, matGrassTop); m.castShadow = m.receiveShadow = true;
  // ExtrudeGeometry may flip winding after mirroring; render both sides
  m.material = matGrassTop.clone(); m.material.side = THREE.DoubleSide;
  scene.add(m);
  return addSolid({ x: x0, y: base, z: z0 }, { x: x1, y: hi, z: z1 }, { ramp: { axis, dir, lo } });
}

// ---------------------------------------------------------------------------
// Collision core: vertical cylinders vs AABBs/ramps + heightfield
// ---------------------------------------------------------------------------
function floorAt(x, z, y, r) {
  let best = groundHeight(x, z), bs = null; const rr = r * 0.6;
  for (const s of solids) {
    if (s.noFloor) continue;
    if (x + rr < s.min.x || x - rr > s.max.x || z + rr < s.min.z || z - rr > s.max.z) continue;
    const t = topAt(s, clamp(x, s.min.x, s.max.x), clamp(z, s.min.z, s.max.z));
    if (t <= y + STEP && t > best) { best = t; bs = s; }
  }
  return { y: best, solid: bs };
}
function collideH(b) {
  b.wallN = null;
  for (let iter = 0; iter < 2; iter++) {
    for (const s of solids) {
      if (b.pos.y + b.h <= s.min.y + 0.01) continue;
      const cx = clamp(b.pos.x, s.min.x, s.max.x), cz = clamp(b.pos.z, s.min.z, s.max.z);
      let dx = b.pos.x - cx, dz = b.pos.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= b.r * b.r) continue;
      if (topAt(s, cx, cz) <= b.pos.y + STEP) continue;
      let nx, nz, pen;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = b.r - d; }
      else {
        const opts = [[s.max.x - b.pos.x, 1, 0], [b.pos.x - s.min.x, -1, 0], [s.max.z - b.pos.z, 0, 1], [b.pos.z - s.min.z, 0, -1]];
        opts.sort((a, c) => a[0] - c[0]); [pen, nx, nz] = opts[0]; pen += b.r;
      }
      b.pos.x += nx * pen; b.pos.z += nz * pen;
      const vn = b.vel.x * nx + b.vel.z * nz; if (vn < 0) { b.vel.x -= vn * nx; b.vel.z -= vn * nz; b.wallSpeed = -vn; }
      b.wallN = { x: nx, z: nz }; if (s.onTouch) s.onTouch(b);
    }
  }
}
function moveBody(b, dt) {
  b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt;
  collideH(b);
  const prevY = b.pos.y; b.pos.y += b.vel.y * dt; b.bonk = false;
  if (b.vel.y > 0) {
    for (const s of solids) {
      if (b.pos.x + b.r * 0.7 < s.min.x || b.pos.x - b.r * 0.7 > s.max.x || b.pos.z + b.r * 0.7 < s.min.z || b.pos.z - b.r * 0.7 > s.max.z) continue;
      if (s.min.y >= prevY + b.h - 0.05 && b.pos.y + b.h > s.min.y) { b.pos.y = s.min.y - b.h; b.vel.y = 0; b.bonk = s; }
    }
  }
  const f = floorAt(b.pos.x, b.pos.z, Math.max(prevY, b.pos.y), b.r);
  const snap = b.onGround ? 0.45 : 0;
  b.floorY = f.y;
  if (b.vel.y <= 0 && b.pos.y <= f.y + snap) {
    const landed = !b.onGround; b.pos.y = f.y; b.landVel = landed ? b.vel.y : 0; b.vel.y = 0; b.onGround = true; b.ground = f.solid; b.justLanded = landed;
  } else { b.onGround = false; b.ground = null; b.justLanded = false; }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
const models = {};
const FOOD = ['carrot', 'tomato', 'broccoli', 'eggplant', 'paprika', 'cabbage', 'corn', 'mushroom', 'onion', 'pumpkin', 'leek', 'radish', 'beet', 'cauliflower', 'meat-raw', 'meat-cooked', 'fish', 'fish-bones'];
const PLAT = ['tree', 'tree-pine', 'coin-gold', 'star', 'heart', 'spring', 'flag', 'platform', 'block-moving', 'block-moving-blue', 'crate', 'crate-item', 'rocks', 'fence-straight', 'flowers', 'flowers-tall', 'grass', 'hedge', 'mushrooms', 'plant', 'sign', 'stones', 'barrel', 'chest', 'pipe', 'poles'];
function loadGLB(url) { return new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej)); }
async function loadAll() {
  const jobs = [];
  for (const n of FOOD) jobs.push(loadGLB(`models/food/${n}.glb`).then((s) => (models[n] = s)));
  for (const n of PLAT) jobs.push(loadGLB(`models/platformer/${n}.glb`).then((s) => (models[n] = s)));
  jobs.push(loadGLB('models/pachino.glb').then((s) => (models.pachino = s)));
  await Promise.all(jobs);
}
function inst(name, scale = 1, shadow = true) {
  const o = models[name].clone(true);
  o.scale.setScalar(scale);
  o.traverse((c) => { if (c.isMesh) { c.castShadow = shadow; c.receiveShadow = true; } });
  return o;
}
function place(name, x, y, z, { s = 1, r = 0, solid = false, shrink = 0 } = {}) {
  const o = inst(name, s); o.position.set(x, y, z); o.rotation.y = r; scene.add(o);
  if (solid) {
    o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o);
    const sd = addSolid({ x: b.min.x + shrink, y: b.min.y, z: b.min.z + shrink }, { x: b.max.x - shrink, y: b.max.y, z: b.max.z - shrink }, { mesh: o });
    o.userData.solid = sd;
  }
  return o;
}

// Googly eyes, placed by raycasting the model's front surface
const eyeWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
const eyeBlack = new THREE.MeshBasicMaterial({ color: 0x111111 });
const eyeGeo = new THREE.SphereGeometry(1, 12, 8);
function addEyes(obj, { hf = 0.62, spread = 0.22, size = 0.11, angry = false } = {}) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const rc = new THREE.Raycaster(); const meshes = []; obj.traverse((c) => c.isMesh && meshes.push(c));
  const er = size * Math.min(sz.y, Math.max(sz.x, sz.z) * 1.4);
  for (const side of [-1, 1]) {
    const o = new THREE.Vector3(ctr.x + side * spread * sz.x, box.min.y + hf * sz.y, box.max.z + 2);
    rc.set(o, new THREE.Vector3(0, 0, -1));
    let hit = rc.intersectObjects(meshes, false)[0];
    for (let k = 0.6; !hit && k > 0.1; k -= 0.2) { o.x = ctr.x + side * spread * sz.x * k; rc.set(o, new THREE.Vector3(0, 0, -1)); hit = rc.intersectObjects(meshes, false)[0]; }
    const p = hit ? hit.point : new THREE.Vector3(o.x, o.y, box.max.z);
    const eye = new THREE.Mesh(eyeGeo, eyeWhite); eye.scale.setScalar(er); eye.position.copy(p).add(new THREE.Vector3(0, 0, er * 0.35));
    const pupil = new THREE.Mesh(eyeGeo, eyeBlack); pupil.scale.setScalar(0.5); pupil.position.set(0, 0, 0.62); eye.add(pupil);
    scene.add(eye); obj.attach(eye);
    if (angry) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(er * 2.4, er * 0.5, er * 0.5), eyeBlack);
      brow.position.copy(p).add(new THREE.Vector3(0, er * 1.25, er * 0.5)); brow.rotation.z = side * 0.45;
      scene.add(brow); obj.attach(brow);
    }
  }
}

// ---------------------------------------------------------------------------
// Particles & effects
// ---------------------------------------------------------------------------
const particles = [];
const pGeo = new THREE.IcosahedronGeometry(1, 0);
const pMats = {};
function pMat(color) { return pMats[color] || (pMats[color] = new THREE.MeshBasicMaterial({ color })); }
function burst(pos, { n = 10, color = 0xffffff, speed = 5, size = 0.25, life = 0.6, grav = 0, up = 2 } = {}) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(pGeo, pMat(color)); m.position.copy(pos);
    const a = rand() * Math.PI * 2, e = (rand() - 0.3);
    const v = new THREE.Vector3(Math.cos(a) * speed * (0.5 + rand() * 0.5), up + e * speed, Math.sin(a) * speed * (0.5 + rand() * 0.5));
    m.scale.setScalar(size); scene.add(m);
    particles.push({ m, v, life, max: life, size, grav });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); continue; }
    p.v.y -= p.grav * dt; p.m.position.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - 2 * dt);
    p.m.scale.setScalar(p.size * (p.life / p.max)); p.m.rotation.x += dt * 5;
  }
}
// Shockwave rings (ground pound visuals + boss attack)
const rings = [];
function ringFx(pos, { color = 0xffffff, max = 3, life = 0.35, hurt = false, speed = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.rotation.x = Math.PI / 2; m.position.copy(pos); m.position.y += 0.15; scene.add(m);
  rings.push({ m, t: 0, life, max, hurt, speed, r: 0.3 });
}
function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i]; g.t += dt;
    g.r = g.speed ? g.r + g.speed * dt : lerp(0.3, g.max, g.t / g.life);
    g.m.scale.set(g.r, g.r, g.speed ? 3 : 1); g.m.material.opacity = 1 - g.t / g.life;
    if (g.hurt && player.onGround && !player.invuln && g.t > 0.1) {
      const d = Math.hypot(player.pos.x - g.m.position.x, player.pos.z - g.m.position.z);
      if (Math.abs(d - g.r) < 0.7 && Math.abs(player.pos.y - g.m.position.y) < 1.2) hurtPlayer(1, g.m.position);
    }
    if (g.t >= g.life) { scene.remove(g.m); rings.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Game state & HUD
// ---------------------------------------------------------------------------
const STAR_NAMES = {
  boss: 'King Steak of Mount Grill',
  tower: 'Top of the Sky Carrot Tower',
  peppers: 'Eight Red Peppers',
  kids: 'The Lost Cherry Tomatoes',
  fish: 'Big Catch at Lake Lattuga',
  coins: '100 Coin Feast',
  steaks: 'Steak Roundup',
};
const STAR_ORDER = ['boss', 'tower', 'peppers', 'kids', 'fish', 'coins', 'steaks'];
let saved = [];
try { saved = JSON.parse(localStorage.getItem('pachino64') || '{}').stars || []; } catch (e) { saved = []; }
const G = {
  mode: 'loading', stars: new Set(saved), coins: 0, lives: 4, health: 8, peppers: 0, kids: 0, fishKilled: 0, steaksKilled: 0,
  checkpoint: SPAWN.clone(), time: 0, healthShow: 0, coinStarSpawned: false, nextLifeAt: 50, endingShown: saved.length >= 7,
};
function saveGame() { try { localStorage.setItem('pachino64', JSON.stringify({ stars: [...G.stars] })); } catch (e) { /* storage blocked */ } }

let toastT = 0, bannerT = 0;
function toast(msg, t = 2.2) { $('toast').textContent = msg; $('toast').classList.add('show'); toastT = t; }
function banner(html, t = 2.5) { $('banner').innerHTML = html; $('banner').classList.add('show'); bannerT = t; }
function updateHUD(dt) {
  $('stars').textContent = G.stars.size; $('coins').textContent = G.coins; $('livesN').textContent = Math.max(0, G.lives);
  $('pepperN').textContent = G.peppers; $('peppers').style.display = G.peppers > 0 && G.peppers < 8 ? 'flex' : 'none';
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').classList.remove('show');
  G.healthShow -= dt;
  $('health').style.opacity = (G.health < 8 || G.healthShow > 0) ? 1 : 0;
}
function drawHealth() {
  const svg = $('health'); const col = G.health > 5 ? '#4fd04a' : G.health > 2 ? '#ffd23f' : '#ff4d3a';
  let s = '<circle r="54" fill="#1d1430"/>';
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2 + 0.04, a1 = ((i + 1) / 8) * Math.PI * 2 - Math.PI / 2 - 0.04;
    const p = (a) => `${(Math.cos(a) * 48).toFixed(2)} ${(Math.sin(a) * 48).toFixed(2)}`;
    s += `<path d="M0 0 L${p(a0)} A48 48 0 0 1 ${p(a1)} Z" fill="${i < G.health ? col : '#3d3355'}"/>`;
  }
  s += '<circle r="20" fill="#e8352b" stroke="#1d1430" stroke-width="4"/><path d="M-8 -18 L0 -12 L8 -18 L4 -22 L0 -19 L-4 -22 Z" fill="#3fa34d"/>';
  s += `<text y="9" text-anchor="middle" font-family="Luckiest Guy" font-size="24" fill="#fff">${G.health}</text>`;
  svg.innerHTML = s;
}
function setHealth(h) { G.health = clamp(h, 0, 8); G.healthShow = 3; drawHealth(); }
function addCoins(n) {
  G.coins += n; heal(n);
  if (G.coins >= G.nextLifeAt) { G.nextLifeAt += 50; G.lives++; sfx.oneup(); toast('1-UP!'); }
  if (G.coins >= 100 && !G.coinStarSpawned) {
    G.coinStarSpawned = true;
    spawnStar('coins', player.pos.clone().add(new THREE.Vector3(0, 3.5, 0)));
  }
}
let healQueue = 0;
function heal(n) { healQueue += n; }

// ---------------------------------------------------------------------------
// Collectibles
// ---------------------------------------------------------------------------
const items = [];
function addItem(type, mesh, pos, extra = {}) {
  mesh.position.copy(pos); scene.add(mesh);
  const it = { type, mesh, pos: pos.clone(), r: 1.1, active: true, t: rand() * 6, ...extra }; items.push(it); return it;
}
function coin(x, y, z) { return addItem('coin', inst('coin-gold', 2.0, false), new THREE.Vector3(x, y, z)); }
function coinLine(a, b, n) { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); coin(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)); } }
function coinRing(cx, y, cz, r, n) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; coin(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); } }
function pepper(x, y, z) { const m = inst('paprika', 4.5, false); addEyes(m, { hf: 0.55, size: 0.13 }); return addItem('pepper', m, new THREE.Vector3(x, y, z)); }
function heartPickup(x, y, z) { return addItem('heart', inst('heart', 2.6, false), new THREE.Vector3(x, y, z), { r: 1.6, spin: 0 }); }

const starMeshes = {};
function makeStarMesh(id) {
  const m = inst('star', 3.2, true);
  if (G.stars.has(id)) m.traverse((c) => { if (c.isMesh) { c.material = c.material.clone(); c.material.transparent = true; c.material.opacity = 0.45; c.material.color = new THREE.Color(0x88bbff); } });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.22, depthWrite: false }));
  glow.position.y = 0.58; m.add(glow); glow.scale.setScalar(1 / 3.2 * 3.2);
  return m;
}
function spawnStar(id, pos, { silent = false } = {}) {
  if (starMeshes[id]) return;
  const m = makeStarMesh(id);
  const it = addItem('star', m, pos, { id, r: 1.4 }); starMeshes[id] = it;
  if (!silent) { sfx.appear(); burst(pos, { n: 24, color: 0xffe066, speed: 7, life: 1 }); toast('A Golden Star appeared!'); }
  return it;
}

function collectItem(it) {
  it.active = false; scene.remove(it.mesh);
  const p = it.mesh.position;
  switch (it.type) {
    case 'coin': sfx.coin(); burst(p, { n: 6, color: 0xffd23f, speed: 3, size: 0.15, life: 0.4 }); addCoins(1); break;
    case 'pepper':
      G.peppers++; sfx.redcoin(); burst(p, { n: 12, color: 0xff3b30, speed: 4, life: 0.6 }); addCoins(2);
      toast(`Red Pepper ${G.peppers} / 8`);
      if (G.peppers === 8) spawnStar('peppers', new THREE.Vector3(0, 3.2, 8));
      break;
    case 'heart': break;
    case 'star': collectStar(it.id); break;
    case 'kid': break;
  }
}
function updateItems(dt) {
  for (const it of items) {
    if (!it.active) continue;
    it.t += dt;
    const m = it.mesh;
    if (it.type === 'coin') m.rotation.y += dt * 4;
    else if (it.type === 'pepper') { m.rotation.y += dt * 2; m.position.y = it.pos.y + Math.sin(it.t * 3) * 0.15; }
    else if (it.type === 'star') { m.rotation.y += dt * 2.2; m.position.y = it.pos.y + Math.sin(it.t * 2) * 0.25; }
    else if (it.type === 'heart') {
      const near = player.pos.distanceTo(it.pos) < 2.2;
      it.spin = lerp(it.spin, near ? 14 : 1.5, dt * 4); m.rotation.y += dt * it.spin;
      if (near && G.health < 8) { it.cool = (it.cool || 0) - dt; if (it.cool <= 0) { it.cool = 0.35; setHealth(G.health + 1); sfx.heart(); } }
      continue;
    }
    if (G.mode !== 'play') continue;
    const dx = player.pos.x - m.position.x, dz = player.pos.z - m.position.z, dy = (player.pos.y + 0.8) - (m.position.y + 0.5);
    if (dx * dx + dz * dz < it.r * it.r && Math.abs(dy) < 1.6) collectItem(it);
  }
}

// ---------------------------------------------------------------------------
// Special objects: crates, springs, moving platforms, checkpoints
// ---------------------------------------------------------------------------
const crates = [];
function crate(x, z, contents = 'coins', y = null) {
  const gy = y === null ? groundHeight(x, z) : y;
  const o = place('crate', x, gy, z, { s: 2.8, solid: true });
  const c = { o, solid: o.userData.solid, contents, alive: true }; o.userData.solid.crate = c; crates.push(c); return c;
}
function breakCrate(c) {
  if (!c.alive) return; c.alive = false; scene.remove(c.o); removeSolid(c.solid); sfx.crate();
  const p = c.o.position.clone().add(new THREE.Vector3(0, 0.7, 0));
  burst(p, { n: 14, color: 0xb07a3c, speed: 6, size: 0.3, grav: 20, life: 0.8, up: 6 });
  if (c.contents === 'coins') for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; coin(p.x + Math.cos(a) * 1.2, p.y + 0.2, p.z + Math.sin(a) * 1.2); }
  else if (c.contents === 'pepper') pepper(p.x, p.y + 0.3, p.z);
  else if (c.contents === 'heart') heartPickup(p.x, p.y - 0.6, p.z);
}
const springs = [];
function spring(x, y, z) {
  const o = place('spring', x, y, z, { s: 2.6 });
  o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o);
  const s = addSolid({ x: b.min.x, y: b.min.y, z: b.min.z }, { x: b.max.x, y: b.max.y, z: b.max.z }, { spring: true });
  springs.push({ o, s, t: 0 }); s.springRef = springs[springs.length - 1];
}
const movers = [];
function mover(name, base, fn, s = [3, 3, 3]) {
  const o = inst(name, 1); o.scale.set(...s); o.position.copy(base); scene.add(o);
  o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o);
  const off = { min: b.min.clone().sub(base), max: b.max.clone().sub(base) };
  const sd = addSolid(b.min, b.max);
  movers.push({ o, base: base.clone(), fn, sd, off, delta: new THREE.Vector3(), t: 0 });
}
function updateMovers(dt) {
  for (const m of movers) {
    m.t += dt; const np = m.base.clone().add(m.fn(m.t));
    m.delta.subVectors(np, m.o.position); m.o.position.copy(np);
    m.sd.min.x = np.x + m.off.min.x; m.sd.min.y = np.y + m.off.min.y; m.sd.min.z = np.z + m.off.min.z;
    m.sd.max.x = np.x + m.off.max.x; m.sd.max.y = np.y + m.off.max.y; m.sd.max.z = np.z + m.off.max.z;
    m.sd.vel = m.delta;
  }
}
const flags = [];
function checkpoint(x, y, z) {
  const o = place('flag', x, y, z, { s: 3 });
  flags.push({ o, pos: new THREE.Vector3(x, y, z), on: false });
}

// ---------------------------------------------------------------------------
// NPC friends (vegetables) & dialog
// ---------------------------------------------------------------------------
const npcs = [];
function npc(model, name, x, z, s, lines, { y = null, eyes = {}, face = 0 } = {}) {
  const gy = y === null ? groundHeight(x, z) : y;
  const root = new THREE.Group(); root.position.set(x, gy, z); scene.add(root);
  const body = inst(model, s); root.add(body);
  addEyes(body, { size: 0.12, ...eyes });
  body.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(body); const sz = box.getSize(new THREE.Vector3());
  const rad = Math.max(sz.x, sz.z) * 0.42;
  addSolid({ x: x - rad, y: gy, z: z - rad }, { x: x + rad, y: gy + sz.y, z: z + rad }, { noFloor: false });
  const n = { root, body, name, lines, pos: root.position, h: sz.y, rad, t: rand() * 5, face };
  root.rotation.y = face; npcs.push(n); return n;
}
function updateNPCs(dt) {
  let nearest = null, nd = 1e9;
  for (const n of npcs) {
    n.t += dt;
    const d = Math.hypot(player.pos.x - n.pos.x, player.pos.z - n.pos.z);
    n.body.scale.y = n.body.scale.x * (1 + Math.sin(n.t * 3) * 0.04);
    if (d < 9) { const a = Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z); n.root.rotation.y += angDiff(n.root.rotation.y, a) * Math.min(1, dt * 4); }
    if (d < n.rad + 2.2 && Math.abs(player.pos.y - n.pos.y) < 2.5 && d < nd) { nd = d; nearest = n; }
  }
  G.nearNPC = nearest;
  $('prompt').style.display = nearest && G.mode === 'play' ? 'block' : 'none';
}
const dlg = { pages: [], i: 0, shown: 0, who: '', onClose: null, t: 0 };
function openDialog(who, pages, onClose = null) {
  dlg.pages = pages; dlg.i = 0; dlg.shown = 0; dlg.who = who; dlg.onClose = onClose; dlg.t = 0;
  G.mode = 'dialog'; $('dialog').style.display = 'block'; $('dialog').querySelector('.who').textContent = who; $('prompt').style.display = 'none';
}
function updateDialog(dt) {
  const page = dlg.pages[dlg.i];
  if (dlg.shown < page.length) {
    const before = dlg.shown | 0; dlg.shown = Math.min(page.length, dlg.shown + dt * 55);
    if ((dlg.shown | 0) !== before && (dlg.shown | 0) % 3 === 0) sfx.talk();
  }
  $('dialog').querySelector('.text').textContent = page.slice(0, dlg.shown | 0);
  $('dialog').querySelector('.more').style.visibility = dlg.shown >= page.length ? 'visible' : 'hidden';
}
function advanceDialog() {
  const page = dlg.pages[dlg.i];
  if (dlg.shown < page.length) { dlg.shown = page.length; return; }
  dlg.i++;
  if (dlg.i >= dlg.pages.length) {
    $('dialog').style.display = 'none'; G.mode = 'play'; player.talkCool = 0.4;
    const cb = dlg.onClose; dlg.onClose = null; if (cb) cb();
  } else dlg.shown = 0;
}
function talkTo(n) {
  const lines = typeof n.lines === 'function' ? n.lines() : n.lines;
  openDialog(n.name, lines);
}

// ---------------------------------------------------------------------------
// Enemies: steaks, fish, King Steak
// ---------------------------------------------------------------------------
const enemies = [];
function steak(x, z, { cooked = false, y = null, range = 6 } = {}) {
  const gy = y === null ? groundHeight(x, z) : y;
  const root = new THREE.Group(); root.position.set(x, gy, z); scene.add(root);
  const s = 3.2;
  const tilt = new THREE.Group(); root.add(tilt);
  const body = inst(cooked ? 'meat-cooked' : 'meat-raw', s); body.rotation.x = Math.PI / 2; body.position.y = 0.29 * s + 0.05; body.position.z = -0.1;
  tilt.add(body); addEyes(tilt, { hf: 0.68, size: 0.09, spread: 0.2, angry: true });
  const e = {
    kind: 'steak', root, tilt, body, home: new THREE.Vector3(x, gy, z), range, cooked,
    pos: root.position, vel: new THREE.Vector3(), r: 0.75, h: 1.8, onGround: true, alive: true, state: 'patrol', t: 0,
    target: new THREE.Vector3(x, gy, z), speed: cooked ? 5.6 : 4.2, facing: rand() * 6, hop: 0,
  };
  enemies.push(e); return e;
}
function fish(i) {
  const root = new THREE.Group(); scene.add(root);
  const body = inst('fish', 3.2); root.add(body);
  const e = { kind: 'fish', root, body, pos: root.position, vel: new THREE.Vector3(), alive: true, state: 'swim', t: rand() * 3, a: (i / 5) * Math.PI * 2, rr: 4 + (i % 3) * 2.5, cool: 2 + rand() * 3, r: 0.8, h: 1 };
  root.position.set(POND.x + Math.cos(e.a) * e.rr, POND.level - 0.6, POND.z + Math.sin(e.a) * e.rr);
  enemies.push(e); return e;
}
let boss = null;
function makeBoss(x, y, z, arena) {
  const root = new THREE.Group(); root.position.set(x, y, z); scene.add(root);
  const s = 8.5; const tilt = new THREE.Group(); root.add(tilt);
  const body = inst('meat-raw', s); body.rotation.x = Math.PI / 2; body.position.y = 0.29 * s + 0.1; body.position.z = -0.25; tilt.add(body);
  addEyes(tilt, { hf: 0.66, size: 0.08, spread: 0.2, angry: true });
  // golden crown
  const crown = new THREE.Group(); const gold = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.6, roughness: 0.3 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 16, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 1.0, 0.6, Math.sin(a) * 1.0); crown.add(sp); }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: 0x3f8cff, metalness: 0.3, roughness: 0.2 })); gem.position.set(0, 0, 1.12); crown.add(gem);
  crown.position.set(0, 0.58 * s * 1 + 0.35, 0.2); crown.traverse((c) => c.isMesh && (c.castShadow = true)); tilt.add(crown);
  const dizzy = new THREE.Group(); for (let i = 0; i < 3; i++) { const st = inst('star', 1.2, false); st.position.set(Math.cos(i * 2.1) * 1.4, 0, Math.sin(i * 2.1) * 1.4); dizzy.add(st); }
  dizzy.position.y = 0.58 * s + 1.6; dizzy.visible = false; root.add(dizzy);
  boss = { kind: 'boss', root, tilt, body, dizzy, pos: root.position, vel: new THREE.Vector3(), r: 2.2, h: 4.8, onGround: true, alive: true, hp: 3, state: 'sleep', t: 0, facing: 0, arena, home: new THREE.Vector3(x, y, z), cycle: 0, chargeDir: new THREE.Vector3() };
  enemies.push(boss);
}
function killEnemy(e, how = 'stomp') {
  if (!e.alive) return; e.alive = false;
  const p = e.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
  burst(p, { n: 16, color: 0xffffff, speed: 5, size: 0.35, life: 0.6 });
  if (e.kind === 'steak') {
    sfx.stomp(); G.steaksKilled++; e.state = 'dead'; e.t = 0;
    coin(e.pos.x, Math.max(e.pos.y, groundHeight(e.pos.x, e.pos.z)) + 0.6, e.pos.z);
    const left = enemies.filter((x) => x.kind === 'steak' && x.alive).length;
    if (left === 0) { spawnStar('steaks', new THREE.Vector3(7, 3.2, 10)); }
    else toast(`Steaks left: ${left}`, 1.6);
  } else if (e.kind === 'fish') {
    sfx.stomp(); G.fishKilled++; e.state = 'dead'; e.t = 0;
    const bones = inst('fish-bones', 3); bones.position.copy(e.pos); scene.add(bones); e.bones = bones;
    coin(e.pos.x, Math.max(e.pos.y + 0.5, POND.level + 1.2), e.pos.z);
    const left = 5 - G.fishKilled;
    if (left === 0) spawnStar('fish', new THREE.Vector3(POND.x, 2.5, POND.z));
    else toast(`Fish left: ${left}`, 1.6);
  }
}
function updateSteak(e, dt) {
  if (!e.alive) {
    e.t += dt; e.root.scale.set(1 + e.t * 3, Math.max(0.05, 1 - e.t * 5), 1 + e.t * 3);
    if (e.t > 0.3) { scene.remove(e.root); e.gone = true; }
    return;
  }
  e.t += dt;
  const dp = player.pos.distanceTo(e.pos), dy = player.pos.y - e.pos.y;
  const homeD = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
  let speed = 0; let tx = e.target.x, tz = e.target.z;
  if (e.state === 'patrol') {
    if (Math.hypot(e.pos.x - tx, e.pos.z - tz) < 0.8 || e.t > 4) {
      const a = rand() * Math.PI * 2, r = rand() * e.range; e.target.set(e.home.x + Math.cos(a) * r, 0, e.home.z + Math.sin(a) * r); e.t = 0;
    }
    speed = 1.8;
    if (dp < 10 && Math.abs(dy) < 3 && G.mode === 'play') { e.state = 'notice'; e.t = 0; e.vel.y = 6; e.onGround = false; }
  } else if (e.state === 'notice') {
    tx = player.pos.x; tz = player.pos.z; speed = 0;
    if (e.t > 0.45) { e.state = 'chase'; e.t = 0; }
  } else if (e.state === 'chase') {
    tx = player.pos.x; tz = player.pos.z; speed = e.speed;
    if (dp > 15 || homeD > e.range + 12 || Math.abs(dy) > 4) { e.state = 'return'; }
  } else if (e.state === 'return') {
    tx = e.home.x; tz = e.home.z; speed = 3;
    if (homeD < 1) { e.state = 'patrol'; e.t = 0; }
  } else if (e.state === 'knock') {
    speed = 0; if (e.onGround && e.t > 0.3) { e.state = 'chase'; e.t = 0; }
  }
  if (e.state !== 'knock') {
    const want = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    e.facing += angDiff(e.facing, want) * Math.min(1, dt * 6);
    // edge check: don't walk off ledges
    const ax = e.pos.x + Math.sin(e.facing) * 1.2, az = e.pos.z + Math.cos(e.facing) * 1.2;
    const ahead = floorAt(ax, az, e.pos.y, 0.3).y;
    if (ahead < e.pos.y - 1.2 || waterLevelAt(ax, az) !== null) { speed = 0; if (e.state === 'patrol') e.t = 5; }
    e.vel.x = Math.sin(e.facing) * speed; e.vel.z = Math.cos(e.facing) * speed;
  } else { e.vel.x *= 1 - dt * 2; e.vel.z *= 1 - dt * 2; }
  e.vel.y = Math.max(e.vel.y - GRAV * dt, -MAX_FALL);
  moveBody(e, dt);
  if (e.pos.y < -20) { e.pos.copy(e.home); e.vel.set(0, 0, 0); }
  // waddle hop animation
  e.hop += dt * (speed > 2 ? 12 : 7);
  e.root.rotation.y = e.facing;
  e.tilt.position.y = e.onGround ? Math.abs(Math.sin(e.hop)) * (speed > 0 ? 0.35 : 0.1) : 0;
  e.tilt.rotation.z = Math.sin(e.hop) * 0.12; e.tilt.rotation.x = speed > 3 ? 0.18 : 0;
  // interaction with the player
  if (G.mode !== 'play' || player.dead) return;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z, hd = Math.hypot(dx, dz);
  if (hd < e.r + player.r + 0.15 && dy > -1.5 && dy < e.h) {
    if (player.vel.y < 0 && dy > e.h * 0.45) { killEnemy(e); player.bounce(player.action === 'gpFall' ? 8 : 12); }
    else if (player.action === 'gpFall') killEnemy(e);
    else if (player.action === 'longjump' && player.vel.y < 0) killEnemy(e); // belly slide hit
    else hurtPlayer(1, e.pos);
  }
}
function updateFish(e, dt) {
  if (!e.alive) {
    e.t += dt; if (e.bones) { e.bones.position.y -= dt * 1.5; e.bones.rotation.z += dt * 3; }
    if (e.t > 1.4) { scene.remove(e.root); if (e.bones) scene.remove(e.bones); e.gone = true; }
    e.root.visible = false; return;
  }
  e.t += dt;
  const dpx = player.pos.x - POND.x, dpz = player.pos.z - POND.z, pd = Math.hypot(dpx, dpz);
  if (e.state === 'swim') {
    e.a += dt * 0.6 * (e.rr > 5 ? 1 : -1);
    const nx = POND.x + Math.cos(e.a) * e.rr, nz = POND.z + Math.sin(e.a) * e.rr;
    e.root.rotation.y = Math.atan2(nx - e.pos.x, nz - e.pos.z) + Math.PI / 2;
    e.pos.set(nx, POND.level - 0.55 + Math.sin(e.t * 3) * 0.1, nz); e.root.rotation.z = 0;
    e.cool -= dt;
    if (e.cool <= 0 && pd < POND.r + 9 && G.mode === 'play') {
      // leap toward the player in an arc
      const tx = player.pos.x + player.vel.x * 0.5, tz = player.pos.z + player.vel.z * 0.5;
      const T = 1.25; e.vel.set((tx - e.pos.x) / T, 13, (tz - e.pos.z) / T);
      const hv = Math.hypot(e.vel.x, e.vel.z); if (hv > 12) { e.vel.x *= 12 / hv; e.vel.z *= 12 / hv; }
      e.state = 'leap'; sfx.splash(); burst(e.pos, { n: 10, color: 0x9fd8ff, speed: 4, life: 0.5, grav: 15, up: 5 });
    }
  } else if (e.state === 'leap') {
    e.vel.y -= 20 * dt; e.pos.addScaledVector(e.vel, dt);
    e.root.rotation.y = Math.atan2(e.vel.x, e.vel.z) + Math.PI / 2;
    e.root.rotation.z = Math.atan2(e.vel.y, Math.hypot(e.vel.x, e.vel.z)) * 0.8;
    const fy = Math.max(groundHeight(e.pos.x, e.pos.z), waterLevelAt(e.pos.x, e.pos.z) ?? -99);
    if (e.vel.y < 0 && e.pos.y < fy) {
      if (waterLevelAt(e.pos.x, e.pos.z) !== null && Math.hypot(e.pos.x - POND.x, e.pos.z - POND.z) < POND.r - 1) {
        e.state = 'swim'; e.cool = 2.5 + rand() * 2.5; sfx.splash(); burst(e.pos, { n: 8, color: 0x9fd8ff, speed: 3, life: 0.5, grav: 15, up: 4 });
        e.a = Math.atan2(e.pos.z - POND.z, e.pos.x - POND.x); e.rr = clamp(Math.hypot(e.pos.x - POND.x, e.pos.z - POND.z), 3, POND.r - 3);
      } else { e.state = 'flop'; e.t = 0; e.pos.y = fy; }
    }
  } else if (e.state === 'flop') {
    // flopping on land: hops back toward the pond
    const a = Math.atan2(POND.z - e.pos.z, POND.x - e.pos.x);
    if (e.pos.y <= groundHeight(e.pos.x, e.pos.z) + 0.01) { e.vel.set(Math.cos(a) * 4, 7, Math.sin(a) * 4); }
    e.vel.y -= 20 * dt; e.pos.addScaledVector(e.vel, dt);
    const gh = groundHeight(e.pos.x, e.pos.z); if (e.pos.y < gh) e.pos.y = gh;
    e.root.rotation.z = Math.PI / 2 + Math.sin(e.t * 20) * 0.3;
    if (Math.hypot(e.pos.x - POND.x, e.pos.z - POND.z) < POND.r - 2) { e.state = 'leap'; e.vel.set(0, 2, 0); }
  }
  if (G.mode !== 'play' || player.dead || e.state === 'swim') return;
  const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z), dy = player.pos.y + 0.8 - e.pos.y;
  if (d < 1.3 && Math.abs(dy) < 1.4) {
    if (player.vel.y < 0 && dy > 0.6) { killEnemy(e); player.bounce(12); }
    else if (player.action === 'gpFall') killEnemy(e);
    else hurtPlayer(1, e.pos);
  }
}
function updateBoss(b, dt) {
  if (!b.alive) {
    b.t += dt; b.root.scale.set(1 + b.t, Math.max(0.02, 1 - b.t * 1.2), 1 + b.t);
    if (b.t > 0.9 && !b.gone) { b.gone = true; scene.remove(b.root); burst(b.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 40, color: 0xffffff, speed: 9, size: 0.6, life: 1 }); spawnStar('boss', new THREE.Vector3(b.home.x, b.home.y + 2.2, b.home.z)); }
    return;
  }
  b.t += dt;
  const A = b.arena;
  const inArena = player.pos.y > A.y - 0.5 && player.pos.x > A.x0 && player.pos.x < A.x1 && player.pos.z > A.z0 && player.pos.z < A.z1;
  const dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z, d = Math.hypot(dx, dz);
  const toP = Math.atan2(dx, dz);
  let speed = 0;
  b.dizzy.visible = b.state === 'stunned';
  switch (b.state) {
    case 'sleep':
      b.tilt.rotation.x = 0.1 + Math.sin(b.t * 1.5) * 0.05;
      if (inArena && G.mode === 'play') {
        b.state = 'intro'; b.t = 0;
        openDialog('King Steak', ['GRRRAAH! Who dares climb MY Mount Grill?!', 'A tomato?! In a pirate hat?! I shall make you into SAUCE!', '(Tip: dodge his charge. When he is dizzy, jump on him or ground pound him!)']);
      }
      break;
    case 'intro': if (G.mode === 'play') { b.state = 'chase'; b.t = 0; } break;
    case 'chase':
      if (!inArena) { b.state = 'home'; break; }
      speed = 3.4 + (3 - b.hp) * 0.8; b.facing += angDiff(b.facing, toP) * Math.min(1, dt * 3);
      if (b.t > 2.6) { b.cycle++; b.state = b.cycle % 3 === 0 ? 'jump' : 'windup'; b.t = 0; if (b.state === 'jump') { b.vel.y = 18; b.onGround = false; } }
      break;
    case 'windup':
      b.facing += angDiff(b.facing, toP) * Math.min(1, dt * 8);
      b.tilt.position.x = Math.sin(b.t * 60) * 0.12;
      if (b.t > 0.7) { b.state = 'charge'; b.t = 0; b.tilt.position.x = 0; b.chargeDir.set(Math.sin(b.facing), 0, Math.cos(b.facing)); sfx.longjump(); }
      break;
    case 'charge': {
      speed = 17;
      const nx = b.pos.x + b.chargeDir.x * 1.5, nz = b.pos.z + b.chargeDir.z * 1.5;
      if (nx < A.x0 + b.r || nx > A.x1 - b.r || nz < A.z0 + b.r || nz > A.z1 - b.r || b.t > 1.6) {
        b.state = 'stunned'; b.t = 0; sfx.pound(); ringFx(b.pos, { max: 4 });
        burst(b.pos.clone().add(new THREE.Vector3(0, 2, 0)), { n: 10, color: 0xffee88, speed: 4 });
      }
      if (rand() < 0.5) burst(b.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { n: 1, color: 0xd8c8a8, speed: 1.5, life: 0.5 });
      break;
    }
    case 'jump':
      if (b.onGround && b.t > 0.2) {
        sfx.pound(); b.state = 'land'; b.t = 0;
        ringFx(b.pos, { color: 0xffffff, life: 1.4, hurt: true, speed: 9.5 }); shake = 0.5;
      } else if (!b.onGround) { b.facing += angDiff(b.facing, toP) * Math.min(1, dt * 3); speed = Math.min(d, 10) * 0.6; }
      break;
    case 'land': if (b.t > 0.9) { b.state = 'chase'; b.t = 0; } break;
    case 'stunned':
      b.tilt.rotation.z = Math.sin(b.t * 6) * 0.15; b.dizzy.rotation.y += dt * 4;
      if (b.t > 3.2) { b.state = 'chase'; b.t = 0; b.tilt.rotation.z = 0; }
      break;
    case 'hurt':
      b.tilt.rotation.z = 0; b.root.visible = Math.floor(b.t * 20) % 2 === 0;
      if (b.t > 1.1) { b.root.visible = true; b.state = 'chase'; b.t = 0; if (b.hp <= 0) { b.alive = false; b.t = 0; sfx.bossHit(); } }
      break;
    case 'home': {
      const hd = Math.hypot(b.home.x - b.pos.x, b.home.z - b.pos.z);
      b.facing += angDiff(b.facing, Math.atan2(b.home.x - b.pos.x, b.home.z - b.pos.z)) * Math.min(1, dt * 3);
      speed = hd > 0.5 ? 3 : 0; if (hd < 0.5) { b.state = 'wait'; b.t = 0; }
      break;
    }
    case 'wait': b.tilt.rotation.x = 0; if (inArena) { b.state = 'chase'; b.t = 0; } break;
  }
  const dir = b.state === 'charge' ? b.chargeDir : new THREE.Vector3(Math.sin(b.facing), 0, Math.cos(b.facing));
  b.vel.x = dir.x * speed; b.vel.z = dir.z * speed;
  b.vel.y = Math.max(b.vel.y - GRAV * dt, -MAX_FALL);
  moveBody(b, dt);
  b.pos.x = clamp(b.pos.x, A.x0 + b.r, A.x1 - b.r); b.pos.z = clamp(b.pos.z, A.z0 + b.r, A.z1 - b.r);
  b.root.rotation.y = b.facing;
  if (b.state === 'chase' || b.state === 'home') { b.tilt.position.y = Math.abs(Math.sin(b.t * 8)) * 0.4; b.tilt.rotation.x = 0; }
  else if (b.state === 'charge') { b.tilt.rotation.x = 0.35; b.tilt.position.y = Math.abs(Math.sin(b.t * 18)) * 0.3; }
  else if (b.state !== 'sleep') { b.tilt.rotation.x = lerp(b.tilt.rotation.x, 0, dt * 5); b.tilt.position.y = 0; }
  // player interaction
  if (G.mode !== 'play' || player.dead || b.state === 'sleep' || b.state === 'hurt') return;
  const dy = player.pos.y - b.pos.y;
  if (d < b.r + player.r && dy > -1 && dy < b.h + 0.3) {
    const fromTop = player.vel.y < 0 && dy > b.h * 0.6;
    if (fromTop || player.action === 'gpFall') {
      if (b.state === 'stunned') hitBoss();
      else { toast('Too tough! Make him dizzy first!', 1.5); sfx.hit(); }
      player.bounce(14); const a = Math.atan2(dx, dz); player.vel.x = Math.sin(a) * 9; player.vel.z = Math.cos(a) * 9;
    } else if (b.state === 'stunned') {
      const a = Math.atan2(dx, dz); player.pos.x = b.pos.x + Math.sin(a) * (b.r + player.r); player.pos.z = b.pos.z + Math.cos(a) * (b.r + player.r);
    } else hurtPlayer(2, b.pos);
  }
}
function hitBoss() {
  boss.hp--; boss.state = 'hurt'; boss.t = 0; sfx.bossHit(); shake = 0.4;
  burst(boss.pos.clone().add(new THREE.Vector3(0, 3, 0)), { n: 20, color: 0xff6644, speed: 7, life: 0.7 });
  toast(boss.hp > 0 ? ['', 'One more hit!', 'Ouch! Again!'][boss.hp] : 'NOOOO! My crown!', 1.6);
}

// ---------------------------------------------------------------------------
// Player: Capitan Pachino
// ---------------------------------------------------------------------------
const player = {
  pos: SPAWN.clone(), vel: new THREE.Vector3(), r: 0.45, h: 1.55, onGround: true, facing: Math.PI,
  action: 'normal', at: 0, jumpKind: 0, lastLand: -9, coyote: 0, jumpBuf: 0, invuln: 0, dead: false,
  combo: 0, airSlashed: false, wallN: null, wallT: -9, wallSpeed: 0, swimming: false, talkCool: 0, squash: 0, lastSafe: SPAWN.clone(),
  bounce(v) { this.vel.y = v; this.onGround = false; this.action = 'normal'; this.jumpKind = 1; this.airSlashed = false; },
};
const pRoot = new THREE.Group(), pPivot = new THREE.Group(); pRoot.add(pPivot); scene.add(pRoot);
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; scene.add(blob);
const slashFx = new THREE.Mesh(new THREE.RingGeometry(1.0, 2.3, 28, 1, -Math.PI * 0.15, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
slashFx.rotation.x = -Math.PI / 2; slashFx.position.y = 0.8; pRoot.add(slashFx);

function setupPlayerModel() {
  const m = models.pachino.clone(true); m.scale.setScalar(1.6);
  m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; c.material.emissive = new THREE.Color(0xffffff); c.material.emissiveMap = c.material.map; c.material.emissiveIntensity = 0.45; } });
  pPivot.add(m); pPivot.position.y = 0.8;
}
function hurtPlayer(n, from) {
  if (player.invuln > 0 || player.dead || G.mode !== 'play') return;
  setHealth(G.health - n); sfx.hurt(); player.invuln = 1.6;
  const a = Math.atan2(player.pos.x - from.x, player.pos.z - from.z);
  player.vel.set(Math.sin(a) * 9, 9, Math.cos(a) * 9); player.onGround = false; player.action = 'hurt'; player.at = 0;
  burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 8, color: 0xffee66, speed: 5, life: 0.4 });
  if (G.health <= 0) killPlayer();
}
function killPlayer() {
  if (player.dead) return; player.dead = true; G.mode = 'dying'; G.dieT = 0; sfx.die();
}
function respawn() {
  G.lives--;
  if (G.lives < 0) { G.mode = 'gameover'; $('gameover').style.display = 'flex'; document.exitPointerLock?.(); return; }
  player.pos.copy(G.checkpoint); player.vel.set(0, 0, 0); player.dead = false; player.action = 'normal'; player.invuln = 2;
  setHealth(8); pPivot.rotation.set(0, 0, 0); G.mode = 'play'; camState.snap = true;
}

const input = { x: 0, y: 0, jump: false, jumpP: false, crouch: false, crouchP: false, attackP: false, talkP: false, camX: 0, camY: 0 };
function startAction(a) { player.action = a; player.at = 0; }

function doJump() {
  const p = player; const hs = Math.hypot(p.vel.x, p.vel.z);
  if (p.crouching) {
    if (hs > 5) { // long jump
      startAction('longjump'); p.vel.y = 9.5; const s = Math.max(hs * 1.45, 15); p.vel.x = Math.sin(p.facing) * s; p.vel.z = Math.cos(p.facing) * s; sfx.longjump();
    } else { // backflip
      startAction('backflip'); p.vel.y = 17.5; p.vel.x = -Math.sin(p.facing) * 3.5; p.vel.z = -Math.cos(p.facing) * 3.5; sfx.jump3();
    }
    p.jumpKind = 0;
  } else {
    const chain = G.time - p.lastLand < 0.22;
    if (chain && p.jumpKind === 1 && hs > 3) { p.jumpKind = 2; p.vel.y = 14; sfx.jump2(); startAction('jump'); }
    else if (chain && p.jumpKind === 2 && hs > 6) { p.jumpKind = 3; p.vel.y = 17.5; sfx.jump3(); startAction('jump3'); }
    else { p.jumpKind = 1; p.vel.y = 11.5; sfx.jump(); startAction('jump'); }
  }
  p.onGround = false; p.coyote = 0; p.jumpBuf = 0; p.airSlashed = false; p.cutJump = false; p.squash = -0.25;
}

function updatePlayer(dt) {
  const p = player; p.at += dt; p.invuln = Math.max(0, p.invuln - dt); p.talkCool -= dt;
  // camera-relative input
  const yaw = camState.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let mx = input.x * rx + input.y * fx, mz = input.x * rz + input.y * fz;
  const mag = Math.min(1, Math.hypot(mx, mz)); if (mag > 0.01) { mx /= Math.hypot(mx, mz); mz /= Math.hypot(mx, mz); }
  if (G.mode !== 'play') { input.jumpP = input.attackP = input.crouchP = input.talkP = false; }

  // talk
  if (input.talkP && G.nearNPC && p.onGround && p.talkCool <= 0) { talkTo(G.nearNPC); input.talkP = false; return; }
  if (input.attackP && G.nearNPC && p.onGround && p.talkCool <= 0 && p.action === 'normal') { talkTo(G.nearNPC); input.attackP = false; return; }

  if (input.jumpP) p.jumpBuf = 0.13; else p.jumpBuf -= dt;
  if (p.onGround) p.coyote = 0.1; else p.coyote -= dt;
  const water = waterLevelAt(p.pos.x, p.pos.z);
  const deep = water !== null && p.floorY !== undefined && p.floorY < water - 1.1;
  p.swimming = deep && p.pos.y < water - 0.55;

  const hs = Math.hypot(p.vel.x, p.vel.z);
  const busy = ['gpStart', 'gpFall', 'gpLand', 'hurt', 'slash', 'star'].includes(p.action);

  // ---- actions ----
  if (p.action === 'star') { p.vel.x = p.vel.z = 0; }
  else if (p.swimming) {
    // simple surface swimming
    if (p.action !== 'normal') startAction('normal');
    const target = water - 0.75; p.vel.y = lerp(p.vel.y, (target - p.pos.y) * 4, dt * 6);
    const sp = 4.5; p.vel.x = lerp(p.vel.x, mx * mag * sp, dt * 4); p.vel.z = lerp(p.vel.z, mz * mag * sp, dt * 4);
    if (mag > 0.1) p.facing += angDiff(p.facing, Math.atan2(mx, mz)) * Math.min(1, dt * 8);
    if (p.jumpBuf > 0) { p.vel.y = 12; p.jumpBuf = 0; sfx.splash(); burst(p.pos, { n: 8, color: 0x9fd8ff, speed: 3, grav: 15, up: 4 }); startAction('jump'); p.jumpKind = 1; }
    if (Math.random() < dt * 6 && mag > 0.1) burst(p.pos.clone().setY(water), { n: 1, color: 0xffffff, speed: 1, life: 0.4, size: 0.2 });
  } else if (p.action === 'gpStart') {
    p.vel.set(0, 0, 0); if (p.at > 0.28) { startAction('gpFall'); p.vel.y = -30; }
  } else if (p.action === 'gpFall') {
    p.vel.x = p.vel.z = 0; p.vel.y = -30;
  } else if (p.action === 'gpLand') {
    p.vel.x = p.vel.z = 0; if (p.at > 0.3) startAction('normal');
  } else if (p.action === 'hurt') {
    if (p.onGround && p.at > 0.2) startAction('normal');
  } else if (p.action === 'slash') {
    const f = p.onGround ? 1 - Math.min(1, dt * 10) : 1; p.vel.x *= f; p.vel.z *= f;
    if (p.at > 0.06 && !p.slashHit) { p.slashHit = true; slashHits(); }
    if (p.at > 0.3) startAction('normal');
  } else {
    // movement
    const air = !p.onGround;
    p.crouching = p.onGround && input.crouch;
    let maxS = RUN * mag, accel = air ? 16 : 45;
    if (p.crouching) { maxS = 0; accel = 12; }
    if (p.action === 'longjump') { accel = 3; maxS = Math.max(hs, 4); }
    if (p.action === 'backflip') accel = 6;
    const tvx = mx * maxS, tvz = mz * maxS;
    if (!air && mag > 0.1 && hs > 6 && Math.abs(angDiff(Math.atan2(p.vel.x, p.vel.z), Math.atan2(mx, mz))) > 2.4) {
      // skid turn
      p.vel.x *= 1 - dt * 12; p.vel.z *= 1 - dt * 12; if (Math.random() < 0.5) burst(p.pos, { n: 1, color: 0xd8c8a8, speed: 2, life: 0.4 });
    } else {
      const dvx = tvx - p.vel.x, dvz = tvz - p.vel.z, dl = Math.hypot(dvx, dvz), mxs = accel * dt;
      if (dl > mxs) { p.vel.x += dvx / dl * mxs; p.vel.z += dvz / dl * mxs; } else { p.vel.x = tvx; p.vel.z = tvz; }
    }
    if (mag > 0.1 && p.action !== 'longjump' && p.action !== 'backflip' && !p.crouching) {
      const want = Math.atan2(mx, mz); p.facing += angDiff(p.facing, want) * Math.min(1, dt * (air ? 6 : 14));
    }
    // jump
    if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) doJump();
    else if (p.jumpBuf > 0 && air && p.wallN && G.time - p.wallT < 0.2 && p.wallSpeed > 2) { // wall kick
      p.vel.x = p.wallN.x * 9; p.vel.z = p.wallN.z * 9; p.vel.y = 14; p.facing = Math.atan2(p.wallN.x, p.wallN.z);
      startAction('jump3'); p.jumpKind = 3; p.jumpBuf = 0; p.airSlashed = false; sfx.jump3(); p.wallN = null;
      burst(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 6, color: 0xffffff, speed: 3, life: 0.3 });
    }
    // variable jump height
    if (!input.jump && p.vel.y > 5 && p.action === 'jump' && !p.cutJump) { p.vel.y *= 0.55; p.cutJump = true; }
    // ground pound
    if (input.crouchP && air && p.action !== 'longjump') { startAction('gpStart'); sfx.jump2(); }
    // slash
    if (input.attackP) {
      if (air && !p.airSlashed) { p.airSlashed = true; p.vel.y = Math.max(p.vel.y, 4); startAction('slash'); p.slashHit = false; sfx.slash(); slashFx.userData.t = 0; }
      else if (!air) {
        p.combo = (G.time - (p.lastSlash || -9) < 0.5) ? (p.combo + 1) % 3 : 0; p.lastSlash = G.time;
        startAction('slash'); p.slashHit = false; sfx.slash(); slashFx.userData.t = 0;
        const lunge = p.combo === 2 ? 7 : 4.5; p.vel.x = Math.sin(p.facing) * lunge; p.vel.z = Math.cos(p.facing) * lunge;
      }
    }
  }
  input.jumpP = input.attackP = input.crouchP = input.talkP = false;

  // gravity
  if (!p.swimming && p.action !== 'gpStart' && p.action !== 'star') p.vel.y = Math.max(p.vel.y - GRAV * dt, -MAX_FALL);

  // carried by moving platform
  if (p.onGround && p.ground && p.ground.vel) p.pos.add(p.ground.vel);

  const wasGround = p.onGround;
  moveBody(p, dt);
  if (p.wallN && !p.onGround) p.wallT = G.time;
  if (p.bonk && p.bonk.crate) breakCrate(p.bonk.crate);

  if (p.onGround) {
    if (!wasGround) { // landing
      p.lastLand = G.time; p.squash = 0.28;
      if (p.action === 'gpFall') {
        startAction('gpLand'); sfx.pound(); ringFx(p.pos, { max: 2.6 }); shake = 0.2;
        burst(p.pos, { n: 10, color: 0xe8dcc0, speed: 5, life: 0.5 });
        if (p.ground && p.ground.crate) breakCrate(p.ground.crate);
        for (const c of crates) if (c.alive && Math.hypot(c.o.position.x - p.pos.x, c.o.position.z - p.pos.z) < 2.6 && Math.abs(c.o.position.y - p.pos.y) < 1.5) breakCrate(c);
      } else if (['jump', 'jump3', 'backflip', 'longjump', 'slash'].includes(p.action)) startAction('normal');
      if (p.ground && p.ground.spring) {
        p.vel.y = 24; p.onGround = false; startAction('jump3'); p.jumpKind = 0; sfx.spring(); p.ground.springRef.t = 0.4; p.airSlashed = false;
      }
    }
    if (p.jumpKind && G.time - p.lastLand > 0.22) p.jumpKind = 0;
    if (!water || p.floorY > (water ?? -99)) { if (!p.ground || !p.ground.vel) p.lastSafe.copy(p.pos); }
  }
  // fell into the void
  if (p.pos.y < -25) { hurtPlayer(2, p.pos); p.pos.copy(p.lastSafe).add(new THREE.Vector3(0, 2, 0)); p.vel.set(0, 0, 0); }
  // keep in world bounds (sea)
  const rr = Math.hypot(p.pos.x, p.pos.z); if (rr > 100) { p.pos.x *= 100 / rr; p.pos.z *= 100 / rr; }
  // checkpoints
  for (const f of flags) if (!f.on && p.pos.distanceTo(f.pos) < 2.5) {
    f.on = true; G.checkpoint.copy(f.pos).add(new THREE.Vector3(1.5, 0.2, 0)); sfx.redcoin(); toast('Checkpoint!', 1.4);
    burst(f.pos.clone().add(new THREE.Vector3(0, 2.5, 0)), { n: 12, color: 0x66ff88, speed: 4 });
  }
  // lost cherry tomato kids
  for (const k of kids) if (!k.found && p.pos.distanceTo(k.root.position) < 1.6) {
    k.found = true; G.kids++; sfx.redcoin(); toast(`"Thank you, Capitano!" (${G.kids}/5 found)`, 2.2);
    burst(k.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)), { n: 16, color: 0xff6655, speed: 5 });
    const a = (G.kids / 5) * Math.PI * 2; k.root.position.set(mamma.pos.x + Math.cos(a) * 2.6, groundHeight(mamma.pos.x, mamma.pos.z), mamma.pos.z + Math.sin(a) * 2.6);
    if (G.kids === 5) spawnStar('kids', new THREE.Vector3(mamma.pos.x, 4.5, mamma.pos.z - 4));
  }
  animatePlayer(dt);
}
function slashHits() {
  const p = player, fx = Math.sin(p.facing), fz = Math.cos(p.facing);
  const spin = !p.onGround || p.combo === 2;
  for (const e of enemies) {
    if (!e.alive || e.state === 'swim') continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz), dy = e.pos.y - p.pos.y;
    const reach = (e.kind === 'boss' ? e.r + 2 : 2.6);
    if (d > reach || dy > 2 || dy < -(e.h || 1.5)) continue;
    if (!spin && d > 0.8 && (dx * fx + dz * fz) / d < 0.2) continue;
    if (e.kind === 'boss') { if (e.state === 'stunned') hitBoss(); else { sfx.hit(); toast('Too tough! Make him dizzy first!', 1.5); } }
    else killEnemy(e, 'slash');
  }
  for (const c of crates) {
    if (!c.alive) continue; const cp = c.o.position; const d = Math.hypot(cp.x - p.pos.x, cp.z - p.pos.z);
    if (d < 2.3 && Math.abs(cp.y - p.pos.y) < 1.6) breakCrate(c);
  }
}
let shake = 0;
function animatePlayer(dt) {
  const p = player, pv = pPivot;
  pRoot.position.copy(p.pos); pRoot.rotation.y = p.facing;
  p.squash = lerp(p.squash, 0, Math.min(1, dt * 10));
  let sy = 1 + p.squash * (p.squash > 0 ? -1 : -1), sxz = 1 - (sy - 1) * 0.5;
  let rx = 0, rz = 0, ry = 0, bob = 0;
  const hs = Math.hypot(p.vel.x, p.vel.z);
  switch (p.action) {
    case 'jump3': rx = Math.min(1, p.at / 0.55) * Math.PI * 2; break;
    case 'backflip': rx = -Math.min(1, p.at / 0.7) * Math.PI * 2; break;
    case 'longjump': rx = 1.1; break;
    case 'gpStart': rx = Math.min(1, p.at / 0.28) * Math.PI * 2; break;
    case 'gpFall': sy = 1.15; sxz = 0.9; break;
    case 'gpLand': sy = 0.7; sxz = 1.2; break;
    case 'slash': ry = (p.onGround && p.combo < 2 ? (p.combo === 0 ? -1 : 1) * Math.sin(Math.min(1, p.at / 0.2) * Math.PI) * 1.2 : Math.min(1, p.at / 0.25) * Math.PI * 2); break;
    case 'hurt': rx = -0.5; break;
    case 'star': ry = Math.min(1, p.at / 0.6) * Math.PI * 2; bob = Math.sin(Math.min(1, p.at / 0.6) * Math.PI) * 1.2; break;
    default:
      if (p.onGround && hs > 0.5) { p.runT = (p.runT || 0) + dt * hs * 1.5; bob = Math.abs(Math.sin(p.runT)) * 0.18; rz = Math.sin(p.runT) * 0.12; rx = hs / RUN * 0.2; }
      if (p.crouching) { sy = 0.72; sxz = 1.15; }
      if (p.swimming) { rx = 0.5; bob = Math.sin(G.time * 5) * 0.08 - 0.3; }
      if (!p.onGround && !p.swimming) rx = clamp(-p.vel.y * 0.015, -0.2, 0.25);
  }
  if (p.dead) { ry = G.dieT * 12; sy = Math.max(0.1, 1 - G.dieT * 0.4); }
  pv.rotation.set(rx, ry, rz); pv.position.y = 0.8 * sy + bob; pv.scale.set(sxz, sy, sxz);
  pRoot.visible = !(p.invuln > 0 && !p.dead && Math.floor(p.invuln * 15) % 2 === 0);
  // slash fx
  const st = slashFx.userData.t ?? 9; slashFx.userData.t = st + dt;
  slashFx.material.opacity = Math.max(0, 0.85 - st * 4); slashFx.scale.setScalar(0.7 + st * 2.5);
  slashFx.rotation.z = st * 9 - 0.6;
  // blob shadow
  const f = floorAt(p.pos.x, p.pos.z, p.pos.y + 0.1, 0.3); const wl = waterLevelAt(p.pos.x, p.pos.z);
  const fy = Math.max(f.y, wl ?? -99); const hgt = p.pos.y - fy;
  blob.position.set(p.pos.x, fy + 0.04, p.pos.z); blob.scale.setScalar(clamp(1 - hgt * 0.05, 0.4, 1)); blob.visible = hgt < 30;
}

// ---------------------------------------------------------------------------
// Star collection
// ---------------------------------------------------------------------------
function collectStar(id) {
  const first = !G.stars.has(id);
  G.stars.add(id); saveGame(); delete starMeshes[id];
  G.mode = 'starget'; G.starT = 0; startAction('star'); player.vel.set(0, 0, 0);
  sfx.star(); setHealth(8);
  burst(player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), { n: 40, color: 0xffe066, speed: 9, life: 1.2 });
  banner(`STAR GET!<small>${STAR_NAMES[id]}${first ? '' : ' (again)'}</small>`, 3);
}

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------
const kids = []; let mamma = null;
const ARENA = { x0: -10, x1: 10, z0: -55, z1: -37, y: 12 };
function buildLevel() {
  // --- Mount Grill (north) ---
  terrainBox(-22, 22, -2, 3, -58, -22);
  terrainBox(-18, 18, 2, 6, -57, -29);
  terrainBox(-14, 14, 5, 9, -56, -34);
  terrainBox(-10, 10, 8, 12, -55, -37);
  ramp(12, 16, -22, -11, 0, -0.2, 3, 'z', -1);  // ground -> T1
  ramp(-16, -12, -29, -22, 3, 3, 6, 'z', -1);   // T1 -> T2
  ramp(6, 10, -34, -29, 6, 6, 9, 'z', -1);      // T2 -> T3
  terrainBox(10, 13.5, 8.5, 10.5, -45, -41);    // step T3 -> T4
  // summit decor
  place('poles', -9, 12, -54, { s: 2 }); place('poles', 9, 12, -54, { s: 2 });
  place('rocks', -8, 12, -38.5, { s: 2.5, solid: true, shrink: 0.3 });
  makeBoss(0, 12, -48, ARENA);
  // mountain decor & coins
  place('tree-pine', -20, 3, -55, { s: 2.6 }); place('tree-pine', 20, 3, -56, { s: 2.4 }); place('tree-pine', -20.5, 3, -24, { s: 2.2 });
  place('rocks', 19, 3, -26, { s: 2.5, solid: true, shrink: 0.3 }); place('mushrooms', -16, 6, -52, { s: 2.5 });
  coinLine([14, 0.6, -13], [14, 3.6, -21], 5);
  coinLine([-20, 3.6, -30], [-20, 3.6, -54], 8);
  coinLine([-10, 6.6, -31], [5, 6.6, -31], 6);
  coinRing(0, 12.8, -46, 6, 8);
  steak(0, -25, { y: 3, range: 4 }); steak(19.5, -42, { y: 3, range: 3 }); steak(-6, -31.5, { y: 6, cooked: true, range: 3 }); steak(-12, -46, { y: 9, cooked: true, range: 3 });
  pepper(-12, 10, -53);
  pepper(0, 1.2, -64);
  checkpoint(14, 6, -32); checkpoint(12, 12, -39);
  kidAt(-15.5, 6, -48);
  npc('leek', 'Porro the Guard', 9, -13, 3.6, () => G.stars.has('boss') ? ['Mount Grill is quiet again. You are a legend, Capitano!'] : [
    'HALT! Oh — it is you, Capitan Pachino!',
    'King Steak has crowned himself ruler of Mount Grill. He sits on the summit, guarding a Golden Star.',
    'Follow the ramps up the terraces. Up top, let him charge into the edge — when he is dizzy, jump on his head!',
  ], { eyes: { hf: 0.55 } });

  // --- Sky Carrot Tower (west) ---
  const TC = { x: -46, z: 0 };
  terrainBox(TC.x - 3, TC.x + 3, -1, 26, TC.z - 3, TC.z + 3, { mat: 'stone' });
  const giant = place('carrot', TC.x, 26, TC.z, { s: 0.01 }); giant.visible = false; // anchor
  for (let i = 0; i < 17; i++) {
    const a = -0.3 + i * 0.7, R = 7.5, x = TC.x + Math.cos(a) * R, z = TC.z + Math.sin(a) * R, y = 1.5 * (i + 1) - 0.4;
    if (i === 6 || i === 12) {
      const ph = i * 0.7; mover('block-moving-blue', new THREE.Vector3(x, y - 0.6, z), (t) => new THREE.Vector3(0, Math.sin(t * 1.4 + ph) * 1.2, 0), [3, 2, 3]);
    } else {
      const o = place('platform', x, y - 0.4, z, { s: 3, solid: true }); o.scale.y = 2; o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o); Object.assign(o.userData.solid.max, { y: b.max.y });
    }
    if (i === 9) spring(x, y, z);
    else if (i === 8) pepper(x, y + 1, z);
    else if (i === 4) kidAt(x, y, z);
    else coin(x, y + 0.8, z);
  }
  spawnStar('tower', new THREE.Vector3(TC.x, 26.8, TC.z), { silent: true });
  checkpoint(TC.x + 9, 0, TC.z + 5);
  npc('carrot', 'Captain Carota', -38, 7, 3.4, () => G.stars.has('tower') ? ['The view from the top is amazing, right? I get dizzy just looking!'] : [
    'Ahoy, Capitano! I am Captain Carota of the Sky Carrot Tower.',
    'A Golden Star landed on the very top. Hop up the spiral of platforms!',
    'The blue blocks go up and down — time your jumps. And the spring will send you flying!',
  ], { eyes: { hf: 0.7, spread: 0.12, size: 0.07 } });
  heartPickup(-38, 0.4, 0);

  // --- Village (center) ---
  mamma = npc('tomato', 'Mamma Pomodoro', -7, 16, 12, () => {
    if (G.stars.has('kids') || G.kids >= 5) return ['All my little cherry tomatoes are home! Grazie mille, Capitano!'];
    if (G.kids > 0) return [`You found ${G.kids} of my babies! ${5 - G.kids} are still out there…`, 'One went to the beach, one to the tower, one to the mountain, one to the crates and one behind the lake!'];
    return ['Oh, Capitano! Mamma mia, what a disaster!', 'My five little cherry tomatoes ran off to play and the steaks scared them away!', 'Please find them! Just touch them and they will roll right back home to me.'];
  }, { eyes: { hf: 0.6, size: 0.1 } });
  npc('cauliflower', 'Signor Cavolfiore', 8, 14, 5, () => {
    const left = enemies.filter((x) => x.kind === 'steak' && x.alive).length;
    if (left === 0) return ['Not a single steak left in the garden! You did it!'];
    return ['Those raw steaks keep trampling my flowerbeds!', `There are ${left} of them roaming around — in the village, on Mount Grill and near the crates.`, 'Stomp them or give them a taste of your sword! Get them all and I will give you a reward.'];
  }, { eyes: { hf: 0.55 } });
  terrainBox(-1.5, 1.5, -1, 0.8, 6.5, 9.5, { mat: 'stone' });
  coinRing(0, 0.8, 8, 4.5, 8);
  // fences & decor
  for (let i = -3; i <= 3; i++) { if (Math.abs(i) <= 1) continue; place('fence-straight', i * 2, 0, 24, { s: 2 }); }
  place('hedge', -12, 0, 12, { s: 2.4, solid: true }); place('hedge', 12, 0, 20, { s: 2.4, r: Math.PI, solid: true });
  for (const [x, z] of [[-4, 22], [5, 21], [-10, 6], [11, 5], [3, 2], [-3, 13]]) place('flowers', x, groundHeight(x, z), z, { s: 2.5 });
  for (const [x, z] of [[-14, 18], [14, 10], [-2, 28], [8, 30]]) place('flowers-tall', x, groundHeight(x, z), z, { s: 2.5 });
  place('barrel', 10, 0, 18, { s: 2.4, solid: true }); place('barrel', 11.4, 0, 17, { s: 2.4, solid: true });
  place('sign', 3, 0, 34, { s: 2.5, r: 0 });
  coinLine([0, 0.7, 44], [0, 0.7, 30], 8);
  coinLine([-12, 0.7, 30], [-4, 0.7, 30], 5); coinLine([4, 0.7, 4], [12, 0.7, 4], 5);
  steak(-16, 28, { range: 6 }); steak(17, 30, { range: 6 });
  heartPickup(-3, 0.5, 30);
  // two pillars (wall-kick / backflip challenge) with a pepper on top
  terrainBox(-23, -20, -1, 5.2, 7, 10);
  terrainBox(-18, -15.5, -1, 3.0, 7, 10);
  pepper(-21.5, 6.2, 8.5);

  // --- Spawn ---
  checkpoint(-3.5, 0, 53);
  npc('broccoli', 'Nonno Broccolo', 5, 48, 4, () => [
    `Ah, Capitan Pachino! Welcome back to the Garden Isle!`,
    'While you were at sea, the steaks and the fish took over and scattered the 7 Golden Stars!',
    'Use WASD or a stick to run, Space to jump. Jump again right as you land to go higher — three times for a triple jump!',
    'Shift crouches. In the air it does a mighty ground pound — great for breaking crates and squashing steaks.',
    'Run, crouch and jump for a long jump. Crouch and jump while standing for a backflip. J or Click swings your sword!',
    `Talk to every vegetable you meet — they all need your help. You have ${G.stars.size} of 7 stars. Coraggio!`,
  ], { eyes: { hf: 0.62 } });

  // --- Lake Lattuga (east) ---
  for (let i = 0; i < 5; i++) fish(i);
  const pads = [[POND.x - 7, POND.z - 3], [POND.x - 2, POND.z - 7], [POND.x + 4, POND.z - 4], [POND.x, POND.z + 1], [POND.x + 6, POND.z + 5], [POND.x - 4, POND.z + 6]];
  const padMat = new THREE.MeshLambertMaterial({ color: 0x4fb04a });
  for (const [x, z] of pads) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 18, 1, false, 0.3, Math.PI * 2 - 0.6), padMat);
    m.position.set(x, POND.level + 0.05, z); m.receiveShadow = m.castShadow = true; scene.add(m);
    addSolid({ x: x - 1.4, y: POND.level - 3, z: z - 1.4 }, { x: x + 1.4, y: POND.level + 0.18, z: z + 1.4 });
  }
  pepper(POND.x, POND.level + 1.2, POND.z + 1);
  coinRing(POND.x, 1.6, POND.z, 9, 10);
  npc('eggplant', 'Signora Melanzana', 22.5, 14, 4.2, () => G.stars.has('fish') && G.fishKilled >= 5 ? ['The lake is peaceful again. I can finally go for a swim!'] : [
    'Psst, Capitano! Those nasty fish in Lake Lattuga leap out and bite anyone who comes near!',
    `Bop them while they are in the air — jump on them or swing your sword. ${5 - G.fishKilled} of them are still out there.`,
    'Teach them all a lesson and the lake will give you its treasure.',
  ], { eyes: { hf: 0.6 } });
  kidAt(55, 0, 12);
  place('rocks', 30, groundHeight(30, -6), -6, { s: 2.5, solid: true, shrink: 0.3 });

  // --- Crate Field (south-east) ---
  const cr = [[30, 36], [33.5, 36], [37, 36], [30, 40], [37, 40], [30, 44], [33.5, 44], [37, 44], [33.5, 40]];
  cr.forEach(([x, z], i) => crate(x, z, i === 4 ? 'pepper' : i === 8 ? 'heart' : 'coins'));
  crate(41, 38, 'pepper'); crate(41, 38, 'coins', groundHeight(41, 38) + 1.4);
  steak(28, 31, { cooked: true, range: 5 }); steak(44, 44, { range: 5 });
  kidAt(44, 50, 0);
  npc('pumpkin', 'Zia Zucca', 25, 47, 5, [
    'Hello, dear! These crates washed up from a shipwreck. Who knows what is inside?',
    'Ground pound them — jump, then press Shift in the air — or slash them with your sword!',
    'I heard Red Peppers are hidden around the isle. Find all 8 and a star will appear on the stone in the village!',
  ], { eyes: { hf: 0.5 } });

  // --- Beach & misc ---
  kidAt(14, 0, 66);
  pepper(60, 1.0, -30);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; coin(Math.cos(a) * 73, groundHeight(Math.cos(a) * 73, Math.sin(a) * 73) + 0.7, Math.sin(a) * 73); }
  npc('corn', 'Pannocchia', -30, 50, 5, () => [
    'Pop! Pop! Hi there, Capitano!',
    `You have ${G.coins} coins. Collect 100 and a Golden Star will pop out — just like popcorn!`,
    'Every 50 coins also gives you an extra life. Coins heal you too!',
  ], { eyes: { hf: 0.55 } });
  coinLine([-36, 0.7, 44], [-24, 0.7, 44], 6);
  heartPickup(10, 0.5, -16);

  // trees & decor scattered (avoid play zones)
  const zones = [[-25, 25, -62, -8], [-56, -34, -12, 12], [-16, 16, 0, 36], [POND.x - 17, POND.x + 17, POND.z - 17, POND.z + 17], [24, 48, 28, 52], [-8, 8, 36, 60], [-26, -12, 4, 14]];
  const blocked = (x, z) => zones.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 46; tries++) {
    const a = rand() * Math.PI * 2, r = 12 + rand() * 54, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    const t = rand() < 0.5 ? 'tree' : 'tree-pine', s = 2.2 + rand() * 1.2;
    place(t, x, groundHeight(x, z) - 0.05, z, { s, r: rand() * 6 });
    addSolid({ x: x - 0.45, y: -2, z: z - 0.45 }, { x: x + 0.45, y: groundHeight(x, z) + 4, z: z + 0.45 });
    placed++;
  }
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = 8 + rand() * 58, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1) continue;
    const t = ['grass', 'grass', 'flowers', 'mushrooms', 'plant', 'stones'][(rand() * 6) | 0];
    if (x > -22 && x < 22 && z > -58 && z < -22) continue;
    place(t, x, groundHeight(x, z), z, { s: 2.2, r: rand() * 6 });
  }
  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x666666 });
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group(); const a = rand() * Math.PI * 2, r = 40 + rand() * 120;
    for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rand() * 3, 0), cloudMat); s.position.set(k * 3.5 - 5, rand() * 1.5, rand() * 2); s.scale.y = 0.6; g.add(s); }
    g.position.set(Math.cos(a) * r, 34 + rand() * 25, Math.sin(a) * r); g.userData.v = 0.5 + rand(); scene.add(g); clouds.push(g);
  }
  // ghost stars for already collected missions that are always available
  G.coinStarSpawned = false;
}
const clouds = [];
function kidAt(x, y, z) {
  const root = new THREE.Group(); root.position.set(x, y, z); scene.add(root);
  const b = inst('tomato', 4.5); root.add(b); addEyes(b, { hf: 0.6, size: 0.14 });
  const k = { root, b, found: false, t: rand() * 5 }; kids.push(k); return k;
}
function updateKids(dt) {
  for (const k of kids) {
    k.t += dt; k.b.position.y = Math.abs(Math.sin(k.t * (k.found ? 5 : 3))) * (k.found ? 0.4 : 0.25);
    if (!k.found) k.root.rotation.y += dt * 1.5;
    else k.root.rotation.y = Math.atan2(player.pos.x - k.root.position.x, player.pos.z - k.root.position.z);
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camState = { yaw: 0, pitch: 0.36, dist: 12, target: new THREE.Vector3(), manualT: 9, snap: true, pos: new THREE.Vector3() };
function solidAt(x, y, z) {
  if (y < groundHeight(x, z) + 0.3) return true;
  for (const s of solids) if (x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z && y > s.min.y && y < topAt(s, x, z) + 0.2 && s.mesh) return true;
  return false;
}
function updateCamera(dt) {
  const c = camState, p = player;
  c.yaw += input.camX * dt * 2.6; c.pitch = clamp(c.pitch + input.camY * dt * 1.6, -0.15, 1.2);
  if (Math.abs(input.camX) > 0.05 || Math.abs(input.camY) > 0.05) c.manualT = 0; else c.manualT += dt;
  // gentle auto-follow behind the captain while running
  const hs = Math.hypot(p.vel.x, p.vel.z);
  if (c.manualT > 1.2 && hs > 2 && G.mode === 'play') {
    const behind = Math.atan2(-p.vel.x, -p.vel.z) + Math.PI * 0; // camera sits opposite the velocity
    const want = Math.atan2(-Math.sin(p.facing), -Math.cos(p.facing));
    c.yaw += angDiff(c.yaw, want + Math.PI * 0) * 0; // placeholder (disabled hard lock)
    const yawWant = Math.atan2(Math.sin(p.facing + Math.PI), Math.cos(p.facing + Math.PI));
    const d = angDiff(c.yaw, yawWant); if (Math.abs(d) < 2.5) c.yaw += d * Math.min(1, dt * 0.6 * (hs / RUN));
    void behind;
  }
  const tgt = p.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
  if (c.snap) { c.target.copy(tgt); }
  c.target.x = lerp(c.target.x, tgt.x, Math.min(1, dt * 10)); c.target.z = lerp(c.target.z, tgt.z, Math.min(1, dt * 10));
  c.target.y = lerp(c.target.y, tgt.y, Math.min(1, dt * (p.onGround ? 6 : 2.5)));
  if (Math.abs(c.target.y - tgt.y) > 6) c.target.y = tgt.y + Math.sign(c.target.y - tgt.y) * 6;
  const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
  // pull in if blocked
  let dist = c.dist;
  for (let s = 1.5; s <= c.dist; s += 0.5) {
    const q = c.target.clone().addScaledVector(off, s);
    if (solidAt(q.x, q.y, q.z)) { dist = Math.max(1.5, s - 0.6); break; }
  }
  c.curDist = c.snap ? dist : lerp(c.curDist ?? dist, dist, Math.min(1, dt * (dist < (c.curDist ?? dist) ? 12 : 3)));
  const want = c.target.clone().addScaledVector(off, c.curDist);
  const wl = waterLevelAt(want.x, want.z); if (wl !== null && want.y < wl + 0.4) want.y = wl + 0.4;
  c.pos.copy(want); c.snap = false;
  camera.position.copy(c.pos);
  if (shake > 0) { shake -= dt; camera.position.x += (rand() - 0.5) * shake; camera.position.y += (rand() - 0.5) * shake; }
  camera.lookAt(c.target);
}

// ---------------------------------------------------------------------------
// Input: keyboard, mouse, gamepad
// ---------------------------------------------------------------------------
const keys = new Set();
const KEYMAP = { jump: ['Space', 'KeyK'], crouch: ['ShiftLeft', 'ShiftRight', 'KeyZ'], attack: ['KeyJ', 'KeyX'], talk: ['KeyE'] };
window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys.add(e.code); initAudio();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (G.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) { startGame(); return; }
  if (G.mode === 'dialog' && ['Space', 'KeyE', 'KeyJ', 'Enter', 'KeyK'].includes(e.code)) { advanceDialog(); return; }
  if (e.code === 'Escape' || e.code === 'KeyP' || (e.code === 'Enter' && (G.mode === 'play' || G.mode === 'pause'))) { togglePause(); return; }
  if (e.code === 'KeyM') toast(toggleMute() ? 'Sound off' : 'Sound on', 1.2);
  if (KEYMAP.jump.includes(e.code)) input.jumpP = true;
  if (KEYMAP.crouch.includes(e.code)) input.crouchP = true;
  if (KEYMAP.attack.includes(e.code)) input.attackP = true;
  if (KEYMAP.talk.includes(e.code)) input.talkP = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
let mouseDrag = false;
renderer.domElement.addEventListener('mousedown', (e) => {
  initAudio();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode === 'dialog') { advanceDialog(); return; }
  if (G.mode !== 'play') return;
  if (document.pointerLockElement === renderer.domElement) { if (e.button === 0) input.attackP = true; }
  else { mouseDrag = true; renderer.domElement.requestPointerLock?.(); }
});
window.addEventListener('mouseup', () => (mouseDrag = false));
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement || mouseDrag) {
    camState.yaw -= e.movementX * 0.0032; camState.pitch = clamp(camState.pitch + e.movementY * 0.0025, -0.15, 1.2); camState.manualT = 0;
  }
});
window.addEventListener('wheel', (e) => { camState.dist = clamp(camState.dist + Math.sign(e.deltaY) * 1.2, 6, 20); }, { passive: true });
$('dialog').addEventListener('mousedown', (e) => { e.stopPropagation(); advanceDialog(); });
$('title').addEventListener('mousedown', () => { initAudio(); if (G.mode === 'title') startGame(); });

// ---- Touch controls: left thumb = stick, drag elsewhere = camera, on-screen buttons ----
const touch = { on: false, x: 0, y: 0, jump: false, crouch: false, stickId: null, camId: null, ox: 0, oy: 0, lx: 0, ly: 0 };
const stickEl = $('stick'), knobEl = $('knob');
function enableTouch() {
  if (touch.on) return; touch.on = true; document.body.classList.add('touch');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enableTouch();
function stickHome() { stickEl.style.left = ''; stickEl.style.top = ''; stickEl.style.bottom = ''; knobEl.style.transform = ''; }
function onTouchStart(e) {
  e.preventDefault(); initAudio(); enableTouch();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode === 'dialog') { advanceDialog(); return; }
  if (G.mode !== 'play' && G.mode !== 'starget') return;
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth * 0.42 && touch.stickId === null) {
      touch.stickId = t.identifier; touch.ox = t.clientX; touch.oy = t.clientY; touch.x = touch.y = 0;
      stickEl.style.left = (t.clientX - 62) + 'px'; stickEl.style.top = (t.clientY - 62) + 'px'; stickEl.style.bottom = 'auto';
    } else if (touch.camId === null) { touch.camId = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
  }
}
function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touch.stickId) {
      let dx = (t.clientX - touch.ox) / 52, dy = (t.clientY - touch.oy) / 52; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      touch.x = Math.abs(dx) < 0.12 ? 0 : dx; touch.y = Math.abs(dy) < 0.12 ? 0 : -dy;
      knobEl.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    } else if (t.identifier === touch.camId) {
      camState.yaw -= (t.clientX - touch.lx) * 0.007; camState.pitch = clamp(camState.pitch + (t.clientY - touch.ly) * 0.005, -0.15, 1.2);
      camState.manualT = 0; touch.lx = t.clientX; touch.ly = t.clientY;
    }
  }
}
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touch.stickId) { touch.stickId = null; touch.x = touch.y = 0; stickHome(); }
    if (t.identifier === touch.camId) touch.camId = null;
  }
}
for (const el of [renderer.domElement, $('title')]) el.addEventListener('touchstart', onTouchStart, { passive: false });
renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
window.addEventListener('touchend', onTouchEnd); window.addEventListener('touchcancel', onTouchEnd);
function touchButton(id, down, up) {
  const el = $(id);
  el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); initAudio(); el.classList.add('on'); down(); }, { passive: false });
  const end = (e) => { e.preventDefault(); el.classList.remove('on'); if (up) up(); };
  el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', end, { passive: false });
}
touchButton('tJump', () => { touch.jump = true; if (G.mode === 'dialog') advanceDialog(); else input.jumpP = true; }, () => (touch.jump = false));
touchButton('tCrouch', () => { touch.crouch = true; input.crouchP = true; }, () => (touch.crouch = false));
touchButton('tSlash', () => { if (G.mode === 'dialog') advanceDialog(); else input.attackP = true; });
touchButton('tPause', () => togglePause());
touchButton('prompt', () => { input.talkP = true; });
const padPrev = {};
function pollInput() {
  let x = 0, y = 0;
  if (keys.has('KeyA')) x -= 1; if (keys.has('KeyD')) x += 1; if (keys.has('KeyW')) y += 1; if (keys.has('KeyS')) y -= 1;
  let cx = 0, cy = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyQ')) cx += 1; if (keys.has('ArrowRight')) cx -= 1;
  if (keys.has('ArrowUp')) cy += 1; if (keys.has('ArrowDown')) cy -= 1;
  let jump = KEYMAP.jump.some((k) => keys.has(k)) || touch.jump, crouch = KEYMAP.crouch.some((k) => keys.has(k)) || touch.crouch;
  x += touch.x; y += touch.y;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    x += dz(gp.axes[0]); y -= dz(gp.axes[1]); cx -= dz(gp.axes[2] || 0); cy += dz(gp.axes[3] || 0);
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    const edge = (i) => { const k = gp.index + ':' + i; const now = b(i); const was = padPrev[k]; padPrev[k] = now; return now && !was; };
    if (b(12)) y += 1; if (b(13)) y -= 1; if (b(14)) x -= 1; if (b(15)) x += 1;
    if (b(0)) jump = true; if ([4, 5, 6, 7].some(b)) crouch = true;
    if (edge(0)) { initAudio(); if (G.mode === 'title') startGame(); else if (G.mode === 'dialog') advanceDialog(); else input.jumpP = true; }
    if (edge(2) || edge(1)) { if (G.mode === 'dialog') advanceDialog(); else input.attackP = true; }
    if (edge(3)) input.talkP = true;
    if (edge(4) | edge(5) | edge(6) | edge(7)) input.crouchP = true;
    if (edge(9)) togglePause();
  }
  const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
  input.x = x; input.y = y; input.camX = clamp(cx, -1, 1); input.camY = clamp(cy, -1, 1); input.jump = jump; input.crouch = crouch;
}

// ---------------------------------------------------------------------------
// Screens & flow
// ---------------------------------------------------------------------------
function startGame() {
  $('title').style.display = 'none'; document.body.classList.add('playing'); G.mode = 'play'; initAudio(); startMusic(); camState.snap = true;
  toast('Talk to Nonno Broccolo!', 3);
}
function togglePause() {
  if (G.mode === 'play') {
    G.mode = 'pause'; sfx.pause(); document.exitPointerLock?.();
    $('starlist').innerHTML = STAR_ORDER.map((id) => `<li class="${G.stars.has(id) ? 'got' : 'no'}">${G.stars.has(id) ? '★' : '☆'} ${STAR_NAMES[id]}</li>`).join('');
    $('pause').style.display = 'flex';
  } else if (G.mode === 'pause') { G.mode = 'play'; $('pause').style.display = 'none'; sfx.pause(); }
}
$('resume').onclick = () => togglePause();
$('continue').onclick = () => { $('gameover').style.display = 'none'; G.lives = 4; G.mode = 'play'; respawnFresh(); };
$('keepplaying').onclick = () => { $('ending').style.display = 'none'; G.mode = 'play'; };
function respawnFresh() { player.pos.copy(G.checkpoint); player.vel.set(0, 0, 0); player.dead = false; player.action = 'normal'; player.invuln = 2; setHealth(8); pPivot.rotation.set(0, 0, 0); camState.snap = true; }

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.fov = camera.aspect < 1 ? 72 : 55; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let acc = 0; const STEP_DT = 1 / 120;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  pollInput();
  G.time += dt;
  if (G.mode === 'title') {
    const a = G.time * 0.15;
    camera.position.set(SPAWN.x + Math.sin(a) * 9, 3.2, SPAWN.z + Math.cos(a) * 9); camera.lookAt(SPAWN.x, 1.4, SPAWN.z);
    pRoot.position.copy(player.pos); pRoot.rotation.y = a + 0.4; pPivot.position.y = 0.8 + Math.abs(Math.sin(G.time * 3)) * 0.2;
  } else if (G.mode !== 'loading') {
    const sim = G.mode === 'play' || G.mode === 'starget' || G.mode === 'dying';
    if (sim) {
      acc += dt;
      while (acc >= STEP_DT) {
        acc -= STEP_DT;
        updateMovers(STEP_DT);
        if (G.mode === 'play' || G.mode === 'starget') updatePlayer(STEP_DT);
        for (const e of enemies) {
          if (e.gone) continue;
          if (e.kind === 'steak') updateSteak(e, STEP_DT); else if (e.kind === 'fish') updateFish(e, STEP_DT); else updateBoss(e, STEP_DT);
        }
      }
      if (healQueue > 0) { G.healT = (G.healT || 0) - dt; if (G.healT <= 0) { G.healT = 0.12; healQueue--; if (G.health < 8) setHealth(G.health + 1); } }
    }
    if (G.mode === 'dialog') updateDialog(dt);
    if (G.mode === 'starget') {
      G.starT += dt;
      if (G.starT > 2.8) {
        G.mode = 'play'; startAction('normal');
        if (G.stars.size >= 7 && !G.endingShown) { G.endingShown = true; G.mode = 'ending'; $('ending').style.display = 'flex'; document.exitPointerLock?.(); }
      }
    }
    if (G.mode === 'dying') {
      G.dieT += dt; animatePlayer(dt);
      $('fade').classList.toggle('on', G.dieT > 1.4);
      if (G.dieT > 2) { $('fade').classList.remove('on'); respawn(); }
    }
    updateItems(dt); updateParticles(dt); updateRings(dt); updateNPCs(dt); updateKids(dt);
    for (const s of springs) { s.t = Math.max(0, s.t - dt); s.o.scale.y = 2.6 * (1 - Math.sin(s.t / 0.4 * Math.PI) * 0.4); }
    for (const f of flags) if (f.on) f.o.rotation.y = Math.sin(G.time * 2) * 0.2;
    if (G.mode !== 'pause') updateCamera(dt);
    updateHUD(dt);
  }
  for (const c of clouds) { c.position.x += c.userData.v * dt; if (c.position.x > 160) c.position.x = -160; }
  texWater.offset.x = G.time * 0.01; texWater.offset.y = Math.sin(G.time * 0.5) * 0.01;
  // sun follows the player so shadows stay crisp
  sun.position.set(player.pos.x + 30, player.pos.y + 60, player.pos.z + 20); sun.target.position.copy(player.pos);
  scene.userData.sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try { await loadAll(); } catch (e) { $('loading').textContent = 'Failed to load models: ' + e.message; throw e; }
  setupPlayerModel(); buildLevel(); drawHealth();
  // already-collected stars from a previous session: re-spawn as ghost stars only where they are fixed
  $('loading').style.display = 'none'; $('title').style.display = 'flex'; G.mode = 'title';
  window.__game = { G, player, enemies, items, solids, camState, input };
  frame();
})();
