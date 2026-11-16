// Capitan Pachino 64 — a 3D garden platformer.
// Vegetables are friends, steaks and fish are enemies. Collect the 7 Golden Stars.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { initAudio, sfx, startMusic, toggleMute, setMusicMood } from './audio.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const GRAV = 34, MAX_FALL = 32, RUN = 9.5, STEP = 0.4;
const SEA = -1.0;
const POND = { x: 38, z: 8, r: 14, level: -0.6 };
const SPAWN = new THREE.Vector3(0, 0, 52);
// World 2 (Isola Brace) lives far to the east in the same scene, floating in a sea of hot sauce
const W2X = 2000, LAVA = -0.5;
// World 3 (Mare Surgelato) lives further east still: ice floes on a freezing sea you can swim in, briefly
const W3X = 4000, COLD = -0.6;
// World 4 (Dolceterra) floats in a sea of melted chocolate; world 5 (La Grande Cucina) is a giant kitchen
const W4X = 6000, CHOC = -0.5, W5X = 8000;
const WORLD_BOUNDS = { 1: [0, 100], 2: [W2X, 92], 3: [W3X, 96], 4: [W4X, 96], 5: [W5X, 96] };
const lavaAt = (x) => (x > 1000 && x < 3000 ? LAVA : x > 5000 && x < 7000 ? CHOC : null);
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
// World 2 materials: basalt with glowing cracks, bubbling sauce, griddle plates
const texBasaltTop = canvasTex(64, (g, s) => speckle(g, s, '#5c4b4f', ['#4a3c40', '#6c5a5e', '#3e3236', '#7a6860'], 500));
const texBasaltSide = canvasTex(64, (g, s) => {
  speckle(g, s, '#2e2022', ['#3a2a2c', '#241819', '#44302e'], 300);
  g.strokeStyle = '#ff7a1a'; g.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) { let x = rand() * s, y = rand() * s; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 14; y += 4 + rand() * 8; g.lineTo(x, y); } g.stroke(); }
});
const texLava = canvasTex(128, (g, s) => {
  g.fillStyle = '#f2590c'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) { g.globalAlpha = 0.5; g.fillStyle = ['#ff8a1a', '#ffa82a', '#d93a08', '#b02405'][(rand() * 4) | 0]; g.beginPath(); g.ellipse(rand() * s, rand() * s, 3 + rand() * 10, 2 + rand() * 6, rand() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(90,20,5,0.55)'; g.beginPath(); g.ellipse(rand() * s, rand() * s, 4 + rand() * 9, 2 + rand() * 4, rand() * 3, 0, 7); g.fill(); }
});
const texGriddle = canvasTex(32, (g, s) => { g.fillStyle = '#5b6170'; g.fillRect(0, 0, s, s); g.fillStyle = '#3a3f4b'; for (let x = 0; x < s; x += 8) g.fillRect(x, 0, 3, s); });
const matBasaltTop = new THREE.MeshLambertMaterial({ map: texBasaltTop });
const matBasaltSide = new THREE.MeshLambertMaterial({ map: texBasaltSide, emissive: 0xaa4411, emissiveMap: texBasaltSide });
const matGriddle = new THREE.MeshLambertMaterial({ map: texGriddle });
// World 3 materials: snow, ice, the trawler, sushi belts and the wafer lighthouse
const texSnow = canvasTex(64, (g, s) => speckle(g, s, '#f2f7ff', ['#e0ebfa', '#ffffff', '#d6e4f6'], 400));
const iceLines = (g, s, col, n) => { g.strokeStyle = col; g.lineWidth = 1; for (let i = 0; i < n; i++) { const x = rand() * s, y = rand() * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5 + rand() * 10, y - 3 - rand() * 8); g.lineTo(x + 9 + rand() * 12, y + rand() * 6); g.stroke(); } };
const texIceTop = canvasTex(64, (g, s) => { speckle(g, s, '#a6dcf5', ['#94cfee', '#c0ecff', '#b2e4fa'], 300); iceLines(g, s, 'rgba(255,255,255,.75)', 7); });
const texFloeTop = canvasTex(64, (g, s) => { speckle(g, s, '#dcf3fc', ['#c8e8f8', '#f0fbff', '#d0ecfa'], 300); iceLines(g, s, 'rgba(40,110,170,.8)', 9); });
const texIceSide = canvasTex(64, (g, s) => speckle(g, s, '#78b8e2', ['#66a8d8', '#92cdf0', '#5898cc'], 400));
const texHull = canvasTex(64, (g, s) => { speckle(g, s, '#8a2f2c', ['#7a2623', '#9a3a34', '#6c2220'], 300); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, s, 5); });
const texDeck = canvasTex(64, (g, s) => { speckle(g, s, '#b98a56', ['#a97a48', '#c79a66', '#b08250'], 250); g.fillStyle = '#7a5630'; for (let x = 0; x < s; x += 16) g.fillRect(x, 0, 1, s); });
const texBelt = canvasTex(32, (g, s) => { g.fillStyle = '#2c303a'; g.fillRect(0, 0, s, s); g.fillStyle = '#596070'; g.fillRect(3, 3, s - 6, s - 6); g.fillStyle = '#8a92a6'; g.fillRect(7, 7, s - 14, 4); g.fillRect(7, s - 11, s - 14, 4); });
const texWafer = canvasTex(64, (g, s) => { g.fillStyle = '#e2b266'; g.fillRect(0, 0, s, s); g.strokeStyle = '#b98236'; g.lineWidth = 2; for (let i = -s; i < s * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); g.beginPath(); g.moveTo(i + s, 0); g.lineTo(i, s); g.stroke(); } });
const matSnow = new THREE.MeshLambertMaterial({ map: texSnow });
const matIceTop = new THREE.MeshLambertMaterial({ map: texIceTop });
const matFloeTop = new THREE.MeshLambertMaterial({ map: texFloeTop });
const matIceSide = new THREE.MeshLambertMaterial({ map: texIceSide });
const matHull = new THREE.MeshLambertMaterial({ map: texHull });
const matDeck = new THREE.MeshLambertMaterial({ map: texDeck });
const six = (side, top) => [side, side, top, side, side, side];
// World 4 materials: sponge cake, frosting, biscuit, melted chocolate
const texSponge = canvasTex(64, (g, s) => { speckle(g, s, '#f0cf78', ['#e6c26a', '#f8dc90', '#e0b860'], 350); g.fillStyle = '#fff6ea'; g.fillRect(0, 26, s, 9); g.fillStyle = '#e8507a'; g.fillRect(0, 29, s, 3); });
const texFrost = canvasTex(64, (g, s) => { speckle(g, s, '#ff9ec4', ['#ff8ab8', '#ffb2d0', '#ffa6c8'], 250); const cols = ['#ffffff', '#5ac8ff', '#ffd23f', '#8be060', '#b58cff']; for (let i = 0; i < 26; i++) { g.fillStyle = cols[i % 5]; g.save(); g.translate(rand() * s, rand() * s); g.rotate(rand() * 3); g.fillRect(-2.5, -0.8, 5, 1.6); g.restore(); } });
const texBiscuit = canvasTex(64, (g, s) => { speckle(g, s, '#d9a560', ['#cc9850', '#e4b470', '#c48c48'], 400); g.fillStyle = '#a87434'; for (let i = 0; i < 14; i++) g.fillRect(rand() * s, rand() * s, 2, 2); });
const texCookieTop = canvasTex(64, (g, s) => { speckle(g, s, '#d9a560', ['#cc9850', '#e4b470', '#c48c48'], 400); g.fillStyle = '#4a2812'; for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(rand() * s, rand() * s, 2 + rand() * 2.5, 0, 7); g.fill(); } });
const texChoc = canvasTex(128, (g, s) => {
  speckle(g, s, '#5a2f18', ['#4e2812', '#66381e', '#522a14'], 500); g.strokeStyle = 'rgba(150,96,58,.55)'; g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const x = rand() * s, y = rand() * s, r = 8 + rand() * 14, a = rand() * 6; g.beginPath(); g.arc(x, y, r, a, a + 2 + rand() * 2); g.stroke(); }
});
const matSpongeSide = new THREE.MeshLambertMaterial({ map: texSponge });
const matFrost = new THREE.MeshLambertMaterial({ map: texFrost });
const matBiscuit = new THREE.MeshLambertMaterial({ map: texBiscuit });
const matCookieTop = new THREE.MeshLambertMaterial({ map: texCookieTop });
const matPlate = new THREE.MeshLambertMaterial({ color: 0xf4f0ea });
// World 5 materials: marble worktop on teal cabinets, brushed steel
const texMarble = canvasTex(64, (g, s) => { speckle(g, s, '#eeeae4', ['#e4dfd6', '#f8f5f0', '#dcd6cc'], 300); iceLines(g, s, 'rgba(150,140,130,.5)', 5); });
const texCabinet = canvasTex(64, (g, s) => { speckle(g, s, '#4f9a94', ['#479088', '#58a49e', '#438880'], 250); g.strokeStyle = '#2f6e68'; g.lineWidth = 2; g.strokeRect(5, 5, s - 10, s - 10); g.fillStyle = '#e8dcc0'; g.fillRect(s / 2 - 5, 9, 10, 3); });
const texSteel = canvasTex(64, (g, s) => { g.fillStyle = '#aab2bc'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '60,70,80'},${rand() * 0.18})`; g.fillRect(0, y, s, 1); } });
const matMarble = new THREE.MeshLambertMaterial({ map: texMarble });
const matCabinet = new THREE.MeshLambertMaterial({ map: texCabinet });
const matSteel = new THREE.MeshLambertMaterial({ map: texSteel });

// ---------------------------------------------------------------------------
// World: heightfield, solids, water
// ---------------------------------------------------------------------------
function groundHeight(x, z) {
  if (x > 1000) return -8; // world 2: only sauce below the islands
  const r = Math.hypot(x, z);
  let h = r < 70 ? 0 : r < 84 ? -3.4 * smoothstep(70, 84, r) : -3.4;
  // gentle rolling hills (faded out near the beach)
  h += 0.35 * Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11) * (1 - smoothstep(55, 68, r));
  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.r + 2) h = Math.min(h, lerp(h, -3, smoothstep(POND.r, POND.r - 7, dp)));
  return h;
}
function waterLevelAt(x, z) {
  if (x > 7000) return x > SINK.x0 && x < SINK.x1 && z > SINK.z0 && z < SINK.z1 ? SINK.level : null; // the kitchen sink
  if (x > 3000 && x < 5000) return COLD;
  if (x > 1000) return null;
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
  const mats = mat === 'stone' ? matStone : mat === 'basalt' ? six(matBasaltSide, matBasaltTop) : mat === 'snow' ? six(matIceSide, matSnow) : mat === 'ice' ? six(matIceSide, matIceTop) : mat === 'hull' ? six(matHull, matDeck) : mat === 'sponge' ? six(matSpongeSide, matFrost) : mat === 'biscuit' ? matBiscuit : mat === 'plate' ? matPlate : mat === 'marble' ? six(matCabinet, matMarble) : mat === 'steel' ? matSteel : mat === 'board' ? matDeck : six(matDirt, matGrassTop);
  const m = new THREE.Mesh(worldUVBox(w, h, d, cx, cy, cz), mats);
  m.position.set(cx, cy, cz); m.castShadow = m.receiveShadow = true; scene.add(m);
  if (mat === 'grass') {
    const lip = new THREE.Mesh(worldUVBox(w + 0.16, 0.3, d + 0.16, cx, y1 - 0.15, cz), matGrassTop);
    lip.position.set(cx, y1 - 0.15, cz); lip.receiveShadow = true; scene.add(lip);
  }
  return addSolid({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, { mesh: m, ice: mat === 'ice' });
}
// Ramp: rises along axis toward dir (+1/-1) from lo to hi
function ramp(x0, x1, z0, z1, base, lo, hi, axis, dir, mat = matGrassTop) {
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
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  // ExtrudeGeometry may flip winding after mirroring; render both sides
  m.material = mat.clone(); m.material.side = THREE.DoubleSide;
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
const FOOD = ['carrot', 'tomato', 'broccoli', 'eggplant', 'paprika', 'cabbage', 'corn', 'mushroom', 'onion', 'pumpkin', 'leek', 'radish', 'beet', 'cauliflower', 'meat-raw', 'meat-cooked', 'fish', 'fish-bones', 'meat-ribs', 'whole-ham', 'sausage', 'lemon', 'pot-stew', 'frying-pan', 'bottle-ketchup', 'maki-salmon', 'maki-roe', 'sushi-salmon', 'sushi-egg', 'rice-ball', 'celery-stick', 'avocado', 'ice-cream', 'popsicle', 'soy', 'cake-birthday', 'cupcake', 'lollypop', 'cookie', 'donut-sprinkles', 'pudding', 'strawberry', 'meat-patty', 'turkey', 'pear', 'pineapple', 'orange', 'watermelon', 'whipped-cream', 'burger', 'hot-dog', 'mug', 'pepper-mill', 'shaker-salt', 'shaker-pepper', 'loaf', 'cheese', 'knife-block', 'bottle-oil', 'pot', 'pot-lid'];
const PLAT = ['tree', 'tree-pine', 'coin-gold', 'star', 'heart', 'spring', 'flag', 'platform', 'block-moving', 'block-moving-blue', 'crate', 'crate-item', 'rocks', 'fence-straight', 'flowers', 'flowers-tall', 'grass', 'hedge', 'mushrooms', 'plant', 'sign', 'stones', 'barrel', 'chest', 'pipe', 'poles', 'tree-snow', 'tree-pine-snow'];
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
  ham: 'Don Prosciutto of Vulcano Ragù',
  crossing: 'Across the Sizzling Sauce',
  skewer: 'Top of the Spiedino Spire',
  lemons: 'Eight Sunny Lemons',
  ribs: 'Rack of Ribs Roundup',
  tuna: 'Il Tonno Padrino of the Frozen Trawler',
  cono: 'Top of the Cono Lighthouse',
  belt: 'The Sushi Belt Run',
  peas: 'Eight Snow Peas',
  thaw: 'Thaw the Frozen Villagers',
  turkey: 'Barone Tacchino of the Torta Reale',
  jelly: 'The Great Jelly Jump',
  raft: 'Biscuit Rafts to Isola Bignè',
  berries: 'Eight Wild Strawberries',
  polpette: 'Meatball Roundup',
  cleaver: "Il Mannarone, the Chef's Cleaver",
  fridge: 'Top Shelf of the Fridge',
  hobs: 'Across the Hot Hobs',
  pickles: 'Eight Crunchy Pickles',
  spice: 'The Spice Rack Summit',
};
const STAR_ORDER = ['boss', 'tower', 'peppers', 'kids', 'fish', 'coins', 'steaks'];
const STAR_ORDER2 = ['ham', 'crossing', 'skewer', 'lemons', 'ribs'];
const STAR_ORDER3 = ['tuna', 'cono', 'belt', 'peas', 'thaw'];
const STAR_ORDER4 = ['turkey', 'jelly', 'raft', 'berries', 'polpette'];
const STAR_ORDER5 = ['cleaver', 'fridge', 'hobs', 'pickles', 'spice'];
const TOTAL_STARS = STAR_ORDER.length + STAR_ORDER2.length + STAR_ORDER3.length + STAR_ORDER4.length + STAR_ORDER5.length;
const starsIn = (order) => order.filter((id) => G.stars.has(id)).length;
const world1Stars = () => starsIn(STAR_ORDER), world2Stars = () => starsIn(STAR_ORDER2), world3Stars = () => starsIn(STAR_ORDER3), world4Stars = () => starsIn(STAR_ORDER4);
let saved = [];
try { saved = JSON.parse(localStorage.getItem('pachino64') || '{}').stars || []; } catch (e) { saved = []; }
const G = {
  mode: 'loading', stars: new Set(saved), coins: 0, lives: 4, health: 8, peppers: 0, kids: 0, fishKilled: 0, steaksKilled: 0,
  checkpoint: SPAWN.clone(), time: 0, healthShow: 0, coinStarSpawned: false, nextLifeAt: 50, endingShown: saved.length >= TOTAL_STARS,
  world: 1, lemons: 0, gateCool: 0, gateAnnounced: STAR_ORDER.every((id) => saved.includes(id)),
  pickles: 0, gate5Announced: STAR_ORDER4.every((id) => saved.includes(id)),
  berries: 0, gate4Announced: STAR_ORDER3.every((id) => saved.includes(id)),
  peas: 0, thawed: 0, coldT: 0, runT: 0, gate3Announced: STAR_ORDER2.every((id) => saved.includes(id)),
};
function saveGame() { try { localStorage.setItem('pachino64', JSON.stringify({ stars: [...G.stars] })); } catch (e) { /* storage blocked */ } }

let toastT = 0, bannerT = 0;
function toast(msg, t = 2.2) { $('toast').textContent = msg; $('toast').classList.add('show'); toastT = t; }
function banner(html, t = 2.5) { $('banner').innerHTML = html; $('banner').classList.add('show'); bannerT = t; }
function updateHUD(dt) {
  $('stars').textContent = G.stars.size; $('coins').textContent = G.coins; $('livesN').textContent = Math.max(0, G.lives);
  $('pepperN').textContent = G.peppers; $('peppers').style.display = G.world === 1 && G.peppers > 0 && G.peppers < 8 ? 'flex' : 'none';
  $('lemonN').textContent = G.lemons; $('lemons').style.display = G.world === 2 && G.lemons > 0 && G.lemons < 8 ? 'flex' : 'none';
  $('peaN').textContent = G.peas; $('peas').style.display = G.world === 3 && G.peas > 0 && G.peas < 8 ? 'flex' : 'none';
  $('berryN').textContent = G.berries; $('berries').style.display = G.world === 4 && G.berries > 0 && G.berries < 8 ? 'flex' : 'none';
  $('pickleN').textContent = G.pickles; $('pickles').style.display = G.world === 5 && G.pickles > 0 && G.pickles < 8 ? 'flex' : 'none';
  $('timerN').textContent = Math.ceil(G.runT); $('timer').style.display = G.runT > 0 ? 'flex' : 'none';
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
function lemon(x, y, z) { const m = inst('lemon', 4.2, false); addEyes(m, { hf: 0.5, size: 0.14 }); return addItem('lemon', m, new THREE.Vector3(x, y, z)); }
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
    case 'lemon':
      G.lemons++; sfx.redcoin(); burst(p, { n: 12, color: 0xffe14a, speed: 4, life: 0.6 }); addCoins(2);
      toast(`Sunny Lemon ${G.lemons} / 8`);
      if (G.lemons === 8) spawnStar('lemons', new THREE.Vector3(W2X, 4.2, 26));
      break;
    case 'pea':
      G.peas++; sfx.redcoin(); burst(p, { n: 12, color: 0x8be060, speed: 4, life: 0.6 }); addCoins(2);
      toast(`Snow Pea ${G.peas} / 8`);
      if (G.peas === 8) spawnStar('peas', new THREE.Vector3(W3X + 3, 3.7, 13));
      break;
    case 'berry':
      G.berries++; sfx.redcoin(); burst(p, { n: 12, color: 0xff3b5a, speed: 4, life: 0.6 }); addCoins(2);
      toast(`Wild Strawberry ${G.berries} / 8`);
      if (G.berries === 8) spawnStar('berries', new THREE.Vector3(W4X + 7, 4.2, 12));
      break;
    case 'pickle':
      G.pickles++; sfx.redcoin(); burst(p, { n: 12, color: 0x7ac050, speed: 4, life: 0.6 }); addCoins(2);
      toast(`Crunchy Pickle ${G.pickles} / 8`);
      if (G.pickles === 8) spawnStar('pickles', new THREE.Vector3(W5X - 7, 4.2, 12));
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
    else if (it.type === 'pepper' || it.type === 'lemon' || it.type === 'pea' || it.type === 'berry' || it.type === 'pickle') { m.rotation.y += dt * 2; m.position.y = it.pos.y + Math.sin(it.t * 3) * 0.15; }
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
  else if (c.contents === 'lemon') lemon(p.x, p.y + 0.3, p.z);
  else if (c.contents === 'pea') pea(p.x, p.y + 0.3, p.z);
  else if (c.contents === 'berry') berry(p.x, p.y + 0.3, p.z);
  else if (c.contents === 'pickle') pickle(p.x, p.y + 0.3, p.z);
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
  const o = typeof name === 'string' ? inst(name, 1) : name; if (typeof name === 'string') o.scale.set(...s);
  o.position.copy(base); scene.add(o);
  o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o);
  const off = { min: b.min.clone().sub(base), max: b.max.clone().sub(base) };
  const sd = addSolid(b.min, b.max);
  const rec = { o, base: base.clone(), fn, sd, off, delta: new THREE.Vector3(), t: 0 }; movers.push(rec); return rec;
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
const STEAK_TYPES = {
  raw: { model: 'meat-raw', s: 3.2, speed: 4.2, r: 0.75, h: 1.8 },
  cooked: { model: 'meat-cooked', s: 3.2, speed: 5.6, r: 0.75, h: 1.8 },
  ribs: { model: 'meat-ribs', s: 4.4, speed: 3.6, r: 0.9, h: 1.7, armored: true },
  sausage: { model: 'sausage', s: 5, speed: 6.6, r: 0.55, h: 1.9 },
  maki: { model: 'maki-salmon', s: 12, speed: 5, r: 0.75, h: 1.45, roller: true },    // aims, then rolls in a straight line
  frozen: { model: 'fish', s: 2.7, speed: 2.4, r: 0.75, h: 1.7, iced: true },         // a slash, a stomp or a ground pound cracks the ice first
  polpetta: { model: 'meat-patty', s: 6, speed: 4.6, r: 0.75, h: 1.9, hopper: true },      // never stops hopping while it chases
  burger: { model: 'burger', s: 5, speed: 3.8, r: 1.0, h: 1.3, tough: true },               // takes two hits: the bun flies off first
  hotdog: { model: 'hot-dog', s: 3.4, speed: 6.4, r: 0.6, h: 2.0 },
};
function steak(x, z, { cooked = false, y = null, range = 6, type = null, w = 1 } = {}) {
  type = type || (cooked ? 'cooked' : 'raw'); const T = STEAK_TYPES[type];
  const gy = y === null ? groundHeight(x, z) : y;
  const root = new THREE.Group(); root.position.set(x, gy, z); scene.add(root);
  const s = T.s;
  const tilt = new THREE.Group(); root.add(tilt);
  const body = inst(T.model, s);
  if (type === 'sausage') { body.rotation.z = Math.PI / 2; body.position.set(0.06 * s, 0.19 * s + 0.05, 0); }
  else if (type === 'ribs') { body.rotation.x = Math.PI / 2; body.position.y = 0.19 * s + 0.05; body.position.z = -0.1; }
  else if (type === 'maki') { body.rotation.z = Math.PI / 2; body.position.x = 0.035 * s; }
  else if (type === 'frozen') { body.rotation.x = -Math.PI / 2; body.position.set(0, 0.31 * s, 0.16 * s); }
  else if (type === 'burger' || type === 'hotdog') body.position.y = 0.02;
  else if (type === 'polpetta') { body.rotation.x = Math.PI / 2; body.position.y = 0.17 * s + 0.05; body.position.z = -0.1; }
  else { body.rotation.x = Math.PI / 2; body.position.y = 0.29 * s + 0.05; body.position.z = -0.1; }
  let spin = null, ice = null;
  if (type === 'maki') { spin = new THREE.Group(); spin.position.y = 0.06 * s; spin.add(body); tilt.add(spin); }
  else if (type === 'frozen') { const turn = new THREE.Group(); turn.rotation.y = Math.PI / 2; turn.add(body); tilt.add(turn); }
  else tilt.add(body);
  addEyes(tilt, type === 'burger' ? { hf: 0.55, size: 0.24, spread: 0.2, angry: true } : type === 'hotdog' ? { hf: 0.72, size: 0.12, spread: 0.2, angry: true } : type === 'sausage' ? { hf: 0.74, size: 0.13, spread: 0.2, angry: true } : type === 'maki' ? { hf: 0.6, size: 0.13, spread: 0.16, angry: true } : type === 'frozen' ? { hf: 0.74, size: 0.1, spread: 0.13, angry: true } : { hf: 0.68, size: 0.09, spread: 0.2, angry: true });
  if (type === 'frozen') { ice = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 1.5), matIceBlock); ice.position.y = 1.0; tilt.add(ice); }
  const e = {
    kind: 'steak', type, w, armored: !!T.armored, roller: !!T.roller, iced: !!T.iced, hopper: !!T.hopper, tough: !!T.tough, spin, ice, root, tilt, body, home: new THREE.Vector3(x, gy, z), range, cooked,
    pos: root.position, vel: new THREE.Vector3(), r: T.r, h: T.h, onGround: true, alive: true, state: 'patrol', t: 0,
    target: new THREE.Vector3(x, gy, z), speed: T.speed, facing: rand() * 6, hop: 0,
  };
  enemies.push(e); return e;
}
// Ember fish: skeleton fish that leap out of the hot sauce in an arc. Hazard only.
function ember(x, z, { period = 2.6, phase = 0, height = 4, dx = 0, dz = 0, w = 2 } = {}) {
  const root = new THREE.Group(); scene.add(root);
  const body = inst(w === 3 ? 'fish' : 'fish-bones', w === 3 ? 3 : 3.6, false); root.add(body);
  if (w === 2) body.traverse((c) => { if (c.isMesh) { c.material = c.material.clone(); c.material.color = new THREE.Color(0xffb060); c.material.emissive = new THREE.Color(0xff4a00); c.material.emissiveIntensity = 0.8; } });
  if (w === 4) body.traverse((c) => { if (c.isMesh) { c.material = c.material.clone(); c.material.color = new THREE.Color(0x7a4424); } });
  const e = { kind: 'ember', root, body, pos: root.position, alive: true, state: 'swim', t: phase, period, height, x, z, dx, dz, r: 0.9, h: 1, up: false, w, sea: w === 3 ? COLD : w === 4 ? CHOC : LAVA, col: w === 3 ? 0x9fd8ff : w === 4 ? 0x7a4424 : 0xff9a2a, skip: -1 };
  root.position.set(x, e.sea - 2, z); enemies.push(e); return e;
}
function updateEmber(e, dt) {
  e.t += dt;
  const j = ((e.t % e.period) / e.period) / 0.6;
  const up = j < 1 && Math.floor(e.t / e.period) !== e.skip;
  if (up !== e.up) { e.up = up; if (G.world === e.w) burst(new THREE.Vector3(e.pos.x, e.sea + 0.1, e.pos.z), { n: 6, color: e.col, speed: 3, life: 0.5, grav: 15, up: 4, size: 0.2 }); }
  if (!up) { e.root.visible = false; e.pos.set(e.x, e.sea - 2, e.z); return; }
  e.root.visible = true;
  e.pos.set(e.x + e.dx * j, e.sea - 0.8 + e.height * 4 * j * (1 - j), e.z + e.dz * j);
  e.root.rotation.y = (e.dx || e.dz) ? Math.atan2(e.dx, e.dz) : e.t * 2;
  e.body.rotation.x = -Math.cos(Math.PI * j) * ((e.dx || e.dz) ? 0.9 : 1.5);
  if (G.mode !== 'play' || player.dead) return;
  const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z), dy = player.pos.y + 0.8 - e.pos.y;
  if (d < 1.15 && Math.abs(dy) < 1.3) {
    if (e.w === 3 && player.vel.y < 0 && dy > 0.35) { // flying fish can be bopped for a bounce; they come back next leap
      e.skip = Math.floor(e.t / e.period); sfx.stomp(); player.bounce(13);
      burst(e.pos.clone(), { n: 10, color: 0xffffff, speed: 5, size: 0.3, life: 0.5 });
    } else hurtPlayer(1, e.pos);
  }
}
function fish(i) {
  const root = new THREE.Group(); scene.add(root);
  const body = inst('fish', 3.2); root.add(body);
  const e = { kind: 'fish', root, body, pos: root.position, vel: new THREE.Vector3(), alive: true, state: 'swim', t: rand() * 3, a: (i / 5) * Math.PI * 2, rr: 4 + (i % 3) * 2.5, cool: 2 + rand() * 3, r: 0.8, h: 1 };
  root.position.set(POND.x + Math.cos(e.a) * e.rr, POND.level - 0.6, POND.z + Math.sin(e.a) * e.rr);
  enemies.push(e); return e;
}
function makeBoss(x, y, z, arena, cfg = {}) {
  const C = {
    model: 'meat-raw', s: 8.5, name: 'King Steak', star: 'boss', hp: 3, chaseT: 2.6, stunT: 3.2, jumpEvery: 3, fast: 1, r: 2.2, crownZ: 0.2,
    eyes: { hf: 0.66, size: 0.08, spread: 0.2 },
    intro: ['GRRRAAH! Who dares climb MY Mount Grill?!', 'A tomato?! In a pirate hat?! I shall make you into SAUCE!', '(Tip: dodge his charge. When he is dizzy, jump on him or ground pound him!)'],
    ...cfg,
  };
  const root = new THREE.Group(); root.position.set(x, y, z); scene.add(root);
  const s = C.s; const tilt = new THREE.Group(); root.add(tilt);
  const body = inst(C.model, s);
  if (C.model === 'whole-ham' || C.upright) { body.position.y = 0.05; body.rotation.y = C.rotY || 0; }
  else { body.rotation.x = Math.PI / 2; body.position.y = 0.29 * s + 0.1; body.position.z = -0.25; }
  tilt.add(body);
  root.updateWorldMatrix(true, true); const top = new THREE.Box3().setFromObject(tilt).max.y - y;
  addEyes(tilt, { ...C.eyes, angry: true });
  // golden crown
  const crown = new THREE.Group(); const gold = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.6, roughness: 0.3 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 16, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 1.0, 0.6, Math.sin(a) * 1.0); crown.add(sp); }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: C.gem ?? 0x3f8cff, metalness: 0.3, roughness: 0.2 })); gem.position.set(0, 0, 1.12); crown.add(gem);
  crown.position.set(0, top + 0.3, C.crownZ); crown.traverse((c) => c.isMesh && (c.castShadow = true)); tilt.add(crown);
  const dizzy = new THREE.Group(); for (let i = 0; i < 3; i++) { const st = inst('star', 1.2, false); st.position.set(Math.cos(i * 2.1) * 1.4, 0, Math.sin(i * 2.1) * 1.4); dizzy.add(st); }
  dizzy.position.y = top + 1.6; dizzy.visible = false; root.add(dizzy);
  const b = { kind: C.kind || 'boss', hops: 0, cfg: C, root, tilt, body, dizzy, pos: root.position, vel: new THREE.Vector3(), r: C.r, h: top - 0.2, onGround: true, alive: true, hp: C.hp, state: 'sleep', t: 0, facing: 0, arena, home: new THREE.Vector3(x, y, z), cycle: 0, chargeDir: new THREE.Vector3() };
  enemies.push(b); return b;
}
function killEnemy(e, how = 'stomp') {
  if (!e.alive) return; e.alive = false;
  const p = e.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
  burst(p, { n: 16, color: 0xffffff, speed: 5, size: 0.35, life: 0.6 });
  if (e.kind === 'steak') {
    sfx.stomp(); G.steaksKilled++; e.state = 'dead'; e.t = 0;
    coin(e.pos.x, Math.max(e.pos.y, e.w >= 2 ? e.home.y : groundHeight(e.pos.x, e.pos.z)) + 0.6, e.pos.z);
    if (e.w === 2) {
      if (e.armored) {
        const left = enemies.filter((x) => x.armored && x.alive).length;
        if (left === 0) spawnStar('ribs', new THREE.Vector3(W2X - 7, 4.2, 12));
        else toast(`Ribs left: ${left}`, 1.6);
      }
    } else if (e.w === 4) {
      if (e.hopper) {
        const left = enemies.filter((x) => x.hopper && x.alive).length;
        if (left === 0) spawnStar('polpette', new THREE.Vector3(W4X - 7, 4.2, 12));
        else toast(`Meatballs left: ${left}`, 1.6);
      }
    } else if (e.w === 1) {
      const left = enemies.filter((x) => x.kind === 'steak' && x.w === 1 && x.alive).length;
      if (left === 0) { spawnStar('steaks', new THREE.Vector3(7, 3.2, 10)); }
      else toast(`Steaks left: ${left}`, 1.6);
    }
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
  } else if (e.state === 'chase' && e.roller) {
    e.state = 'aim'; e.t = 0;
  } else if (e.state === 'aim') {
    tx = player.pos.x; tz = player.pos.z; speed = 0; e.tilt.position.x = Math.sin(e.t * 50) * 0.06;
    if (dp > 16 || Math.abs(dy) > 4) { e.state = 'return'; e.tilt.position.x = 0; }
    else if (e.t > 0.75) { e.state = 'roll'; e.t = 0; e.tilt.position.x = 0; if (dp < 14) sfx.longjump(); }
  } else if (e.state === 'roll') {
    tx = e.pos.x + Math.sin(e.facing) * 10; tz = e.pos.z + Math.cos(e.facing) * 10; speed = 11;
    if (e.t > 1.15) { e.state = 'rest'; e.t = 0; }
  } else if (e.state === 'rest') {
    if (e.t > 1.1) { e.state = dp < 15 ? 'aim' : 'return'; e.t = 0; }
  } else if (e.state === 'chase') {
    tx = player.pos.x; tz = player.pos.z; speed = e.speed;
    if (dp > 15 || homeD > e.range + 12 || Math.abs(dy) > 4) { e.state = 'return'; }
  } else if (e.state === 'return') {
    tx = e.home.x; tz = e.home.z; speed = 3;
    if (homeD < 1) { e.state = 'patrol'; e.t = 0; }
  } else if (e.state === 'knock') {
    speed = 0; if (e.onGround && e.t > 0.3) { e.state = 'chase'; e.t = 0; }
  }
  if (e.state === 'rest') { e.vel.x *= 1 - dt * 1.5; e.vel.z *= 1 - dt * 1.5; speed = Math.hypot(e.vel.x, e.vel.z); } // keeps sliding, even off the edge
  else if (e.state !== 'knock') {
    const want = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    e.facing += angDiff(e.facing, want) * Math.min(1, dt * 6);
    // edge check: don't walk off ledges
    const ax = e.pos.x + Math.sin(e.facing) * 1.2, az = e.pos.z + Math.cos(e.facing) * 1.2;
    const ahead = floorAt(ax, az, e.pos.y, 0.3).y;
    if (e.state !== 'roll' && (!e.hopper || e.onGround) && (ahead < e.pos.y - 1.2 || (e.w !== 3 && waterLevelAt(ax, az) !== null))) { speed = 0; if (e.state === 'patrol') e.t = 5; }
    e.vel.x = Math.sin(e.facing) * speed; e.vel.z = Math.cos(e.facing) * speed;
  } else { e.vel.x *= 1 - dt * 2; e.vel.z *= 1 - dt * 2; }
  if (e.hopper && e.onGround && e.state === 'chase') { e.vel.y = 10.5; e.onGround = false; }
  e.vel.y = Math.max(e.vel.y - GRAV * dt, -MAX_FALL);
  moveBody(e, dt);
  if (e.pos.y < -20) { e.pos.copy(e.home); e.vel.set(0, 0, 0); }
  if (e.w === 2 && e.pos.y < LAVA) { burst(e.pos.clone().setY(LAVA + 0.2), { n: 14, color: 0xff9a2a, speed: 5, grav: 15, up: 6 }); sfx.splash(); killEnemy(e); return; } // sizzled in the sauce
  if (e.w === 3 && e.pos.y < COLD - 0.3) { burst(e.pos.clone().setY(COLD + 0.2), { n: 14, color: 0x9fd8ff, speed: 5, grav: 15, up: 6 }); sfx.splash(); killEnemy(e); return; } // plop
  if (e.w === 4 && e.pos.y < CHOC) { burst(e.pos.clone().setY(CHOC + 0.2), { n: 14, color: 0x7a4424, speed: 5, grav: 15, up: 6 }); sfx.splash(); killEnemy(e); return; } // glub
  if (e.w === 5 && e.pos.y < -5) { killEnemy(e); return; } // off the counter
  // waddle hop animation
  e.hop += dt * (speed > 2 ? 12 : 7);
  e.root.rotation.y = e.facing;
  e.tilt.position.y = e.onGround ? Math.abs(Math.sin(e.hop)) * (speed > 0 ? 0.35 : 0.1) : 0;
  e.tilt.rotation.z = Math.sin(e.hop) * 0.12; e.tilt.rotation.x = speed > 3 ? 0.18 : 0;
  if (e.spin) { e.spin.rotation.x += Math.hypot(e.vel.x, e.vel.z) * dt / 0.72; e.tilt.position.y = 0; e.tilt.rotation.z = 0; e.tilt.rotation.x = 0; }
  // interaction with the player
  if (G.mode !== 'play' || player.dead) return;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z, hd = Math.hypot(dx, dz);
  if (hd < e.r + player.r + 0.15 && dy > -1.5 && dy < e.h) {
    if (e.iced) {
      if (player.action === 'gpFall' || (player.vel.y < 0 && dy > e.h * 0.45)) { crackIce(e); player.bounce(player.action === 'gpFall' ? 9 : 12); }
      else hurtPlayer(1, e.pos);
    }
    else if (player.vel.y < 0 && dy > e.h * 0.45) { hitEnemy(e); player.bounce(player.action === 'gpFall' ? 8 : 12); }
    else if (player.action === 'gpFall') hitEnemy(e);
    else if (player.action === 'longjump' && player.vel.y < 0) hitEnemy(e); // belly slide hit
    else hurtPlayer(1, e.pos);
  }
}
function hitEnemy(e, how) {
  if (!e.tough) { killEnemy(e, how); return; }
  e.tough = false; e.speed *= 1.35; e.state = 'knock'; e.t = 0; e.onGround = false; e.root.scale.setScalar(0.8); sfx.hit();
  const a = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z); e.vel.set(Math.sin(a) * 7, 6.5, Math.cos(a) * 7);
  burst(e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), { n: 10, color: 0xe8b060, speed: 6, size: 0.3, grav: 20, life: 0.6, up: 5 });
  toast('The bun flew off! Hit it again!', 1.6);
}
function crackIce(e) {
  e.iced = false; e.tilt.remove(e.ice); e.speed = 5.4; e.state = 'knock'; e.t = 0; e.onGround = false; e.vel.set(0, 6, 0); sfx.crate();
  burst(e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), { n: 16, color: 0xc8ecff, speed: 6, size: 0.3, grav: 20, life: 0.7, up: 5 });
  toast('Crack! Now finish it off!', 1.6);
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
    if (b.t > 0.9 && !b.gone) { b.gone = true; scene.remove(b.root); burst(b.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 40, color: 0xffffff, speed: 9, size: 0.6, life: 1 }); spawnStar(b.cfg.star, new THREE.Vector3(b.home.x, b.home.y + 2.2, b.home.z)); }
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
        openDialog(b.cfg.name, b.cfg.intro);
      }
      break;
    case 'intro': if (G.mode === 'play') { b.state = 'chase'; b.t = 0; } break;
    case 'chase':
      if (!inArena) { b.state = 'home'; break; }
      speed = (3.4 + (b.cfg.hp - b.hp) * 0.8) * b.cfg.fast; b.facing += angDiff(b.facing, toP) * Math.min(1, dt * 3);
      if (b.t > b.cfg.chaseT) { b.cycle++; b.state = b.cycle % b.cfg.jumpEvery === 0 ? 'jump' : 'windup'; b.t = 0; if (b.state === 'jump') { b.vel.y = 18; b.onGround = false; } }
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
      if (b.t > b.cfg.stunT) { b.state = 'chase'; b.t = 0; b.tilt.rotation.z = 0; }
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
      if (b.state === 'stunned') hitBoss(b);
      else { toast('Too tough! Make him dizzy first!', 1.5); sfx.hit(); }
      player.bounce(14); const a = Math.atan2(dx, dz); player.vel.x = Math.sin(a) * 9; player.vel.z = Math.cos(a) * 9;
    } else if (b.state === 'stunned') {
      const a = Math.atan2(dx, dz); player.pos.x = b.pos.x + Math.sin(a) * (b.r + player.r); player.pos.z = b.pos.z + Math.cos(a) * (b.r + player.r);
    } else hurtPlayer(2, b.pos);
  }
}
function hitBoss(boss) {
  boss.hp--; boss.state = 'hurt'; boss.t = 0; sfx.bossHit(); shake = 0.4;
  burst(boss.pos.clone().add(new THREE.Vector3(0, 3, 0)), { n: 20, color: 0xff6644, speed: 7, life: 0.7 });
  toast(boss.hp > 1 ? 'Ouch! Again!' : boss.hp === 1 ? 'One more hit!' : 'NOOOO! My crown!', 1.6);
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
  if (p.ground && p.ground.sticky) p.vel.y *= 0.72; // caramel holds on to your boots
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
    if (p.jumpBuf > 0) { p.vel.y = G.world === 3 ? 14 : 12; p.cutJump = G.world !== 1; p.jumpBuf = 0; sfx.splash(); burst(p.pos, { n: 8, color: 0x9fd8ff, speed: 3, grav: 15, up: 4 }); startAction('jump'); p.jumpKind = 1; }
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
    const f = p.onGround ? 1 - Math.min(1, dt * (p.ground && p.ground.ice ? 1.5 : 10)) : 1; p.vel.x *= f; p.vel.z *= f;
    if (p.at > 0.06 && !p.slashHit) { p.slashHit = true; slashHits(); }
    if (p.at > 0.3) startAction('normal');
  } else {
    // movement
    const air = !p.onGround;
    p.crouching = p.onGround && input.crouch;
    const icy = !air && p.ground && p.ground.ice;
    let maxS = RUN * mag, accel = air ? 16 : icy ? 8 : 45;
    if (p.crouching) { maxS = 0; accel = icy ? 4 : 12; }
    if (!air && p.ground && p.ground.sticky) maxS *= 0.4;
    if (p.action === 'longjump') { accel = 3; maxS = Math.max(hs, 4); }
    if (p.action === 'backflip') accel = 6;
    const tvx = mx * maxS, tvz = mz * maxS;
    if (!air && !icy && mag > 0.1 && hs > 6 && Math.abs(angDiff(Math.atan2(p.vel.x, p.vel.z), Math.atan2(mx, mz))) > 2.4) {
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
  for (const s of steams) if (p.pos.y > s.y0 - 0.2 && p.pos.y < s.y1 && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) { p.vel.y = Math.min(p.vel.y + 75 * dt, 9); p.onGround = false; } // steam lifts you

  // carried by moving platform
  if (p.onGround && p.ground && p.ground.vel) p.pos.add(p.ground.vel);
  if (p.onGround && p.ground && p.ground.belt) { p.pos.x += p.ground.belt.x * dt; p.pos.z += p.ground.belt.z * dt; }
  for (const w of winds) if (windOn(w) && p.pos.x > w.min.x && p.pos.x < w.max.x && p.pos.y > w.min.y && p.pos.y < w.max.y && p.pos.z > w.min.z && p.pos.z < w.max.z) {
    const k = (p.onGround ? 0.4 : 1) * dt; p.pos.x += w.dir.x * k; p.pos.z += w.dir.z * k;
  }
  // freezing water: you can swim, but not for long
  if (G.world === 3 && p.swimming && G.mode === 'play') {
    G.coldT += dt;
    if (G.coldT > 1.6) {
      G.coldT = 0; setHealth(G.health - 1); sfx.hurt(); toast('Brrr! The water is freezing — get out!', 1.6);
      burst(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 8, color: 0xc8ecff, speed: 4, life: 0.5 });
      if (G.health <= 0) killPlayer();
    }
  } else G.coldT = Math.max(0, G.coldT - dt * 2);

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
        for (const f of frozen) if (!f.done && Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z) < 3.6 && p.pos.y - f.pos.y > -0.5 && p.pos.y - f.pos.y < f.h + 0.5) thaw(f);
        for (const e of enemies) { // the shockwave cracks nearby ice and rattles a flopping tuna
          if (!e.alive || Math.abs(e.pos.y - p.pos.y) > 2.5) continue; const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (e.iced && d < 3.6) crackIce(e); else if (e.kind === 'tuna' && e.state === 'flop' && d < e.r + 3) hitTuna(e);
        }
        for (const c of crates) if (c.alive && Math.hypot(c.o.position.x - p.pos.x, c.o.position.z - p.pos.z) < 2.6 && Math.abs(c.o.position.y - p.pos.y) < 1.5) breakCrate(c);
      } else if (['jump', 'jump3', 'backflip', 'longjump', 'slash'].includes(p.action)) startAction('normal');
      if (p.ground && p.ground.spring) {
        p.vel.y = 24; p.onGround = false; startAction('jump3'); p.jumpKind = 0; sfx.spring(); p.ground.springRef.t = 0.4; p.airSlashed = false;
      }
    }
    if (p.jumpKind && G.time - p.lastLand > 0.22) p.jumpKind = 0;
    if (!water || p.floorY > (water ?? -99)) { if (!p.ground || !(p.ground.vel || p.ground.belt || p.ground.floe || p.ground.jelly)) p.lastSafe.copy(p.pos); }
  }
  // jelly: boing
  if (p.onGround && p.ground && p.ground.jelly && p.action !== 'star') {
    const k = p.action === 'gpLand' ? 1.5 : input.jump ? 1.3 : 1;
    p.vel.y = p.ground.jelly * k; p.ground.jref.wob = 0.4; p.onGround = false; startAction('jump'); p.cutJump = true; p.jumpKind = 0; p.airSlashed = false; sfx.spring();
  }
  // fell into the void
  if (p.pos.y < -25) { hurtPlayer(2, p.pos); p.pos.copy(p.lastSafe).add(new THREE.Vector3(0, 2, 0)); p.vel.set(0, 0, 0); }
  // keep in world bounds (sea)
  const [wcx, wR] = WORLD_BOUNDS[G.world];
  const rr = Math.hypot(p.pos.x - wcx, p.pos.z); if (rr > wR) { p.pos.x = wcx + (p.pos.x - wcx) * wR / rr; p.pos.z *= wR / rr; }
  // hot sauce: ouch, and a big bounce so you can steer back to land
  if (G.world === 2 && p.pos.y < LAVA + 0.1 && G.mode === 'play') {
    p.pos.y = LAVA + 0.1; p.bounce(19); p.jumpKind = 0; sfx.splash();
    burst(p.pos.clone(), { n: 12, color: 0xff9a2a, speed: 5, life: 0.6, grav: 15, up: 6 });
    if (p.invuln <= 0) { setHealth(G.health - 1); sfx.hurt(); p.invuln = 1.0; if (G.health <= 0) killPlayer(); }
  }
  // melted chocolate: you sink. Hop out at once (each hop is weaker) or lose health
  if (G.world === 4 && p.pos.y < CHOC && G.mode === 'play') {
    if (!p.inChoc) { p.inChoc = true; sfx.splash(); burst(p.pos.clone().setY(CHOC + 0.1), { n: 10, color: 0x7a4424, speed: 4, life: 0.6, grav: 15, up: 5 }); }
    p.vel.x *= 0.9; p.vel.z *= 0.9; if (p.vel.y < -1.3) p.vel.y = -1.3;
    if (p.action !== 'normal' && p.action !== 'jump' && p.action !== 'hurt') startAction('normal');
    const hops = p.chocHops || 0;
    if (p.jumpBuf > 0 && hops < 3) { p.vel.y = 13 - hops * 3.5; p.chocHops = hops + 1; p.jumpBuf = 0; startAction('jump'); p.cutJump = true; sfx.splash(); }
    if (p.pos.y < CHOC - 1.5) {
      setHealth(G.health - 1); sfx.hurt(); toast('Glub! Stuck in the chocolate!', 1.6);
      p.pos.copy(p.lastSafe).add(new THREE.Vector3(0, 1.5, 0)); p.vel.set(0, 0, 0); p.invuln = 1.5; p.chocHops = 0; camState.snap = true;
      if (G.health <= 0) killPlayer();
    }
  } else p.inChoc = false;
  if (p.onGround) p.chocHops = 0;
  // the giant kitchen: it is a long way down from the counter
  if (G.world === 5 && p.pos.y < -6 && G.mode === 'play') {
    setHealth(G.health - 1); sfx.hurt(); toast('Whoa! You fell off the counter!', 1.6);
    p.pos.copy(p.lastSafe).add(new THREE.Vector3(0, 1.5, 0)); p.vel.set(0, 0, 0); p.invuln = 1.5; camState.snap = true;
    if (G.health <= 0) killPlayer();
  }
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
    const reach = (e.kind === 'boss' || e.kind === 'hopboss' || e.kind === 'tuna' || e.kind === 'cleaver' ? e.r + 2 : 2.6);
    if (d > reach || dy > 2 || dy < -(e.h || 1.5)) continue;
    if (!spin && d > 0.8 && (dx * fx + dz * fz) / d < 0.2) continue;
    if (e.kind === 'ember') continue;
    if (e.kind === 'cleaver') { if (e.state === 'stuck') hitCleaver(e); continue; }
    if (e.kind === 'tuna') { if (e.state === 'flop') hitTuna(e); continue; }
    if (e.kind === 'boss' || e.kind === 'hopboss') { if (e.state === 'stunned') hitBoss(e); else { sfx.hit(); toast('Too tough! Make him dizzy first!', 1.5); } }
    else if (e.iced) { crackIce(e); e.vel.set(dx / (d || 1) * 6, 6, dz / (d || 1) * 6); } // the sword shatters the ice, a second hit finishes it
    else if (e.armored) { // swords bounce off bones
      sfx.hit(); toast('Clang! Too bony for a sword — stomp it!', 1.6);
      e.state = 'knock'; e.t = 0; e.onGround = false; e.vel.set(dx / (d || 1) * 8, 6.5, dz / (d || 1) * 8);
      burst(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 6, color: 0xffffff, speed: 4, life: 0.3 });
    }
    else hitEnemy(e, 'slash');
  }
  for (const f of frozen) if (!f.done && Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z) < 3 && p.pos.y - f.pos.y > -1 && p.pos.y - f.pos.y < f.h + 0.5) thaw(f);
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
  const fy = Math.max(f.y, wl ?? -99, lavaAt(p.pos.x) ?? -99); const hgt = p.pos.y - fy;
  blob.position.set(p.pos.x, fy + 0.04, p.pos.z); blob.scale.setScalar(clamp(1 - hgt * 0.05, 0.4, 1)); blob.visible = hgt < 30;
}

// ---------------------------------------------------------------------------
// Star collection
// ---------------------------------------------------------------------------
function collectStar(id) {
  const first = !G.stars.has(id);
  G.stars.add(id); saveGame(); delete starMeshes[id]; if (id === 'belt') G.runT = 0;
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
    const left = enemies.filter((x) => x.kind === 'steak' && x.w === 1 && x.alive).length;
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
    world1Stars() >= 7 ? 'The 7 Golden Stars are home — and the old Star Gate on the beach behind you is awake! It leads to Isola Brace, the Ember Isle.'
      : `Talk to every vegetable you meet — they all need your help. You have ${world1Stars()} of 7 stars. Coraggio!`,
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
  kidAt(44, groundHeight(44, 50), 50);
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
  const zones = [[-25, 25, -62, -8], [-56, -34, -12, 12], [-16, 16, 0, 36], [POND.x - 17, POND.x + 17, POND.z - 17, POND.z + 17], [24, 48, 28, 52], [-8, 8, 36, 70], [-26, -12, 4, 14]];
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
    if (Math.abs(x) < 5 && z > 56 && z < 68) continue;
    place(t, x, groundHeight(x, z), z, { s: 2.2, r: rand() * 6 });
  }
  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x666666 });
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group(); const a = rand() * Math.PI * 2, r = 40 + rand() * 120;
    for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rand() * 3, 0), cloudMat); s.position.set(k * 3.5 - 5, rand() * 1.5, rand() * 2); s.scale.y = 0.6; g.add(s); }
    g.position.set(Math.cos(a) * r, 34 + rand() * 25, Math.sin(a) * r); g.userData.v = 0.5 + rand(); scene.add(g); clouds.push(g);
  }
  makeGate(0, groundHeight(0, 63), 63, 2, 7);
  G.coinStarSpawned = false;
}

// ---------------------------------------------------------------------------
// Star Gates & world switching
// ---------------------------------------------------------------------------
const gates = [];
const gateGold = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.6, roughness: 0.3, emissive: 0x553300 });
const gateStone = new THREE.MeshLambertMaterial({ color: 0x8a8590 });
const gateCandy = new THREE.MeshStandardMaterial({ color: 0xff7ab0, metalness: 0.4, roughness: 0.3, emissive: 0x551030 });
const gateSteel = new THREE.MeshStandardMaterial({ color: 0xd8e0e8, metalness: 0.8, roughness: 0.2, emissive: 0x30363c });
const gateIce = new THREE.MeshStandardMaterial({ color: 0x9fe4ff, metalness: 0.5, roughness: 0.25, emissive: 0x114466 });
const gemOn = new THREE.MeshBasicMaterial({ color: 0xffe066 }), gemOff = new THREE.MeshLambertMaterial({ color: 0x4a4658 });
const texSwirl = canvasTex(128, (g, s) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s); g.lineCap = 'round';
  const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#3a6cff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  for (let arm = 0; arm < 5; arm++) {
    g.strokeStyle = ['#7fd8ff', '#ffe066', '#ffffff', '#b58cff', '#7fd8ff'][arm]; g.lineWidth = 4; g.beginPath();
    for (let r = 4; r < 62; r += 2) { const a = arm * Math.PI * 0.4 + r * 0.085; const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r; if (r === 4) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
}, false);
function makeGate(x, y, z, to, needs, { count = world1Stars, rot = 0, name = 'Star Gate', gold = gateGold, of = '' } = {}) {
  const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = rot; scene.add(root);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.32, 10, 40), gateStone); ring.position.y = 2.2; ring.castShadow = true; root.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.15, 40), new THREE.MeshBasicMaterial({ map: texSwirl, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.y = 2.2; root.add(disc);
  for (const sx of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.3), matStone); f.position.set(sx * 2.1, 0.3, 0); f.castShadow = f.receiveShadow = true; root.add(f); }
  const sockets = [];
  for (let i = 0; i < needs; i++) {
    const a = lerp(2.75, 0.39, i / Math.max(1, needs - 1));
    const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), gemOff); gm.scale.z = 2; gm.position.set(Math.cos(a) * 2.3, 2.2 + Math.sin(a) * 2.3, 0); root.add(gm); sockets.push(gm);
  }
  const g = { root, ring, disc, sockets, pos: root.position, to, needs, count, name, gold, of, hintT: 0, open: false }; gates.push(g); return g;
}
function updateGates(dt) {
  G.gateCool -= dt;
  for (const g of gates) {
    const n1 = g.count(), open = n1 >= g.needs; g.open = open;
    g.disc.visible = open; g.disc.rotation.z -= dt * 1.6; g.ring.material = open ? g.gold : gateStone;
    g.sockets.forEach((m, i) => { m.material = i < n1 ? gemOn : gemOff; m.rotation.z += dt * (i < n1 ? 2 : 0); });
    if (G.mode !== 'play') continue;
    const d = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z), dy = player.pos.y - g.pos.y;
    if (d > 6 || dy < -1 || dy > 4.5) continue;
    if (open) {
      if (Math.random() < dt * 10) burst(new THREE.Vector3(g.pos.x + (Math.random() - 0.5) * 3.4, g.pos.y + 0.6 + Math.random() * 3.4, g.pos.z), { n: 1, color: 0x9fd8ff, speed: 0.8, size: 0.14, life: 0.8, up: 1 });
      if (d < 1.5 && G.gateCool <= 0) travel(g.to);
    } else if ((g.hintT -= dt) <= 0) { g.hintT = 5; toast(`The ${g.name} sleeps… ${n1} / ${g.needs} Golden Stars${g.of}`, 2.6); }
  }
}
const ENV = {
  1: { top: 0x3a8cf0, bottom: 0xcfe9ff, fogN: 90, fogF: 300, sky: 0xeaf6ff, gnd: 0x5d7a3a, hemiI: 1.6, sun: 0xfff2dd, sunI: 2.4 },
  2: { top: 0x2a1446, bottom: 0xff9a55, fogN: 60, fogF: 250, sky: 0xffc9a0, gnd: 0x7a3010, hemiI: 1.5, sun: 0xffb880, sunI: 2.1 },
  4: { top: 0x6fb4ff, bottom: 0xffd0e6, fogN: 80, fogF: 300, sky: 0xfff0f6, gnd: 0xc08060, hemiI: 1.7, sun: 0xfff0d8, sunI: 2.3 },
  5: { top: 0xfff4dc, bottom: 0xf0d8b0, fogN: 110, fogF: 380, sky: 0xfff6e8, gnd: 0xb09070, hemiI: 1.7, sun: 0xfff0d0, sunI: 2.2 },
  3: { top: 0x0e1650, bottom: 0x7fd0de, fogN: 70, fogF: 280, sky: 0xd8f0ff, gnd: 0x6a8cc0, hemiI: 1.7, sun: 0xdfe8ff, sunI: 1.9 },
};
function setEnv(w) {
  const e = ENV[w], u = scene.userData.sky.material.uniforms;
  u.top.value.set(e.top); u.bottom.value.set(e.bottom); scene.fog.color.set(e.bottom); scene.fog.near = e.fogN; scene.fog.far = e.fogF;
  hemi.color.set(e.sky); hemi.groundColor.set(e.gnd); hemi.intensity = e.hemiI; sun.color.set(e.sun); sun.intensity = e.sunI;
  setMusicMood(w);
}
const WORLD_BANNER = {
  1: 'GARDEN ISLE<small>Home sweet home</small>',
  2: 'ISOLA BRACE<small>The Ember Isle — mind the hot sauce!</small>',
  3: 'MARE SURGELATO<small>The Frozen Sea — do not swim for long!</small>',
  4: 'DOLCETERRA<small>The Sugar Isles — do not sink in the chocolate!</small>',
  5: 'LA GRANDE CUCINA<small>The Giant Kitchen — mind the knives!</small>',
};
const ARRIVE = { 1: new THREE.Vector3(0, 0.2, 49), 2: new THREE.Vector3(W2X, 1.2, 45), 3: new THREE.Vector3(W3X, 0.6, 45), 4: new THREE.Vector3(W4X, 1.2, 45), 5: new THREE.Vector3(W5X, 1.2, 45) };
function travel(to) {
  if (G.mode !== 'play') return;
  G.mode = 'travel'; G.travelT = 0; G.travelTo = to; G.travelDone = false; sfx.appear(); $('fade').classList.add('on');
}
function arriveWorld(w) {
  const p = player; G.world = w; p.pos.copy(ARRIVE[w]); p.vel.set(0, 0, 0); p.facing = Math.PI; p.action = 'normal'; p.onGround = false;
  p.lastSafe.copy(p.pos); G.checkpoint.copy(ARRIVE[w]); G.gateCool = 1.5;
  camState.yaw = 0; camState.pitch = 0.36; camState.snap = true; setEnv(w); animatePlayer(0.016);
}

// ---------------------------------------------------------------------------
// World 2: Isola Brace, the Ember Isle
// ---------------------------------------------------------------------------
function buildWorld2() {
  const X = W2X, B = { mat: 'basalt' }, S = { mat: 'stone' };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const w2 = (type, range = 4) => ({ type, w: 2, range });
  // sea of hot sauce + far-away rock spires
  texLava.repeat.set(44, 44);
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: texLava }));
  lava.rotation.x = -Math.PI / 2; lava.position.set(X, LAVA, 0); scene.add(lava);
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x3a2b30, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.3, r = 108 + rand() * 50, h = 16 + rand() * 34;
    const m = new THREE.Mesh(new THREE.ConeGeometry(5 + rand() * 9, h, 6), spireMat); m.position.set(X + Math.cos(a) * r, LAVA + h / 2 - 1, Math.sin(a) * r); scene.add(m);
  }
  // griddle plates (moving) and stone ledges (static)
  const slab = (cx, top, cz, fn, w = 3, d = 3) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), matGriddle); m.castShadow = m.receiveShadow = true;
    mover(m, V(X + cx, top - 0.3, cz), fn);
  };
  const ledge = (cx, top, cz) => terrainBox(X + cx - 1.5, X + cx + 1.5, top - 0.5, top, cz - 1.5, cz + 1.5, S);

  // --- Arrival dock (south) ---
  terrainBox(X - 8, X + 8, -4, 1, 40, 62, B);
  makeGate(X, 1, 59.5, 1, 0);
  makeGate(X - 6.3, 1, 51, 3, 5, { count: world2Stars, rot: Math.PI / 2, name: 'Ice Gate', gold: gateIce, of: ' of Isola Brace' });
  place('barrel', X - 6, 1, 42, { s: 2.4, solid: true }); place('rocks', X + 6.3, 1, 60, { s: 2.5, solid: true, shrink: 0.3 }); place('sign', X + 3, 1, 41, { s: 2.5 });
  lemon(X - 6, 2.2, 60);
  npc('radish', 'Ravanello the Scout', X + 5, 44.5, 4, [
    'Capitano! You came through the Star Gate! Welcome to Isola Brace, the Ember Isle.',
    'Don Prosciutto and his meaty gang grabbed 5 Golden Stars and turned our island into one big barbecue!',
    'Careful: the sea here is boiling hot sauce. Fall in and you will bounce right out with a burnt bottom!',
    'The gate behind you leads back to the Garden Isle whenever you like.',
  ], { y: 1, eyes: { hf: 0.55 } });
  // bridge with leaping ember fish
  terrainBox(X - 2, X + 2, -4, 1, 30, 40, S);
  coinLine([X, 1.7, 39], [X, 1.7, 31], 5);
  ember(X - 4.5, 33, { dx: 9, height: 3.6, period: 2.6 }); ember(X + 4.5, 37, { dx: -9, height: 3.6, period: 2.6, phase: 1.3 });

  // --- Piazza Brace (centre) ---
  terrainBox(X - 20, X + 20, -4, 1, 2, 30, B);
  place('pot-stew', X, 1, 16, { s: 7, solid: true, shrink: 0.35 }); lemon(X, 4.1, 16);
  place('bottle-ketchup', X - 17, 1, 5.5, { s: 3, solid: true, shrink: 0.2 });
  place('frying-pan', X + 15, 1, 7, { s: 5, r: 0.5 });
  place('rocks', X - 18, 1, 19, { s: 2.5, solid: true, shrink: 0.3 }); place('stones', X + 8, 1, 4, { s: 2.4 }); place('stones', X - 9, 1, 21, { s: 2.4 });
  checkpoint(X - 3.5, 1, 28);
  coinRing(X, 1.8, 16, 5.5, 8); coinLine([X - 16, 1.7, 12], [X - 8, 1.7, 4], 5); coinLine([X + 8, 1.7, 12], [X + 16, 1.7, 12], 5);
  crate(X + 11.2, 26.5, 'heart', 1); crate(X + 14, 26.5, 'coins', 1); crate(X + 16.8, 26.5, 'lemon', 1);
  heartPickup(X - 16, 1.5, 27);
  steak(X - 10, 13, { y: 1, ...w2('ribs', 5) }); steak(X + 10, 16, { y: 1, ...w2('ribs', 5) }); steak(X + 2, 6, { y: 1, ...w2('ribs', 4) });
  steak(X - 15, 8, { y: 1, ...w2('sausage', 4) }); steak(X + 16, 20, { y: 1, ...w2('sausage', 4) });
  npc('onion', 'Cipollina', X - 5.5, 26.5, 8, () => {
    const left = enemies.filter((x) => x.armored && x.alive).length;
    if (left === 0) return ['*sniff* No more ribs! These are tears of joy, Capitano!'];
    return ['*sniff* It is not the onions, it is the smoke… *sniff*', 'Racks of ribs are stomping all over the isle. They are so bony that a sword just goes CLANG!',
      `Jump on them, ground pound them — or knock them into the sauce. ${left} of them are left.`];
  }, { y: 1, eyes: { hf: 0.5 } });
  npc('beet', 'Barbabietola', X + 5.5, 26.5, 10, () => G.stars.has('lemons') && G.lemons >= 8 ? ['Lemonade for everybody! Nothing cools a volcano better.'] : [
    'Phew, it is HOT here. I would give anything for a glass of lemonade!',
    `Eight Sunny Lemons are hidden around the isle — you have ${G.lemons} of 8. Look in crates, on high places and far corners.`,
    'Bring them all and a Golden Star will appear right here in the piazza!',
  ], { y: 1, eyes: { hf: 0.5 } });

  // --- stepping across to Vulcano Ragù (north) ---
  terrainBox(X - 1.5, X + 1.5, -4, 1.2, -2, 0, S); lemon(X, 2.4, -1);
  slab(0, 1.3, -4.5, (t) => V(Math.sin(t * 0.9) * 3, 0, 0));
  ember(X - 4.5, 1, { dx: 9, height: 3.4, period: 3, phase: 0.5 });
  terrainBox(X - 18, X + 18, -4, 2, -46, -8, B);          // foot
  ramp(X - 3, X + 3, -18, -10, 2, 2, 6, 'z', -1, matBasaltTop);
  terrainBox(X - 13, X + 13, 2, 6, -44, -18, B);          // tier 2
  terrainBox(X - 8, X + 8, 6, 10, -42, -24, B);           // summit
  checkpoint(X + 6, 2, -9.5);
  npc('broccoli', 'Broccoletta', X - 6.5, -10.5, 4, () => G.stars.has('ham') ? ['Vulcano Ragù is ours again. Grazie, Capitano!'] : [
    'Don Prosciutto sits on the very top of Vulcano Ragù.',
    'Take the ramp, then use the spring on the west side — or the griddle lift on the east side.',
    'He is faster than King Steak and needs FOUR bonks. Wait until he crashes and sees stars!',
  ], { y: 2, eyes: { hf: 0.62 } });
  steak(X + 15.5, -28, { y: 2, ...w2('ribs', 3) }); steak(X - 15.5, -30, { y: 2, ...w2('sausage', 3) });
  coinLine([X + 15.5, 2.7, -14], [X + 15.5, 2.7, -40], 7); lemon(X, 3.2, -45);
  steak(X + 8, -21, { y: 6, ...w2('ribs', 3) });
  spring(X - 10.5, 6, -33);
  slab(10.5, 8.1, -33, (t) => V(0, Math.sin(t * 1.1) * 2, 0)); lemon(X + 10.5, 11.3, -33);
  heartPickup(X + 11, 6.5, -21); checkpoint(X - 6, 6, -20.5);
  coinLine([X - 11, 6.7, -22], [X - 11, 6.7, -29], 4); coinLine([X - 10, 6.7, -43], [X + 10, 6.7, -43], 6);
  place('poles', X - 7, 10, -41, { s: 2 }); place('poles', X + 7, 10, -41, { s: 2 });
  coinRing(X, 10.8, -33, 5.5, 8);
  makeBoss(X, 10, -35, { x0: X - 8, x1: X + 8, z0: -42, z1: -24, y: 10 }, {
    model: 'whole-ham', s: 8, name: 'Don Prosciutto', star: 'ham', hp: 4, chaseT: 2.1, stunT: 2.7, jumpEvery: 2, fast: 1.2, r: 2.3, crownZ: 0.8, gem: 0xff3355,
    eyes: { hf: 0.6, size: 0.11, spread: 0.2 },
    intro: ['MAMMA MIA! A cherry tomato in a pirate hat climbs MY volcano?!', 'I am Don Prosciutto, the saltiest ham of the seven seas! Into the ragù with you!', '(Tip: same trick as King Steak — but he is faster and needs four hits.)'],
  });

  // --- the Sizzling Sauce crossing (east) ---
  terrainBox(X + 23, X + 27, -4, 1, 14, 18, S); coin(X + 25, 1.7, 16);
  ember(X + 28, 16, { height: 4.5, period: 2.2 });
  slab(30.5, 1.1, 16, (t) => V(0, 0, Math.sin(t) * 3));
  terrainBox(X + 34, X + 37.5, -4, 1, 14, 18, S); lemon(X + 35.75, 2.2, 16);
  slab(41, 1.1, 16, (t) => V(Math.sin(t * 0.8) * 1.5, 0, 0));
  ember(X + 45, 16, { height: 4.5, period: 2.6, phase: 1 });
  terrainBox(X + 46, X + 56, -4, 1, 10, 22, B);
  checkpoint(X + 47.5, 1, 20.5); heartPickup(X + 48, 1.5, 12);
  terrainBox(X + 50, X + 53, 1, 2.6, 15, 18, S);
  spawnStar('crossing', V(X + 51.5, 3.4, 16.5), { silent: true });
  npc('mushroom', 'Funghetto', X + 54, 12, 14, ['You crossed the Sizzling Sauce! I have been stuck out here for days.', 'Those ember fish are only bones — you cannot bop them, so just dodge them.', 'The star on that stone is all yours, Capitano!'], { y: 1, eyes: { hf: 0.45 } });

  // --- Spiedino Spire (west) ---
  slab(-23, 1.1, 16, (t) => V(Math.sin(t * 0.8) * 1.2, 0, 0));
  ember(X - 23, 20.5, { dz: -9, height: 3.4, period: 2.8 });
  terrainBox(X - 44, X - 26, -4, 1, 6, 26, B);
  const PC = { x: -34, z: 16 };
  terrainBox(X + PC.x - 2, X + PC.x + 2, 1, 15.4, PC.z - 2, PC.z + 2, S);
  ledge(PC.x, 2.5, PC.z + 3.5); coin(X + PC.x, 3.3, PC.z + 3.5);
  slab(PC.x, 4.0, PC.z, (t) => V(Math.cos(t * 0.55) * 7.5, 0, Math.sin(t * 0.55) * 7.5));
  ledge(PC.x, 5.5, PC.z - 3.5); coin(X + PC.x, 6.3, PC.z - 3.5);
  slab(PC.x, 7.0, PC.z, (t) => V(Math.cos(2 - t * 0.5) * 7.5, 0, Math.sin(2 - t * 0.5) * 7.5));
  ledge(PC.x + 3.5, 8.5, PC.z); lemon(X + PC.x + 3.5, 9.7, PC.z);
  slab(PC.x + 3.5, 11.85, PC.z + 4, (t) => V(0, Math.sin(t * 0.9) * 2.25, 0));
  ledge(PC.x, 13.9, PC.z + 3.5); coin(X + PC.x, 14.7, PC.z + 3.5);
  spawnStar('skewer', V(X + PC.x, 16.3, PC.z), { silent: true });
  checkpoint(X - 28.5, 1, 22.5);
  steak(X - 40, 10, { y: 1, ...w2('ribs', 4) });
  coinLine([X - 42, 1.7, 8], [X - 42, 1.7, 24], 6);
  npc('cabbage', 'Donna Verza', X - 40, 22, 6.5, () => G.stars.has('skewer') ? ['You climbed the whole Spiedino Spire! My leaves are trembling.'] : [
    'This is the Spiedino Spire. A Golden Star is stuck on its very top!',
    'Hop from the stone ledges onto the griddle plates that circle the spire.',
    'High up on the east side a lift carries you the rest of the way. Buona fortuna!',
  ], { y: 1, eyes: { hf: 0.5 } });
}

// ---------------------------------------------------------------------------
// World 3: Mare Surgelato, the Frozen Sea
// ---------------------------------------------------------------------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const matIceBlock = new THREE.MeshLambertMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.5 });
const peaPod = new THREE.MeshLambertMaterial({ color: 0x58c040 }), peaBall = new THREE.MeshLambertMaterial({ color: 0xa8f070 });
function pea(x, y, z) {
  const m = new THREE.Group(), pod = new THREE.Group(); m.add(pod); pod.rotation.z = 0.5; pod.position.y = 0.45;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8), peaPod); shell.scale.set(1.7, 0.42, 0.55); pod.add(shell);
  for (let i = -1; i <= 1; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), peaBall); b.position.set(i * 0.42, 0.12, 0); pod.add(b); }
  return addItem('pea', m, V3(x, y, z));
}
// a woolly scarf for a vegetable friend
function scarf(n, color = 0xe8352b) {
  const mat = new THREE.MeshLambertMaterial({ color }), r = n.rad * 1.05;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.1, r * 0.2), 8, 20), mat); ring.rotation.x = Math.PI / 2; ring.position.y = n.h * 0.4; n.root.add(ring);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, r * 0.45), n.h * 0.28, 0.14), mat); tail.position.set(r * 0.5, n.h * 0.27, r * 1.0); n.root.add(tail);
  return n;
}
// Cracking floes: break a moment after you land on them, grow back later
const floes = [];
function floe(x, top, z, w = 3, d = 3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), six(matIceSide, matFloeTop)); m.position.set(x, top - 0.35, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  const sd = addSolid({ x: x - w / 2, y: top - 0.7, z: z - d / 2 }, { x: x + w / 2, y: top, z: z + d / 2 }, { floe: true });
  floes.push({ m, sd, x, z, y: top, t: 0, state: 'idle' });
}
function updateFloes(dt) {
  for (const f of floes) {
    f.t += dt;
    if (f.state === 'idle') {
      if (f.m.scale.x < 1) f.m.scale.setScalar(Math.min(1, f.m.scale.x + dt * 3));
      if (player.onGround && player.ground === f.sd) { f.state = 'shake'; f.t = 0; sfx.talk(); }
    } else if (f.state === 'shake') {
      f.m.position.x = f.x + Math.sin(f.t * 55) * 0.05; f.m.rotation.z = Math.sin(f.t * 40) * 0.025;
      if (f.t > 0.9) {
        f.state = 'gone'; f.t = 0; f.m.visible = false; f.sd.min.y -= 500; f.sd.max.y -= 500; sfx.crate();
        burst(V3(f.x, f.y, f.z), { n: 12, color: 0xc8ecff, speed: 5, size: 0.3, grav: 20, life: 0.7, up: 4 });
      }
    } else if (f.t > 3.5 && Math.hypot(player.pos.x - f.x, player.pos.z - f.z) > 3.2) {
      f.state = 'idle'; f.m.visible = true; f.m.position.x = f.x; f.m.rotation.z = 0; f.m.scale.setScalar(0.2); f.sd.min.y += 500; f.sd.max.y += 500;
    }
  }
}
// Conveyor belts: carry whoever stands on them
const belts = [];
const matBeltSide = new THREE.MeshLambertMaterial({ color: 0x3a3f4b });
function belt(x0, x1, z0, z1, top, vx, vz) {
  const w = x1 - x0, d = z1 - z0, tex = texBelt.clone(); tex.needsUpdate = true; tex.repeat.set(w / 2, d / 2);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), six(matBeltSide, new THREE.MeshLambertMaterial({ map: tex })));
  m.position.set((x0 + x1) / 2, top - 0.4, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; scene.add(m);
  addSolid({ x: x0, y: top - 0.8, z: z0 }, { x: x1, y: top, z: z1 }, { belt: { x: vx, z: vz } });
  belts.push({ tex, vx, vz });
}
// Timed run: a button starts the clock and makes a star appear at the far end
const run = { pad: null, end: null, btn: null, T: 20 };
function runPad(x, y, z, end) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.16, 20), matStone); base.position.set(x, y + 0.08, z); base.receiveShadow = true; scene.add(base);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 20), new THREE.MeshLambertMaterial({ color: 0xe8352b, emissive: 0x551008 })); btn.position.set(x, y + 0.16, z); scene.add(btn);
  run.pad = V3(x, y, z); run.end = end; run.btn = btn;
}
function updateRun(dt) {
  if (!run.pad) return;
  if (G.runT > 0) {
    G.runT -= dt; run.btn.scale.y = 0.3;
    if (G.runT <= 0) {
      G.runT = 0; const it = starMeshes.belt; if (it) { it.active = false; scene.remove(it.mesh); delete starMeshes.belt; }
      if (G.world === 3) { toast("Time's up! Press the red button to try again.", 3); sfx.hurt(); }
    }
  } else {
    run.btn.scale.y = 1;
    if (G.mode === 'play' && player.onGround && Math.hypot(player.pos.x - run.pad.x, player.pos.z - run.pad.z) < 1.2 && Math.abs(player.pos.y - run.pad.y) < 1) {
      G.runT = run.T; spawnStar('belt', run.end, { silent: true }); sfx.appear(); toast('GO! Grab the star at the end of the belts before time runs out!', 3);
    }
  }
}
// Wind gusts: push the player sideways for a moment, every few seconds
const winds = [];
function windZone(min, max, dir, period = 5.5, onT = 1.8) { winds.push({ min, max, dir, period, onT, was: false }); }
const windOn = (w) => (G.time % w.period) < w.onT;
function updateWinds(dt) {
  for (const w of winds) {
    const on = windOn(w), near = G.world === 3 && player.pos.x > w.min.x - 14 && player.pos.x < w.max.x + 14 && player.pos.z > w.min.z - 14 && player.pos.z < w.max.z + 14;
    if (on && !w.was && near) sfx.slash();
    w.was = on;
    if (!on || !near) continue;
    for (let k = 0; k < 3; k++) if (Math.random() < dt * 25) {
      const m = new THREE.Mesh(pGeo, pMat(0xffffff)); m.position.set(lerp(w.min.x, w.max.x, Math.random()), lerp(w.min.y, w.max.y, Math.random()), lerp(w.min.z, w.max.z, Math.random())); scene.add(m);
      particles.push({ m, v: V3(w.dir.x * 3.5, 0, w.dir.z * 3.5), life: 0.7, max: 0.7, size: 0.17, grav: 0 });
    }
  }
}
// Frozen villagers: vegetables stuck in ice blocks, freed with a slash or a ground pound nearby
const frozen = [];
function frozenVillager(model, s, x, y, z, name) {
  const veg = inst(model, s); veg.position.set(x, y, z); scene.add(veg); addEyes(veg, { size: 0.12, hf: 0.55 });
  veg.updateWorldMatrix(true, true); const sz = new THREE.Box3().setFromObject(veg).getSize(new THREE.Vector3());
  const w = Math.max(sz.x, sz.z) + 0.7, h = sz.y + 0.5;
  const ice = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), matIceBlock); ice.position.set(x, y + h / 2, z); scene.add(ice);
  const sd = addSolid({ x: x - w / 2, y, z: z - w / 2 }, { x: x + w / 2, y: y + h, z: z + w / 2 }, { ice: true });
  const f = { veg, ice, sd, name, pos: V3(x, y, z), h, done: false, t: 0 }; frozen.push(f); return f;
}
function thaw(f) {
  if (f.done) return; f.done = true; scene.remove(f.ice); removeSolid(f.sd); sfx.crate(); sfx.redcoin(); G.thawed++;
  burst(f.pos.clone().add(V3(0, f.h / 2, 0)), { n: 20, color: 0xc8ecff, speed: 7, size: 0.35, grav: 20, life: 0.8, up: 6 });
  toast(`"Grazie, Capitano!" ${f.name} is free (${G.thawed} / 5)`, 2.4);
  if (G.thawed === 5) spawnStar('thaw', V3(W3X - 3, 3.7, 13));
}
// Boss: Il Tonno Padrino. Swims under the ice (watch the shadow), bursts up where you stand,
// then flops on the ice for a moment — that is when a slash, a stomp or a ground pound hurts him.
function makeTuna(x, y, z, arena) {
  const root = new THREE.Group(); root.position.set(x, y + 1.44, z); scene.add(root);
  const tilt = new THREE.Group(); root.add(tilt);
  const s = 9, body = inst('fish', s); body.position.y = -0.16 * s; tilt.add(body);   // 5.6 long (z), 2.9 tall, 1.8 thick, centred on the pivot
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeWhite); eye.scale.setScalar(0.34); eye.position.set(side * 0.62, 0.45, 1.75); tilt.add(eye);
    const pupil = new THREE.Mesh(eyeGeo, eyeBlack); pupil.scale.setScalar(0.5); pupil.position.set(side * 0.55, 0, 0.45); eye.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.8), eyeBlack); brow.position.set(side * 0.7, 0.86, 1.75); brow.rotation.x = -0.4; tilt.add(brow);
  }
  const crown = new THREE.Group(); const gold = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.6, roughness: 0.3 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.4, 14, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 6), gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.72, 0.45, Math.sin(a) * 0.72); crown.add(sp); }
  crown.position.set(0, 1.62, 1.0); crown.traverse((c) => c.isMesh && (c.castShadow = true)); tilt.add(crown);
  const dizzy = new THREE.Group(); for (let i = 0; i < 3; i++) { const st = inst('star', 1.7, false); st.position.set(Math.cos(i * 2.1) * 1.8, 0, Math.sin(i * 2.1) * 1.8); dizzy.add(st); }
  dizzy.position.y = 2.2; dizzy.visible = false; root.add(dizzy);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.5, 28), new THREE.MeshBasicMaterial({ color: 0x0c2a48, transparent: true, opacity: 0.6, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(0.75, 1.3, 1); shadow.visible = false; scene.add(shadow);
  const b = { kind: 'tuna', root, tilt, body, dizzy, shadow, pos: root.position, r: 2.4, h: 1.8, alive: true, hp: 4, maxHp: 4, state: 'sleep', t: 0, arena, home: V3(x, y, z), sx: x, sz: z, yaw: 0 };
  enemies.push(b); return b;
}
function hitTuna(b) {
  b.hp--; b.state = 'hurt'; b.t = 0; sfx.bossHit(); shake = 0.4;
  burst(b.pos.clone().add(V3(0, 1.5, 0)), { n: 20, color: 0x9fd8ff, speed: 7, life: 0.7 });
  toast(b.hp > 1 ? 'Splat! Again!' : b.hp === 1 ? 'One more hit!' : 'BLUB! My crown!', 1.6);
}
function updateTuna(b, dt) {
  const A = b.arena, fy = A.y, p = player;
  if (!b.alive) {
    b.t += dt; b.root.scale.set(1 + b.t, Math.max(0.02, 1 - b.t * 1.2), 1 + b.t);
    if (b.t > 0.9 && !b.gone) { b.gone = true; scene.remove(b.root); scene.remove(b.shadow); burst(b.pos.clone(), { n: 40, color: 0xffffff, speed: 9, size: 0.6, life: 1 }); spawnStar('tuna', V3(b.home.x, fy + 2.2, b.home.z)); }
    return;
  }
  b.t += dt;
  const inArena = p.pos.y > fy - 0.5 && p.pos.x > A.x0 && p.pos.x < A.x1 && p.pos.z > A.z0 && p.pos.z < A.z1;
  const hits = b.maxHp - b.hp, T = b.tilt;
  b.dizzy.visible = b.state === 'flop'; b.shadow.visible = b.state === 'under' || b.state === 'warn';
  switch (b.state) {
    case 'sleep':
      T.rotation.set(0, 0, Math.sin(b.t * 1.5) * 0.05);
      if (inArena && G.mode === 'play') {
        b.state = 'intro'; b.t = 0;
        openDialog('Il Tonno Padrino', ['BLUB BLUB! Who is skating on MY frozen hold?!', 'I am Il Tonno Padrino, godfather of the Frozen Sea. Nobody stomps the Padrino!', '(Tip: watch his shadow under the ice and keep moving. When he flops onto the ice he is helpless: slash him with your sword, or jump on him.)']);
      }
      break;
    case 'intro': if (G.mode === 'play') { b.state = 'dive'; b.t = 0; } break;
    case 'dive': // sinks through the ice
      b.pos.y -= dt * 7;
      if (b.t > 0.75) { b.state = 'under'; b.t = 0; b.root.visible = false; b.sx = b.pos.x; b.sz = b.pos.z; sfx.splash(); }
      break;
    case 'under': {
      if (!inArena) b.t -= dt; // waits for you to come back
      else {
        const dx = p.pos.x - b.sx, dz = p.pos.z - b.sz, d = Math.hypot(dx, dz), v = (5.5 + hits * 0.9) * dt;
        if (d > v) { b.sx += dx / d * v; b.sz += dz / d * v; } else { b.sx = p.pos.x; b.sz = p.pos.z; }
        b.yaw = Math.atan2(dx, dz);
      }
      b.sx = clamp(b.sx, A.x0 + 2, A.x1 - 2); b.sz = clamp(b.sz, A.z0 + 2, A.z1 - 2);
      b.shadow.rotation.z = -b.yaw; b.shadow.scale.set(0.75, 1.3, 1);
      if (b.t > 2.6 - hits * 0.3) { b.state = 'warn'; b.t = 0; sfx.crate(); }
      break;
    }
    case 'warn': {
      const k = 1 + Math.sin(b.t * 30) * 0.12; b.shadow.scale.set(0.75 * k, 1.3 * k, 1);
      if (Math.random() < dt * 30) burst(V3(b.sx + (Math.random() - 0.5) * 3, fy + 0.1, b.sz + (Math.random() - 0.5) * 3), { n: 1, color: 0xc8ecff, speed: 3, grav: 15, up: 4, size: 0.2, life: 0.4 });
      if (b.t > 0.65) {
        b.state = 'burst'; b.t = 0; b.root.visible = true; b.pos.set(b.sx, fy - 3, b.sz); sfx.splash(); sfx.pound(); shake = 0.3;
        burst(V3(b.sx, fy + 0.2, b.sz), { n: 18, color: 0xc8ecff, speed: 7, size: 0.35, grav: 20, life: 0.8, up: 8 });
      }
      break;
    }
    case 'burst': {
      const j = b.t / 1.1;
      if (j < 0.5) { b.pos.y = fy - 3 + 8.5 * Math.sin(j * Math.PI); T.rotation.set(-Math.PI / 2, 0, 0); }
      else { const u = Math.min(1, (j - 0.5) / 0.5); b.pos.y = fy + 0.9 + 4.6 * (1 - u * u); T.rotation.set(lerp(-Math.PI / 2, 0, u), 0, lerp(0, Math.PI / 2, u)); }
      if (j >= 1) {
        b.state = 'flop'; b.t = 0; b.pos.y = fy + 0.9; sfx.pound(); shake = 0.4;
        ringFx(V3(b.pos.x, fy, b.pos.z), hits >= 1 ? { color: 0xc8ecff, life: 1.2, hurt: true, speed: 9 } : { max: 4 });
      }
      break;
    }
    case 'flop':
      T.rotation.set(0, Math.sin(b.t * 9) * 0.12, Math.PI / 2 + Math.sin(b.t * 7) * 0.08); b.dizzy.rotation.y += dt * 4;
      if (b.t > 3.3 - hits * 0.3) { b.state = 'dive'; b.t = 0; }
      break;
    case 'hurt':
      b.root.visible = Math.floor(b.t * 20) % 2 === 0;
      if (b.t > 1.0) { b.root.visible = true; if (b.hp <= 0) { b.alive = false; b.t = 0; sfx.bossHit(); } else { b.state = 'dive'; b.t = 0; } }
      break;
  }
  b.shadow.position.set(b.sx, fy + 0.05, b.sz); b.root.rotation.y = b.yaw;
  if (G.mode !== 'play' || p.dead) return;
  const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z, d = Math.hypot(dx, dz);
  if (b.state === 'burst') {
    if (d < 1.5 + p.r && p.pos.y < b.pos.y + 3 && p.pos.y + p.h > b.pos.y - 3) hurtPlayer(2, V3(b.pos.x, p.pos.y, b.pos.z));
  } else if (b.state === 'flop' && d < b.r + p.r && p.pos.y - fy > -1 && p.pos.y - fy < 2.4) {
    const a = Math.atan2(dx, dz);
    if (p.action === 'gpFall' || (p.vel.y < 0 && p.pos.y - fy > 1)) { hitTuna(b); p.bounce(14); p.vel.x = Math.sin(a) * 8; p.vel.z = Math.cos(a) * 8; }
    else { p.pos.x = b.pos.x + Math.sin(a) * (b.r + p.r); p.pos.z = b.pos.z + Math.cos(a) * (b.r + p.r); }
  }
}

function buildWorld3() {
  const X = W3X, Y = 0.4, SN = { mat: 'snow' }, IC = { mat: 'ice' };
  const w3 = (type, range = 5) => ({ type, w: 3, range, y: Y });
  const wall = (x0, x1, y0, y1, z0, z1, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true; scene.add(m); return addSolid({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 });
  };
  const iceSlab = (cx, top, cz, fn, w = 3, d = 3) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), six(matIceSide, matSnow)); m.castShadow = m.receiveShadow = true;
    mover(m, V3(X + cx, top - 0.3, cz), fn);
  };
  const tree = (x, z, y = Y, pine = false) => place(pine ? 'tree-pine-snow' : 'tree-snow', X + x, y, z, { s: 2.3, solid: true, shrink: 0.85 });

  // freezing sea, sea bed, icebergs, aurora
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ map: texWater, color: 0x86b8ee, transparent: true, opacity: 0.84, depthWrite: false }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(X, COLD, 0);
  const su = sea.geometry.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) * 70, su.getY(i) * 70);
  scene.add(sea);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ color: 0x1c4478 })); bed.rotation.x = -Math.PI / 2; bed.position.set(X, -7, 0); scene.add(bed);
  const bergMat = new THREE.MeshLambertMaterial({ color: 0xe8f4ff, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.3, r = 110 + rand() * 50, h = 10 + rand() * 26;
    const m = new THREE.Mesh(new THREE.ConeGeometry(6 + rand() * 10, h, 5), bergMat); m.position.set(X + Math.cos(a) * r, COLD + h / 2 - 1, Math.sin(a) * r); m.rotation.y = rand() * 3; scene.add(m);
  }
  const texAur = canvasTex(64, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#000'); gr.addColorStop(0.4, '#2fe0a0'); gr.addColorStop(0.75, '#2a6ad0'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.6})`; g.fillRect(x, 0, 2, s); }
  });
  for (const [r, y, h, a0, len] of [[240, 105, 70, 0.3, 1.6], [290, 135, 80, 2.5, 1.4], [220, 95, 60, 4.3, 1.3]]) {
    const t = texAur.clone(); t.needsUpdate = true; t.repeat.set(3, 1);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true, a0, len), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.position.set(X, y, 0); scene.add(m);
  }

  // --- Arrival floe (south) ---
  terrainBox(X - 8, X + 8, -4, Y, 40, 62, SN);
  makeGate(X, Y, 59.5, 2, 0, { name: 'Ice Gate', gold: gateIce });
  makeGate(X - 6.3, Y, 51, 4, 5, { count: world3Stars, rot: Math.PI / 2, name: 'Candy Gate', gold: gateCandy, of: ' of Mare Surgelato' });
  tree(-6.3, 60, Y, true); tree(6.3, 59.5); place('sign', X + 3, Y, 41, { s: 2.5 });
  crate(X - 6, 43, 'pea', Y);
  scarf(npc('broccoli', 'Broccolino', X + 5, 44.5, 4, [
    'C-c-capitano! You c-came through the Ice Gate! Welcome to Mare Surgelato, the Frozen Sea.',
    'Il Tonno Padrino and his fishy gang froze everything, and took 5 Golden Stars!',
    'The blue ice is slippery — you keep sliding, so start braking early. The white snow is fine.',
    'You can swim here, but the water is freezing: stay in too long and you lose health. And the cracked floes break under your feet!',
  ], { y: Y, eyes: { hf: 0.62 } }));
  // cracking floes up to the piazza
  floe(X, Y, 37.5); floe(X, Y, 33.5); floe(X, Y, 30);
  coin(X, Y + 0.9, 37.5); coin(X, Y + 0.9, 33.5); coin(X, Y + 0.9, 30);

  // --- Piazza Ghiaccio (centre): one big slippery rink with a snowy middle ---
  terrainBox(X - 20, X + 20, -4, Y, 0, 27.5, IC);
  terrainBox(X - 6, X + 6, -3, Y + 0.06, 8, 18, SN);
  checkpoint(X - 3.5, Y, 25.5);
  const igloo = new THREE.Mesh(new THREE.SphereGeometry(3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), matSnow); igloo.position.set(X - 13, Y, 21); igloo.castShadow = igloo.receiveShadow = true; scene.add(igloo);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x1c2a48 })); door.position.set(X - 13, Y + 0.75, 23.75); scene.add(door);
  addSolid({ x: X - 15.1, y: Y, z: 18.9 }, { x: X - 10.9, y: Y + 2.5, z: 23.1 });
  pea(X - 13, Y + 3.5, 21);
  tree(17.5, 2.5); tree(-18, 2); tree(18, 16, Y, true); tree(-18, 14, Y, true);
  coinRing(X, Y + 0.9, 13, 5, 8); coinLine([X - 16, Y + 0.7, 10], [X - 9, Y + 0.7, 3], 5); coinLine([X + 9, Y + 0.7, 10], [X + 16, Y + 0.7, 10], 5);
  crate(X + 17, 24.5, 'coins', Y); crate(X + 17, 24.5, 'pea', Y + 1.4); crate(X + 14.2, 24.5, 'heart', Y);
  heartPickup(X - 17, Y + 0.5, 25);
  steak(X - 10, 8, w3('maki', 5)); steak(X + 11, 19, w3('maki', 5)); steak(X + 12, 5, w3('maki', 4));
  steak(X - 4, 4, w3('frozen', 4)); steak(X + 15, 13, w3('frozen', 3));
  frozenVillager('pumpkin', 5, X + 8, Y, 23, 'Zucchetta'); frozenVillager('corn', 5, X - 16, Y, 6, 'Pannocchietto');
  scarf(npc('avocado', 'Zia Avocado', X - 5.5, 24.5, 5, () => G.stars.has('peas') && G.peas >= 8 ? ['Pea soup for everyone! That will warm us right up.'] : [
    'Brrr! I would love to cook a hot pea soup, but all my peas blew away in the storm.',
    `Eight Snow Peas are scattered over the Frozen Sea — you have ${G.peas} of 8. Look in crates, on roofs and on lonely floes.`,
    'Bring them all and a Golden Star will appear on the snow in the middle of the piazza!',
  ], { y: Y, eyes: { hf: 0.6 } }), 0x3f8cff);
  scarf(npc('cauliflower', 'Nonna Cavolfiore', X + 5.5, 24.5, 5, () => {
    if (G.thawed >= 5) return ['All five are free! Thank you, Capitano — hot chocolate is on me.'];
    return ['Oh dear, oh dear. The fish froze five of my neighbours into blocks of ice!',
      'Walk up to a block and slash it with your sword — the ice shatters. A ground pound next to it works too.',
      `${5 - G.thawed} of them are still frozen: two here in the piazza, one on the trawler, one by the lighthouse and one past the sushi belts.`];
  }, { y: Y, eyes: { hf: 0.55 } }), 0xffd23f);

  // --- crossing to the sunken trawler (north) ---
  floe(X, Y, -2); coin(X, Y + 0.9, -2);
  iceSlab(0, Y, -5.25, (t) => V3(Math.sin(t * 0.9) * 3, 0, 0)); pea(X, Y + 2.5, -5.25);
  ember(X - 5, -3.7, { dx: 10, height: 3.4, period: 3, phase: 0.5, w: 3 });
  ramp(X - 2, X + 2, -12, -7, -4, Y, 3, 'z', -1, matDeck);
  terrainBox(X - 11, X + 11, -4, 3, -48, -12, { mat: 'hull' });
  terrainBox(X - 9, X + 9, 2.5, 3.06, -42, -22, IC);                       // the flooded, frozen hold
  const matRail = new THREE.MeshLambertMaterial({ color: 0x74231f }), matCabin = new THREE.MeshLambertMaterial({ color: 0xf0ede4 });
  wall(X - 11, X - 10.4, 3, 4.1, -48, -12, matRail); wall(X + 10.4, X + 11, 3, 4.1, -48, -12, matRail);
  wall(X - 10.4, X - 2.2, 3, 4.1, -12.6, -12, matRail); wall(X + 2.2, X + 10.4, 3, 4.1, -12.6, -12, matRail); wall(X - 10.4, X + 10.4, 3, 4.1, -48, -47.5, matRail);
  wall(X - 6, X + 6, 3, 7, -47.5, -43.5, matCabin);
  for (const wx of [-4, -1.3, 1.3, 4]) { const win = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.1), new THREE.MeshBasicMaterial({ color: 0x2a4a78 })); win.position.set(X + wx, 5.6, -43.45); scene.add(win); }
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 3.2, 14), new THREE.MeshLambertMaterial({ color: 0xe8352b })); funnel.position.set(X + 3, 8.6, -45.5); funnel.castShadow = true; scene.add(funnel);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 11, 8), matRail); mast.position.set(X - 8.6, 8.5, -16); mast.rotation.z = 0.08; mast.castShadow = true; scene.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), matRail); yard.position.set(X - 9, 11.5, -16); yard.rotation.x = Math.PI / 2; scene.add(yard);
  pea(X - 2, 8.3, -45.5);
  checkpoint(X + 6, 3, -14); heartPickup(X - 8, 3.5, -20);
  coinLine([X - 9.5, 3.7, -24], [X - 9.5, 3.7, -40], 6); coinLine([X + 9.5, 3.7, -24], [X + 9.5, 3.7, -40], 6);
  frozenVillager('carrot', 3.4, X + 7.5, 3, -18.5, 'Carotina');
  scarf(npc('leek', 'Porro the Deckhand', X - 5.5, -15.5, 3.6, () => G.stars.has('tuna') ? ['The old trawler is ours again. The Padrino is on ice — for good!'] : [
    'Psst, Capitano! The hold of this trawler is flooded and frozen over. Il Tonno Padrino lives under the ice.',
    'You will see his shadow following you. Keep moving! He bursts up right where you stand.',
    'After the leap he flops on the ice for a moment. Run in and slash him, or jump on him. Four times!',
  ], { y: 3, eyes: { hf: 0.55 } }), 0x3fa34d);
  makeTuna(X, 3.06, -32, { x0: X - 9, x1: X + 9, z0: -42, z1: -22, y: 3.06 });

  // --- the Sushi Belt Run (east) ---
  terrainBox(X + 20, X + 26, -4, Y, 9, 17, SN);
  runPad(X + 23, Y, 13, V3(X + 70, Y + 1.6, 13));
  place('sushi-salmon', X + 21.3, Y, 16, { s: 9, r: 0.4 }); place('sushi-egg', X + 21.5, Y, 10, { s: 9, r: -0.5 }); place('soy', X + 25, Y, 16.2, { s: 7 });
  scarf(npc('eggplant', 'Chef Melanzana', X + 24.6, 10.2, 4.2, () => G.stars.has('belt') ? ['Bravissimo! Nobody has ever run my sushi belts that fast.'] : [
    'Welcome to my sushi bar! Well… it was mine, until the sushi rolls took over the conveyor belts.',
    `Step on the red button and a Golden Star appears at the far end — but only for ${run.T} seconds!`,
    'The belts push against you, and the middle one pushes sideways. Long jumps skip a lot of belt!',
  ], { y: Y, eyes: { hf: 0.6 } }), 0xffffff);
  belt(X + 26, X + 38, 11, 15, Y, -4, 0); coinLine([X + 28, Y + 0.8, 13], [X + 36, Y + 0.8, 13], 4);
  belt(X + 40.5, X + 50.5, 10, 16, Y, 0, 3.5); coinLine([X + 42.5, Y + 0.8, 12], [X + 48.5, Y + 0.8, 12], 3);
  terrainBox(X + 44, X + 47, -4, Y, 18.5, 21.5, SN); pea(X + 45.5, Y + 1.2, 20);
  belt(X + 53, X + 65, 11, 15, Y, -5.5, 0); coinLine([X + 55, Y + 0.8, 13], [X + 63, Y + 0.8, 13], 4);
  ember(X + 59, 8, { dz: 10, height: 3.6, period: 2.4, w: 3 });
  terrainBox(X + 65, X + 75, -4, Y, 7, 19, SN);
  place('maki-roe', X + 73.5, Y, 17.5, { s: 12 }); place('rice-ball', X + 66.5, Y, 8.2, { s: 9 });
  frozenVillager('cabbage', 6.5, X + 72, Y, 9.5, 'Verzolina'); heartPickup(X + 67, Y + 0.5, 17.5);
  steak(X + 71.5, 15, w3('maki', 3));

  // --- Cono Lighthouse (west) ---
  floe(X - 22.25, Y, 16); floe(X - 25.75, Y, 16);
  ember(X - 24, 20.5, { dz: -9, height: 3.4, period: 2.8, w: 3 });
  terrainBox(X - 48, X - 28, -4, Y, 5, 27, SN);
  const TC = { x: X - 38, z: 16 }, TOP = 18;
  texWafer.repeat.set(6, 5);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 2.1, TOP - Y, 20), new THREE.MeshLambertMaterial({ map: texWafer })); cone.position.set(TC.x, (TOP + Y) / 2, TC.z); cone.castShadow = cone.receiveShadow = true; scene.add(cone);
  addSolid({ x: TC.x - 2.5, y: Y, z: TC.z - 2.5 }, { x: TC.x + 2.5, y: TOP, z: TC.z + 2.5 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.6, 20), matSnow); cap.position.set(TC.x, TOP - 0.3, TC.z); cap.castShadow = cap.receiveShadow = true; scene.add(cap);
  addSolid({ x: TC.x - 3.3, y: TOP - 0.6, z: TC.z - 3.3 }, { x: TC.x + 3.3, y: TOP, z: TC.z + 3.3 });
  for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.4, 6), matRail); post.position.set(TC.x + px, TOP + 1.7, TC.z + pz); scene.add(post); }
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(3.9, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xff9ec4, side: THREE.DoubleSide })); scoop.position.set(TC.x, TOP + 3.4, TC.z); scoop.scale.y = 0.8; scoop.castShadow = true; scene.add(scoop);
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshLambertMaterial({ color: 0xe8352b })); cherry.position.set(TC.x, TOP + 7, TC.z); scene.add(cherry);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2a0 })); lamp.position.set(TC.x, TOP + 3.1, TC.z); scene.add(lamp);
  for (let i = 0; i < 13; i++) {
    const a = 0.5 + i * 0.66, R = 6.5, x = TC.x + Math.cos(a) * R, z = TC.z + Math.sin(a) * R, top = Y + 1.25 * (i + 1);
    if (i === 4 || i === 9) iceSlab(x - X, top, z, (t) => V3(0, Math.sin(t * 1.2 + i) * 1.1, 0));
    else if (i % 3 === 2) floe(x, top, z);
    else terrainBox(x - 1.5, x + 1.5, top - 0.6, top, z - 1.5, z + 1.5, SN);
    if (i === 7) pea(x, top + 1.1, z); else if (i === 10) heartPickup(x, top + 0.5, z); else if (i !== 4 && i !== 9) coin(x, top + 0.9, z);
  }
  spawnStar('cono', V3(TC.x, TOP + 1.3, TC.z), { silent: true });
  windZone({ x: TC.x - 11, y: Y + 6.5, z: TC.z - 11 }, { x: TC.x + 11, y: TOP + 8, z: TC.z + 11 }, V3(4.5, 0, 0));
  checkpoint(X - 30, Y, 9.5); tree(-46, 24, Y, true); tree(-45.5, 20.5); tree(-30, 25);
  frozenVillager('mushroom', 14, X - 45, Y, 8.5, 'Funghetta');
  coinLine([X - 46, Y + 0.7, 12], [X - 46, Y + 0.7, 18], 4);
  scarf(npc('celery-stick', 'Nonno Sedano', X - 31, 22.5, 5, () => G.stars.has('cono') ? ['You made it to the top! The lamp shines brighter already.'] : [
    'I am Nonno Sedano, keeper of the Cono Lighthouse — the tastiest lighthouse on the Frozen Sea.',
    'A Golden Star is stuck up in the lantern, right under the strawberry scoop. Climb the platforms around the cone!',
    'Careful: halfway up, the wind starts to blow. When you hear the WHOOSH, stand still or lean into it.',
  ], { y: Y, eyes: { hf: 0.8, size: 0.09, spread: 0.3 } }), 0xe8352b);

  // --- a lonely floe you can only swim to (south-west) ---
  terrainBox(X - 27, X - 21, -4, Y, 44, 50, SN);
  pea(X - 24, Y + 1.2, 47); heartPickup(X - 22.5, Y + 0.5, 45.5); tree(-25.8, 48.8, Y, true);
}

// ---------------------------------------------------------------------------
// World 4: Dolceterra, the Sugar Isles
// ---------------------------------------------------------------------------
function berry(x, y, z) { const m = inst('strawberry', 7, false); addEyes(m, { hf: 0.5, size: 0.14 }); return addItem('berry', m, V3(x, y, z)); }
// Jelly pads: anything that lands on them bounces (higher if you hold jump, highest after a ground pound)
const jellies = [];
function jelly(x, top, z, { w = 3, d = 3, v = 17, color = 0xff5a8a, fn = null } = {}) {
  const g = new THREE.BoxGeometry(w, 1.2, d); g.translate(0, 0.6, 0);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.8 })); m.castShadow = true;
  let sd;
  if (fn) sd = mover(m, V3(x, top - 1.2, z), fn).sd;
  else { m.position.set(x, top - 1.2, z); scene.add(m); sd = addSolid({ x: x - w / 2, y: top - 1.2, z: z - d / 2 }, { x: x + w / 2, y: top, z: z + d / 2 }); }
  const j = { m, wob: 0 }; sd.jelly = v; sd.jref = j; jellies.push(j); return j;
}
// Caramel: sticky floor that slows you down and weakens your jump
const matCaramel = new THREE.MeshLambertMaterial({ color: 0xd98a1e, emissive: 0x3a1c00 });
function caramel(x0, x1, z0, z1, top) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.1, z1 - z0), matCaramel); m.position.set((x0 + x1) / 2, top + 0.01, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  addSolid({ x: x0, y: top - 0.1, z: z0 }, { x: x1, y: top + 0.06, z: z1 }, { sticky: true });
}
// Round biscuit: an island, or a raft when given a path
function cookieDisc(x, top, z, r, fn = null) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.94, 0.7, 20), [matBiscuit, matCookieTop, matBiscuit]); m.castShadow = m.receiveShadow = true;
  if (fn) { const rec = mover(m, V3(x, top - 0.35, z), fn); const k = r * 0.2; rec.off.min.x += k; rec.off.max.x -= k; rec.off.min.z += k; rec.off.max.z -= k; return rec; }
  m.position.set(x, top - 0.35, z); scene.add(m);
  return addSolid({ x: x - r * 0.8, y: top - 0.7, z: z - r * 0.8 }, { x: x + r * 0.8, y: top, z: z + r * 0.8 });
}
// Hopping boss: three big hops (each landing sends a shockwave), then he is out of breath
function updateHopBoss(b, dt) {
  if (!b.alive) {
    b.t += dt; b.root.scale.set(1 + b.t, Math.max(0.02, 1 - b.t * 1.2), 1 + b.t);
    if (b.t > 0.9 && !b.gone) { b.gone = true; scene.remove(b.root); burst(b.pos.clone().add(V3(0, 1, 0)), { n: 40, color: 0xffffff, speed: 9, size: 0.6, life: 1 }); spawnStar(b.cfg.star, V3(b.home.x, b.home.y + 2.2, b.home.z)); }
    return;
  }
  b.t += dt;
  const A = b.arena, p = player, C = b.cfg, hits = C.hp - b.hp;
  const inArena = p.pos.y > A.y - 0.5 && p.pos.x > A.x0 && p.pos.x < A.x1 && p.pos.z > A.z0 && p.pos.z < A.z1;
  const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z, d = Math.hypot(dx, dz);
  b.dizzy.visible = b.state === 'stunned';
  switch (b.state) {
    case 'sleep':
      b.tilt.rotation.x = 0.08 + Math.sin(b.t * 1.5) * 0.04;
      if (inArena && G.mode === 'play') { b.state = 'intro'; b.t = 0; openDialog(C.name, C.intro); }
      break;
    case 'intro': if (G.mode === 'play') { b.state = 'crouch'; b.t = 0; b.hops = 0; b.tilt.rotation.x = 0; } break;
    case 'wait': if (inArena) { b.state = 'crouch'; b.t = 0; b.hops = 0; } break;
    case 'crouch': {
      b.facing += angDiff(b.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      const k = Math.min(1, b.t / 0.4); b.tilt.scale.set(1 + k * 0.15, 1 - k * 0.3, 1 + k * 0.15);
      if (!inArena) { b.state = 'wait'; b.tilt.scale.set(1, 1, 1); break; }
      if (b.t > Math.max(0.25, 0.65 - hits * 0.09)) {
        const hv = Math.min(d, 10);
        b.vel.set(Math.sin(b.facing) * hv, GRAV / 2, Math.cos(b.facing) * hv); b.state = 'air'; b.t = 0; b.tilt.scale.set(0.9, 1.2, 0.9); sfx.jump3();
      }
      break;
    }
    case 'air':
      b.vel.y -= GRAV * dt; b.pos.addScaledVector(b.vel, dt);
      b.pos.x = clamp(b.pos.x, A.x0 + b.r, A.x1 - b.r); b.pos.z = clamp(b.pos.z, A.z0 + b.r, A.z1 - b.r);
      if (b.vel.y < 0 && b.pos.y <= A.y) {
        b.pos.y = A.y; b.vel.set(0, 0, 0); b.hops++; sfx.pound(); shake = 0.45; b.tilt.scale.set(1, 1, 1);
        ringFx(V3(b.pos.x, A.y, b.pos.z), { color: 0xffe0f0, life: 1.3, hurt: true, speed: 8.5 + hits * 0.6 });
        if (b.hops >= 3) { b.state = 'stunned'; b.t = 0; b.hops = 0; } else { b.state = 'crouch'; b.t = 0; }
      }
      break;
    case 'stunned':
      b.tilt.rotation.z = Math.sin(b.t * 6) * 0.12; b.dizzy.rotation.y += dt * 4;
      if (b.t > Math.max(1.8, C.stunT - hits * 0.25)) { b.state = 'crouch'; b.t = 0; b.tilt.rotation.z = 0; }
      break;
    case 'hurt':
      b.tilt.rotation.z = 0; b.root.visible = Math.floor(b.t * 20) % 2 === 0;
      if (b.t > 1.1) { b.root.visible = true; b.state = 'crouch'; b.t = 0; b.hops = 0; if (b.hp <= 0) { b.alive = false; b.t = 0; sfx.bossHit(); } }
      break;
  }
  b.root.rotation.y = b.facing;
  if (G.mode !== 'play' || p.dead || b.state === 'sleep' || b.state === 'hurt') return;
  const dy = p.pos.y - b.pos.y;
  if (d < b.r + p.r && dy > -1.5 && dy < b.h + 0.3) {
    const fromTop = p.vel.y < 0 && dy > b.h * 0.6, a = Math.atan2(dx, dz);
    if (b.state === 'stunned') {
      if (fromTop || p.action === 'gpFall') { hitBoss(b); p.bounce(14); p.vel.x = Math.sin(a) * 9; p.vel.z = Math.cos(a) * 9; }
      else { p.pos.x = b.pos.x + Math.sin(a) * (b.r + p.r); p.pos.z = b.pos.z + Math.cos(a) * (b.r + p.r); }
    } else if (fromTop && b.state !== 'air') { toast('Too bouncy! Wait until he is out of breath!', 1.6); sfx.hit(); p.bounce(14); p.vel.x = Math.sin(a) * 9; p.vel.z = Math.cos(a) * 9; }
    else hurtPlayer(2, b.pos);
  }
}

function buildWorld4() {
  const X = W4X, Y = 1, SP = { mat: 'sponge' }, BI = { mat: 'biscuit' }, PL = { mat: 'plate' };
  const w4 = (type, range = 4, y = Y) => ({ type, w: 4, range, y });
  const lolly = (x, z, y = Y) => place('lollypop', X + x, y, z, { s: 9, r: rand() * 3, solid: true, shrink: 0.12 });
  // sea of melted chocolate, giant lollipops on the horizon, cotton-candy clouds
  texChoc.repeat.set(40, 40);
  const choc = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: texChoc })); choc.rotation.x = -Math.PI / 2; choc.position.set(X, CHOC, 0); scene.add(choc);
  const stickMat = new THREE.MeshLambertMaterial({ color: 0xfaf4ee });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.3, r = 112 + rand() * 45, h = 26 + rand() * 26, rr = 8 + rand() * 6;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, h, 8), stickMat); st.position.set(X + Math.cos(a) * r, CHOC + h / 2, Math.sin(a) * r); scene.add(st);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 2.2, 24), new THREE.MeshLambertMaterial({ color: [0xff5a8a, 0x5ac8ff, 0xffd23f, 0x8be060, 0xb58cff][i % 5] }));
    disc.rotation.x = Math.PI / 2; disc.rotation.z = a; disc.position.set(st.position.x, CHOC + h + rr * 0.6, st.position.z); disc.lookAt(X, disc.position.y, 0); disc.rotateX(Math.PI / 2); scene.add(disc);
  }
  const fluff = [new THREE.MeshLambertMaterial({ color: 0xffc0dc }), new THREE.MeshLambertMaterial({ color: 0xc0e4ff })];
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, r = 70 + rand() * 90, y = 34 + rand() * 30;
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(5 + rand() * 4, 10, 8), fluff[i % 2]); m.position.set(X + Math.cos(a) * r + (k - 1) * 6, y + rand() * 2, Math.sin(a) * r + rand() * 4); m.scale.y = 0.7; scene.add(m); }
  }

  // --- Arrival biscuit (south) ---
  terrainBox(X - 8, X + 8, -4, Y, 40, 62, BI);
  makeGate(X, Y, 59.5, 3, 0, { name: 'Candy Gate', gold: gateCandy });
  makeGate(X - 6.3, Y, 51, 5, 5, { count: world4Stars, rot: Math.PI / 2, name: 'Kitchen Gate', gold: gateSteel, of: ' of Dolceterra' });
  lolly(-6.3, 60); lolly(6.3, 59.5); place('sign', X + 3, Y, 41, { s: 2.5 });
  place('cupcake', X + 6, Y, 52, { s: 6, solid: true, shrink: 0.3 });
  crate(X - 6, 43, 'berry', Y);
  npc('pear', 'Perina', X + 5, 44.5, 9, [
    'Capitano! You came through the Candy Gate! Welcome to Dolceterra, the Sugar Isles.',
    'Barone Tacchino and his meatballs moved in, ate half the desserts and hid 5 Golden Stars!',
    'The sea is melted chocolate. You do not swim in it — you SINK. Hop out at once, or you lose health.',
    'Pink jelly makes you bounce: hold jump to go higher. And the golden caramel is sticky — it slows you right down.',
  ], { y: Y, eyes: { hf: 0.45 } });
  terrainBox(X - 2, X + 2, -4, Y, 30, 40, BI);
  coinLine([X, Y + 0.7, 39], [X, Y + 0.7, 31], 5);
  ember(X - 4.5, 35, { dx: 9, height: 3.6, period: 2.8, w: 4 });

  // --- Piazza Zucchero (centre) ---
  terrainBox(X - 20, X + 20, -4, Y, 2, 30, SP);
  place('cake-birthday', X, Y, 16, { s: 7, solid: true, shrink: 0.5 }); berry(X, Y + 3.3, 16);
  checkpoint(X - 3.5, Y, 28);
  caramel(X - 14, X - 7, 5, 12, Y); caramel(X + 7, X + 14, 18, 25, Y); berry(X + 10.5, Y + 1.1, 21.5);
  lolly(-18, 4); lolly(18, 4.5); lolly(-18.5, 28); lolly(18, 27.5);
  place('cupcake', X - 15, Y, 21, { s: 6, solid: true, shrink: 0.3 }); place('donut-sprinkles', X + 15, Y, 9, { s: 9 }); place('cookie', X - 9, Y, 26, { s: 8 });
  coinRing(X, Y + 0.8, 16, 6, 8); coinLine([X - 16, Y + 0.7, 14], [X - 8, Y + 0.7, 20], 5); coinLine([X + 8, Y + 0.7, 8], [X + 16, Y + 0.7, 14], 5);
  crate(X + 11.2, 28, 'heart', Y); crate(X + 14, 28, 'coins', Y);
  heartPickup(X - 16, Y + 0.5, 27);
  steak(X - 10, 15, w4('polpetta', 5)); steak(X + 10, 13, w4('polpetta', 5)); steak(X + 2, 6, w4('polpetta', 4));
  steak(X - 10.5, 8.5, w4('sausage', 3)); steak(X + 10.5, 21.5, w4('sausage', 3));
  npc('pineapple', 'Don Ananas', X - 5.5, 26.5, 6, () => G.stars.has('berries') && G.berries >= 8 ? ['Strawberry tart for the whole island! Dolce vita, Capitano.'] : [
    'Ciao, Capitano! I am baking the biggest strawberry tart Dolceterra has ever seen.',
    `I need Eight Wild Strawberries — you have ${G.berries} of 8. Look on top of cakes, high above the jelly, and in the sticky caramel.`,
    'Bring them all and a Golden Star will appear right here in the piazza!',
  ], { y: Y, eyes: { hf: 0.4 } });
  npc('orange', 'Arancina', X + 5.5, 26.5, 12, () => {
    const left = enemies.filter((x) => x.hopper && x.alive).length;
    if (left === 0) return ['Not one meatball left! The desserts are safe.'];
    return ['Those meatballs! Boing, boing, boing, all over my marzipan.',
      'They never stop hopping, so wait until one lands and then stomp it — or just use your sword.',
      `They hop so eagerly that they will follow you right off an edge into the chocolate. ${left} of them are left.`];
  }, { y: Y, eyes: { hf: 0.5 } });

  // --- Torta Reale, the three-tier cake (north) ---
  terrainBox(X - 2, X + 2, -4, Y, -4, 2, BI);
  terrainBox(X - 19, X + 19, -4, Y, -48, -4, PL);
  terrainBox(X - 16, X + 16, Y, 4, -44, -10, SP);
  terrainBox(X - 10, X + 10, 4, 8, -40, -16, SP);
  jelly(X - 8, Y + 0.7, -7); jelly(X + 8, Y + 0.7, -7, { color: 0x8be060 });
  jelly(X - 13, 4.7, -28, { color: 0xb58cff }); jelly(X + 13, 4.7, -28, { color: 0xffd23f });
  caramel(X - 6, X + 6, -15.5, -10.5, 4);
  checkpoint(X + 8.5, 4, -12); heartPickup(X - 14, 4.5, -41); berry(X, Y + 1.1, -46.3); berry(X + 14, 5.1, -42);
  coinLine([X - 13, 4.7, -14], [X - 13, 4.7, -24], 4); coinLine([X + 13, 4.7, -14], [X + 13, 4.7, -24], 4); coinLine([X - 8, 4.7, -42], [X + 8, 4.7, -42], 6);
  steak(X, -13, w4('polpetta', 3, 4)); steak(X - 13, -37, w4('polpetta', 3, 4));
  npc('watermelon', 'Anguria', X + 5.5, -6.5, 5, () => G.stars.has('turkey') ? ['The Torta Reale is ours again. Have a slice!'] : [
    'This is the Torta Reale. Barone Tacchino sits on the top tier, stuffed with stolen sweets.',
    'Bounce up on the jelly pads: hold jump as you land to fly higher.',
    'He hops three times — jump over the shockwaves! — and then he is out of breath. That is your moment. Five hits!',
  ], { y: Y, eyes: { hf: 0.6 } });
  const waxes = [0xff5a8a, 0x5ac8ff, 0xffd23f, 0x8be060];
  [[-9, -39], [9, -39], [-9, -17], [9, -17]].forEach(([cx, cz], i) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 10), new THREE.MeshLambertMaterial({ color: waxes[i] })); c.position.set(X + cx, 9.2, cz); c.castShadow = true; scene.add(c);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xffb030 })); f.position.set(X + cx, 10.9, cz); scene.add(f);
  });
  coinRing(X, 8.8, -28, 6, 8);
  makeBoss(X, 8, -30, { x0: X - 10, x1: X + 10, z0: -40, z1: -16, y: 8 }, {
    kind: 'hopboss', model: 'turkey', upright: true, rotY: -Math.PI / 2, s: 6, name: 'Barone Tacchino', star: 'turkey', hp: 5, stunT: 3.0, r: 2.3, crownZ: 0.3, gem: 0xff5a8a,
    eyes: { hf: 0.74, size: 0.12, spread: 0.16 },
    intro: ['GOBBLE GOBBLE! Who bounces onto MY cake?!', 'I am Barone Tacchino, and I am stuffed with the finest sweets of Dolceterra. You shall be the cherry on top!', '(Tip: jump over the shockwaves when he lands. After three hops he is out of breath — stomp him, pound him or slash him.)'],
  });

  // --- the Great Jelly Jump (east) ---
  jelly(X + 24.5, 0.9, 16); jelly(X + 30, 2.2, 16, { color: 0x8be060 });
  jelly(X + 35.5, 3.6, 16, { color: 0xffd23f, fn: (t) => V3(0, 0, Math.sin(t * 0.9) * 2) }); berry(X + 35.5, 10.2, 16);
  jelly(X + 41, 5.0, 16, { color: 0xb58cff }); jelly(X + 46.5, 6.4, 16, { color: 0x5ac8ff });
  cookieDisc(X + 54.5, 8, 16, 5.2);
  spawnStar('jelly', V3(X + 55.5, 9.3, 16), { silent: true });
  heartPickup(X + 57, 8.5, 13.5); place('donut-sprinkles', X + 57, 8, 18.5, { s: 8 });
  npc('carrot', 'Carota Glassata', X + 17.5, 12, 3.4, () => G.stars.has('jelly') ? ['You bounced all the way up! I got dizzy just watching.'] : [
    'See those wobbly jelly pads? They go all the way up to the big biscuit in the sky.',
    'You bounce by yourself. Just steer — and hold jump when you need more height.',
    'The yellow one slides from side to side. If you fall in the chocolate, hop out fast!',
  ], { y: Y, eyes: { hf: 0.7, spread: 0.12, size: 0.07 } });

  // --- Biscuit Rafts to Isola Bignè (west) ---
  cookieDisc(X - 26.75, Y, 16, 1.9, (t) => V3(Math.sin(t * 0.5) * 4.25, 0, 0));
  cookieDisc(X - 35, Y, 16, 1.9, (t) => V3(0, 0, Math.sin(t * 0.6 + 1) * 5)); berry(X - 35, Y + 2.3, 16);
  ember(X - 31, 11.5, { dz: 9, height: 3.4, period: 2.6, w: 4 }); ember(X - 38.6, 20.5, { dz: -9, height: 3.4, period: 3, phase: 1.2, w: 4 });
  terrainBox(X - 54, X - 40, -4, Y, 7, 25, BI);
  checkpoint(X - 42, Y, 22.5); heartPickup(X - 42, Y + 0.5, 9.5); crate(X - 52, 9, 'berry', Y);
  place('whipped-cream', X - 50, Y, 21, { s: 14, solid: true, shrink: 0.3 }); lolly(-52.5, 23.5);
  terrainBox(X - 49, X - 46, Y, Y + 1.5, 14.5, 17.5, PL);
  spawnStar('raft', V3(X - 47.5, Y + 2.8, 16), { silent: true });
  steak(X - 44, 12, w4('polpetta', 3));
  npc('onion', 'Cipollotto', X - 44, 20, 8, ['You rode the biscuit rafts! I have been stuck on Isola Bignè since the meatballs came.', 'Those chocolate-coated fish bones only leap — dodge them, you cannot bop them.', 'The star on the plate is yours, Capitano!'], { y: Y, eyes: { hf: 0.5 } });
}

// ---------------------------------------------------------------------------
// World 5: La Grande Cucina, the Giant Kitchen
// ---------------------------------------------------------------------------
const SINK = { x0: W5X - 44, x1: W5X - 24, z0: 6, z1: 26, level: 0.4 };
const pickleMat = new THREE.MeshLambertMaterial({ color: 0x5f9e3a }), pickleBump = new THREE.MeshLambertMaterial({ color: 0x457c2c });
function pickle(x, y, z) {
  const m = new THREE.Group(), b = new THREE.Group(); m.add(b); b.position.y = 0.6; b.rotation.z = 0.25;
  b.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 4, 12), pickleMat));
  for (let i = 0; i < 8; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), pickleBump); const a = i * 2.4; k.position.set(Math.cos(a) * 0.29, -0.42 + (i / 7) * 0.84, Math.sin(a) * 0.29); b.add(k); }
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, eyeWhite); e.scale.setScalar(0.1); e.position.set(sx * 0.12, 0.22, 0.27); b.add(e); const pu = new THREE.Mesh(eyeGeo, eyeBlack); pu.scale.setScalar(0.5); pu.position.z = 0.62; e.add(pu); }
  return addItem('pickle', m, V3(x, y, z));
}
// Hobs: stove burners that switch on and off. Glowing red means ouch.
const hobs = [];
function hob(x, top, z, r, phase) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a30, emissive: 0xff3a00, emissiveIntensity: 0 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), mat); disc.rotation.x = -Math.PI / 2; disc.position.set(x, top + 0.03, z); scene.add(disc);
  const coil = new THREE.MeshLambertMaterial({ color: 0x4a4a52, emissive: 0xff6a10, emissiveIntensity: 0 });
  for (const k of [0.3, 0.6, 0.9]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r * k, 0.1, 6, 32), coil); t.rotation.x = Math.PI / 2; t.position.set(x, top + 0.07, z); scene.add(t); }
  hobs.push({ x, y: top, z, r, phase, mat, coil, on: false });
}
function updateHobs(dt) {
  for (const h of hobs) {
    const t = (G.time + h.phase) % 5.2, on = t < 2.4, warm = t > 4.4 ? (t - 4.4) / 0.8 : 0;
    h.on = on; h.mat.emissiveIntensity = lerp(h.mat.emissiveIntensity, on ? 1.5 : warm * 0.45, Math.min(1, dt * 10)); h.coil.emissiveIntensity = h.mat.emissiveIntensity * 1.3;
    if (!on || G.world !== 5) continue;
    if (Math.random() < dt * 8) burst(V3(h.x + (Math.random() - 0.5) * h.r * 1.4, h.y + 0.1, h.z + (Math.random() - 0.5) * h.r * 1.4), { n: 1, color: 0xff9a2a, speed: 0.5, size: 0.14, life: 0.9, grav: -5, up: 1.5 });
    if (G.mode === 'play' && !player.dead && player.invuln <= 0 && player.pos.y < h.y + 0.4 && Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < h.r - 0.15) {
      hurtPlayer(1, V3(h.x, h.y, h.z)); toast('Hot hot hot! Wait until the hob goes dark.', 1.6);
    }
  }
}
// Chopping knives: wait up high, shake, slam down, stay stuck for a moment, rise again
const choppers = [];
const matBlade = new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.7, roughness: 0.3 }), matHandle = new THREE.MeshLambertMaterial({ color: 0x5a3a22 });
function chopper(x, top, z, { alongX = true, len = 3.6, period = 2.8, phase = 0 } = {}) {
  const g = new THREE.Group(); g.position.set(x, top, z); if (!alongX) g.rotation.y = Math.PI / 2; scene.add(g);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.18), matBlade); blade.position.y = 1.1; blade.castShadow = true; g.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(len * 0.5, 0.5, 0.42), matHandle); handle.position.y = 2.45; g.add(handle);
  choppers.push({ g, x, y: top, z, alongX, len, period, phase, low: false });
}
function updateChoppers(dt) {
  for (const c of choppers) {
    const t = (G.time + c.phase) % c.period, up = 3.4;
    const h = t < 0.12 ? up * (1 - t / 0.12) : t < 0.7 ? 0 : t < 1.4 ? up * (t - 0.7) / 0.7 : up;
    c.g.position.y = c.y + h; c.g.position.x = c.x + (c.period - t < 0.45 ? Math.sin(G.time * 60) * 0.05 : 0);
    const low = h < 1.0;
    if (low && !c.low && G.world === 5 && player.pos.distanceTo(c.g.position) < 25) { sfx.hit(); burst(V3(c.x, c.y + 0.2, c.z), { n: 6, color: 0xe8dcc0, speed: 4, size: 0.2, grav: 15, life: 0.4, up: 3 }); }
    c.low = low;
    if (!low || G.mode !== 'play' || player.dead) continue;
    const dx = Math.abs(player.pos.x - c.x), dz = Math.abs(player.pos.z - c.z);
    if ((c.alongX ? dx : dz) < c.len / 2 + 0.3 && (c.alongX ? dz : dx) < 0.6 && player.pos.y < c.y + h + 2.2 && player.pos.y + player.h > c.y + h) hurtPlayer(1, V3(c.x, c.y, c.z + (c.alongX ? (player.pos.z < c.z ? 1 : -1) : 0)));
  }
}
// Steam: a column of hot air that lifts you
const steams = [];
function steam(x, y0, z, y1, r = 1.7) {
  const vent = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshLambertMaterial({ color: 0x3a3a42 })); vent.rotation.x = -Math.PI / 2; vent.position.set(x, y0 + 0.03, z); scene.add(vent);
  steams.push({ x, y0, z, y1, r });
}
function updateSteams(dt) {
  if (G.world !== 5) return;
  for (const s of steams) for (let k = 0; k < 2; k++) if (Math.random() < dt * 22) {
    const a = Math.random() * 6.28, rr = Math.random() * s.r * 0.8, m = new THREE.Mesh(pGeo, pMat(0xffffff)); m.position.set(s.x + Math.cos(a) * rr, s.y0 + Math.random() * 2, s.z + Math.sin(a) * rr); scene.add(m);
    particles.push({ m, v: V3(0, 5, 0), life: 2.2, max: 2.2, size: 0.3, grav: -12 });
  }
}
// Final boss: Il Mannarone, the Chef's cleaver. Hovers over you, chops, and gets stuck in the board.
function makeCleaver(x, y, z, arena) {
  const root = new THREE.Group(); root.position.set(x, y, z); scene.add(root);
  const tilt = new THREE.Group(); root.add(tilt);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.0, 5.2), matBlade); blade.position.y = 1.5; blade.castShadow = true; tilt.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 2.6), matHandle); handle.position.set(0, 2.4, -3.8); handle.castShadow = true; tilt.add(handle);
  for (const face of [-1, 1]) for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeWhite); eye.scale.setScalar(0.34); eye.position.set(face * 0.22, 1.9, 0.7 + side * 0.75); tilt.add(eye);
    const pupil = new THREE.Mesh(eyeGeo, eyeBlack); pupil.scale.setScalar(0.5); pupil.position.set(face * 0.62, 0, 0); eye.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.85), eyeBlack); brow.position.set(face * 0.3, 2.42, 0.7 + side * 0.75); brow.rotation.x = side * 0.4; tilt.add(brow);
  }
  const crown = new THREE.Group(); const gold = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.6, roughness: 0.3 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 14, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 6), gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.62, 0.42, Math.sin(a) * 0.62); crown.add(sp); }
  crown.position.set(0, 3.2, 0.7); tilt.add(crown);
  const dizzy = new THREE.Group(); for (let i = 0; i < 3; i++) { const st = inst('star', 1.7, false); st.position.set(Math.cos(i * 2.1) * 1.8, 0, Math.sin(i * 2.1) * 1.8); dizzy.add(st); }
  dizzy.position.y = 4.4; dizzy.visible = false; root.add(dizzy);
  const shadow = new THREE.Group(); const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })); sm.rotation.x = -Math.PI / 2; shadow.add(sm); shadow.visible = false; scene.add(shadow);
  const b = { kind: 'cleaver', root, tilt, dizzy, shadow, pos: root.position, r: 2.6, h: 3, alive: true, hp: 6, maxHp: 6, state: 'sleep', t: 0, arena, home: V3(x, y, z), yaw: 0, chops: 0 };
  enemies.push(b); return b;
}
function hitCleaver(b) {
  b.hp--; b.state = 'hurt'; b.t = 0; sfx.bossHit(); shake = 0.4;
  burst(b.pos.clone().add(V3(0, 2, 0)), { n: 20, color: 0xfff2a0, speed: 7, life: 0.7 });
  toast(b.hp > 1 ? 'CLANG! Again!' : b.hp === 1 ? 'One more hit!' : 'NOOO! My edge!', 1.6);
}
function updateCleaver(b, dt) {
  const A = b.arena, fy = A.y, p = player;
  if (!b.alive) {
    b.t += dt; b.root.scale.set(1 + b.t, Math.max(0.02, 1 - b.t * 1.2), 1 + b.t);
    if (b.t > 0.9 && !b.gone) { b.gone = true; scene.remove(b.root); scene.remove(b.shadow); burst(b.pos.clone().add(V3(0, 1.5, 0)), { n: 50, color: 0xffffff, speed: 10, size: 0.6, life: 1.2 }); spawnStar('cleaver', V3(b.home.x, fy + 2.2, b.home.z)); }
    return;
  }
  b.t += dt;
  const inArena = p.pos.y > fy - 0.5 && p.pos.x > A.x0 && p.pos.x < A.x1 && p.pos.z > A.z0 && p.pos.z < A.z1;
  const hits = b.maxHp - b.hp, dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z, d = Math.hypot(dx, dz);
  b.dizzy.visible = b.state === 'stuck'; b.shadow.visible = b.state === 'hover' || b.state === 'aim' || b.state === 'chop';
  const along = -dx * Math.cos(b.yaw) + dz * Math.sin(b.yaw), across = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
  const under = Math.abs(along) < 2.9 && Math.abs(across) < 0.9;
  switch (b.state) {
    case 'sleep':
      b.tilt.rotation.z = 0.06;
      if (inArena && G.mode === 'play') {
        b.state = 'intro'; b.t = 0; b.tilt.rotation.z = 0;
        openDialog('Il Mannarone', ['SHHHING! So YOU are the tomato who ruined all my master\'s recipes!', 'I am Il Mannarone, the Chef\'s own cleaver. Steak, ham, tuna, turkey — I chopped for all of them. Now I chop YOU!', '(Tip: watch the shadow and step out from under it. When he is stuck in the board, hit him with your SWORD. Stomping a blade is a bad idea.)']);
      }
      break;
    case 'intro': if (G.mode === 'play') { b.state = 'rise'; b.t = 0; } break;
    case 'rise':
      b.pos.y += dt * 11;
      if (b.pos.y >= fy + 7) { b.pos.y = fy + 7; b.state = 'hover'; b.t = 0; }
      break;
    case 'hover': {
      if (!inArena) b.t -= dt;
      else {
        const v = (6.5 + hits * 0.6) * dt;
        if (d > v) { b.pos.x += dx / d * v; b.pos.z += dz / d * v; }
        b.yaw += angDiff(b.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
      }
      b.pos.x = clamp(b.pos.x, A.x0 + 1, A.x1 - 1); b.pos.z = clamp(b.pos.z, A.z0 + 1, A.z1 - 1);
      b.pos.y = fy + 7 + Math.sin(b.t * 5) * 0.2;
      if (b.t > (b.chops > 0 ? 0.6 : 2.2 - hits * 0.15)) { b.state = 'aim'; b.t = 0; }
      break;
    }
    case 'aim':
      b.tilt.position.x = Math.sin(b.t * 60) * 0.09;
      if (b.t > Math.max(0.32, 0.6 - hits * 0.04)) { b.state = 'chop'; b.t = 0; b.tilt.position.x = 0; sfx.longjump(); }
      break;
    case 'chop':
      b.pos.y -= dt * 46;
      if (b.pos.y <= fy) {
        b.pos.y = fy; sfx.pound(); shake = 0.5; b.chops++;
        burst(b.pos.clone().add(V3(0, 0.3, 0)), { n: 14, color: 0xe8c890, speed: 6, size: 0.3, grav: 20, life: 0.6, up: 5 });
        ringFx(V3(b.pos.x, fy, b.pos.z), hits >= 2 ? { color: 0xfff2a0, life: 1.1, hurt: true, speed: 9 } : { max: 4 });
        if (under && p.pos.y < fy + 3 && G.mode === 'play') hurtPlayer(2, b.pos);
        if (b.chops >= (b.hp <= 2 ? 3 : b.hp <= 4 ? 2 : 1)) { b.state = 'stuck'; b.chops = 0; } else b.state = 'rise';
        b.t = 0;
      }
      break;
    case 'stuck':
      b.tilt.rotation.z = Math.sin(b.t * 25) * 0.04 * Math.max(0, 1 - b.t); b.dizzy.rotation.y += dt * 4;
      if (b.t > 2.9 - hits * 0.15) { b.state = 'rise'; b.t = 0; b.tilt.rotation.z = 0; }
      break;
    case 'hurt':
      b.root.visible = Math.floor(b.t * 20) % 2 === 0;
      if (b.t > 0.9) { b.root.visible = true; b.tilt.rotation.z = 0; if (b.hp <= 0) { b.alive = false; b.t = 0; sfx.bossHit(); } else { b.state = 'rise'; b.t = 0; } }
      break;
  }
  b.root.rotation.y = b.yaw - Math.PI / 2; b.shadow.rotation.y = b.root.rotation.y; b.shadow.position.set(b.pos.x, fy + 0.05, b.pos.z);
  if (G.mode !== 'play' || p.dead || b.state !== 'stuck' || !under) return;
  if (p.vel.y < 0 && p.pos.y > fy + 2.2 && p.pos.y < fy + 3.6) { p.bounce(12); sfx.hit(); toast('Ouch, sharp! Use your SWORD on him!', 1.8); }
  else if (p.pos.y < fy + 2.8) { const k = (across < 0 ? -1 : 1) * (0.9 - Math.abs(across)); p.pos.x += Math.sin(b.yaw) * k; p.pos.z += Math.cos(b.yaw) * k; }
}

function buildWorld5() {
  const X = W5X, Y = 1, D = -40, MB = { mat: 'marble' }, ST = { mat: 'steel' }, BD = { mat: 'board' }, PL = { mat: 'plate' }, IC = { mat: 'ice' };
  const w5 = (type, range = 4, y = Y) => ({ type, w: 5, range, y });
  const wall = (x0, x1, y0, y1, z0, z1, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true; scene.add(m); return addSolid({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 });
  };
  const prop = (name, x, z, s, y = Y, shrink = 0.25, r = 0) => place(name, X + x, y, z, { s, r, solid: true, shrink });
  // the kitchen itself: tiled floor far below, tiled wall with a window
  const texTile = canvasTex(64, (g, s) => { g.fillStyle = '#e8dcc4'; g.fillRect(0, 0, s, s); g.fillStyle = '#b8742c'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2); });
  texTile.repeat.set(40, 40);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ map: texTile })); floor.rotation.x = -Math.PI / 2; floor.position.set(X, D, 0); floor.receiveShadow = true; scene.add(floor);
  const texWall = canvasTex(64, (g, s) => { g.fillStyle = '#f4efe2'; g.fillRect(0, 0, s, s); g.strokeStyle = '#cfc4ac'; g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2); });
  texWall.repeat.set(30, 12);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(420, 170), new THREE.MeshLambertMaterial({ map: texWall })); back.position.set(X, D + 85, -78); scene.add(back);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(70, 46), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, fog: false })); win.position.set(X + 55, 52, -77.5); scene.add(win);
  const frame = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  for (const [fx, fy, fw, fh] of [[55, 52, 74, 3], [55, 75, 74, 3], [55, 29, 74, 3], [19.5, 52, 3, 49], [90.5, 52, 3, 49], [55, 52, 3, 46]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 1.5), frame); f.position.set(X + fx, fy, -77); scene.add(f); }

  // --- Arrival chopping board (south) ---
  terrainBox(X - 8, X + 8, D, Y, 40, 62, BD);
  makeGate(X, Y, 59.5, 4, 0, { name: 'Kitchen Gate', gold: gateSteel });
  prop('pepper-mill', -6.3, 60, 6); prop('shaker-salt', 6.3, 59.5, 8); place('sign', X + 3, Y, 41, { s: 2.5 });
  crate(X - 6, 43, 'pickle', Y);
  npc('broccoli', 'Nonno Broccolo', X + 5, 44.5, 4, [
    'Capitano! I followed you through the gates. This is La Grande Cucina — the kitchen where all the trouble was cooked up!',
    'Everything is HUGE here, and we are tiny. Fall off the counter and it is a long way down: you lose health and pop back up.',
    'Keep off the hobs when they glow red, and never stand under a knife that is shaking.',
    'The last 5 Golden Stars are here — and so is Il Mannarone, the Chef\'s cleaver. Coraggio, Capitano!',
  ], { y: Y, eyes: { hf: 0.62 } });
  terrainBox(X - 1.5, X + 1.5, D, Y, 30, 40, BD);
  coinLine([X, Y + 0.7, 39], [X, Y + 0.7, 31], 5);
  chopper(X, Y, 35, { len: 3.4 });

  // --- the Worktop (centre) ---
  terrainBox(X - 20, X + 20, D, Y, 2, 30, MB);
  checkpoint(X - 3.5, Y, 28);
  const mug = prop('mug', -14, 22, 8); pickle(X - 14.4, Y + 2.9, 22);
  prop('loaf', 12, 24, 6); pickle(X + 12, Y + 3.4, 24);
  prop('cheese', 14, 6.5, 6, Y, 0.5); prop('knife-block', -8, 27.6, 7, Y + 1.85, 0.2); prop('pepper-mill', 17.5, 27.5, 6); prop('shaker-salt', 15.5, 28, 8);
  coinRing(X, Y + 0.8, 16, 6, 8); coinLine([X - 16, Y + 0.7, 14], [X - 8, Y + 0.7, 8], 5); coinLine([X + 6, Y + 0.7, 12], [X + 16, Y + 0.7, 14], 5);
  crate(X + 3.5, 28, 'heart', Y); crate(X + 6.3, 28, 'coins', Y);
  heartPickup(X - 17.5, Y + 0.5, 27);
  steak(X - 8, 14, w5('burger', 5)); steak(X + 9, 10, w5('burger', 5));
  steak(X + 12, 19, w5('hotdog', 4)); steak(X - 4, 6, w5('hotdog', 4));
  npc('tomato', 'Mamma Pomodoro', X - 5.5, 25.5, 12, () => G.stars.has('pickles') && G.pickles >= 8 ? ['The jar is full again! You are the pride of the Garden Isle, Capitano.'] : [
    'Capitano! My cousins, the Crunchy Pickles, jumped out of their jar when the Chef opened it.',
    `There are eight of them hiding around the kitchen — you have ${G.pickles} of 8. Look on top of big things, in the sink and in the fridge.`,
    'Find them all and a Golden Star will appear right here on the worktop!',
  ], { y: Y, eyes: { hf: 0.6, size: 0.1 } });
  // steam vent and the spice rack high above
  steam(X - 15, Y, 8.5, 12.6);
  terrainBox(X - 18, X + 8, 9.4, 10, 2, 5, BD);
  prop('shaker-pepper', -9.5, 3.2, 8, 10, 0.1); prop('bottle-oil', -4, 4, 5, 10, 0.1); pickle(X - 13, 10.9, 3.5);
  coinLine([X - 16, 10.7, 3.5], [X - 11, 10.7, 3.5], 3);
  steak(X - 0.5, 3.5, w5('hotdog', 1.5, 10));
  chopper(X + 3.2, 10, 3.5, { alongX: false, len: 3, phase: 1.1 });
  spawnStar('spice', V3(X + 6.3, 11.3, 3.5), { silent: true });
  npc('carrot', 'Captain Carota', X - 11.5, 10, 3.4, () => G.stars.has('spice') ? ['Up, up and away! I knew you had a head for heights.'] : [
    'Ahoy! See the steam coming out of that vent? Step into it and it lifts you like a feather.',
    'Ride it all the way up, then steer onto the spice rack above us.',
    'A Golden Star is at the far end, past the knife. Wait until it is stuck in the shelf, then run under as it rises.',
  ], { y: Y, eyes: { hf: 0.7, spread: 0.12, size: 0.07 } });

  // --- the Great Chopping Board (north): sugar-cube steps, then the final boss ---
  terrainBox(X - 1.5, X + 1.5, D, Y, -3, 0, PL); terrainBox(X - 1.5, X + 1.5, D, 1.8, -8, -5, PL);
  coin(X, Y + 0.8, -1.5); coin(X, 2.6, -6.5);
  terrainBox(X - 12, X + 12, D, 2.5, -44, -10, BD);
  checkpoint(X + 9, 2.5, -11.6); heartPickup(X + 6, 3, -11.8); pickle(X, 3.4, -43.2);
  npc('leek', 'Porro the Guard', X - 8.5, -11.8, 3.6, () => G.stars.has('cleaver') ? ['The cleaver is blunt and the kitchen is quiet. You did it, Capitano. You really did it!'] : [
    'HALT! … Oh, Capitano. Beyond this line is the Great Chopping Board, and Il Mannarone himself.',
    'He hangs in the air above you and then CHOPS. Watch his shadow and get out from under it!',
    'When he is stuck in the board, hit him with your sword. Six times. The more you hurt him, the more often he chops before he gets stuck.',
  ], { y: 2.5, eyes: { hf: 0.55 } });
  makeCleaver(X, 2.5, -30, { x0: X - 10, x1: X + 10, z0: -42, z1: -14, y: 2.5 });

  // --- the Stove (east): three hobs between rows of pots ---
  terrainBox(X + 20, X + 62, D, Y, 6, 26, ST);
  checkpoint(X + 22.5, Y, 9.5);
  [29, 38, 47].forEach((bx, i) => { hob(X + bx, Y, 16, 3.4, i * 1.75); prop('pot', bx, 9.5, 9, Y, 0.4); prop('pot', bx, 22.5, 9, Y, 0.4); });
  coinLine([X + 33.5, Y + 0.7, 14.5], [X + 33.5, Y + 0.7, 17.5], 3); coinLine([X + 42.5, Y + 0.7, 14.5], [X + 42.5, Y + 0.7, 17.5], 3);
  pickle(X + 38, 4.4, 16);
  prop('pot-lid', 57, 16, 8, Y, 0.6);
  spawnStar('hobs', V3(X + 57, 3.5, 16), { silent: true });
  heartPickup(X + 60, Y + 0.5, 8.5); steak(X + 56, 22, w5('burger', 3));
  npc('pumpkin', 'Zia Zucca', X + 22.5, 22.5, 5, () => G.stars.has('hobs') ? ['You crossed the stove without a single burnt boot. Well… almost!'] : [
    'Careful, dear! That is the Chef\'s stove, and the hobs keep switching on and off.',
    'A hob glows faintly just before it turns red-hot. Cross when it goes dark, and rest in the gaps between the pots.',
    'A Golden Star is sitting on a pot lid at the far end.',
  ], { y: Y, eyes: { hf: 0.5 } });

  // --- the Sink (west): somewhere to swim, with a few things floating in it ---
  terrainBox(X - 24, X - 20, D, Y, 2, 26, ST); terrainBox(X - 44, X - 24, D, Y, 2, 6, ST); terrainBox(X - 44, X - 20, D, Y, 26, 30, MB);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(X - 34, SINK.level, 16);
  const wu = water.geometry.attributes.uv; for (let i = 0; i < wu.count; i++) wu.setXY(i, wu.getX(i) * 4, wu.getY(i) * 4);
  scene.add(water);
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshLambertMaterial({ color: 0x6f7c8a })); basin.rotation.x = -Math.PI / 2; basin.position.set(X - 34, -5, 16); scene.add(basin);
  const matSponge = new THREE.MeshLambertMaterial({ color: 0xf2d23f });
  wall(X - 31, X - 28, 0, 0.9, 10, 14, matSponge); wall(X - 38.5, X - 35.5, 0.1, 0.85, 17.5, 20.5, matPlate); wall(X - 42.5, X - 39.5, 0, 0.9, 8, 12, matSponge);
  pickle(X - 37, 1.7, 19); coin(X - 29.5, 1.7, 12); coin(X - 41, 1.7, 10);
  const tap = new THREE.Mesh(new THREE.TorusGeometry(3, 0.45, 8, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.7, roughness: 0.3 })); tap.rotation.y = Math.PI / 2; tap.position.set(X - 34, Y, 25.5); scene.add(tap);
  chopper(X - 32, Y, 28, { alongX: false, len: 3.4, phase: 0.6 }); steak(X - 38, 28, w5('hotdog', 2));
  coinLine([X - 42, Y + 0.7, 28], [X - 24, Y + 0.7, 28], 6);

  // --- the Fridge (far west): slippery shelves, all the way up ---
  terrainBox(X - 62, X - 44, D, Y, 4, 28, PL);
  const matFridge = new THREE.MeshLambertMaterial({ color: 0xe8eef2 });
  wall(X - 62.6, X - 62, Y, 15, 3.4, 28.6, matFridge); wall(X - 62, X - 46, Y, 15, 3.4, 4, matFridge); wall(X - 62, X - 46, Y, 15, 28, 28.6, matFridge);
  checkpoint(X - 45.5, Y, 6.5); heartPickup(X - 60, Y + 0.5, 26);
  terrainBox(X - 49, X - 47, Y, 2.5, 8, 10, IC);
  terrainBox(X - 61.5, X - 51, 3.5, 4, 6.5, 13.5, IC);
  terrainBox(X - 60.5, X - 58.5, 4.9, 5.5, 15, 17, IC);
  terrainBox(X - 61.5, X - 49, 6.5, 7, 18.5, 26, IC);
  floe(X - 50.5, 8.5, 15.5);
  terrainBox(X - 57, X - 47, 9.5, 10, 6.5, 12.5, IC);
  steak(X - 56, 10, { type: 'frozen', w: 5, range: 2.5, y: 4 }); steak(X - 55, 22, { type: 'frozen', w: 5, range: 2.5, y: 7 });
  pickle(X - 60, 7.9, 24.5); coinLine([X - 60, 4.7, 8], [X - 53, 4.7, 8], 4);
  spawnStar('fridge', V3(X - 52, 11.3, 9.5), { silent: true });
  npc('eggplant', 'Signora Melanzana', X - 46.5, 24.5, 4.2, () => G.stars.has('fridge') ? ['Brrr! You went all the way to the top shelf. I will stay down here, thank you.'] : [
    'Psst, Capitano! This is the Chef\'s fridge. A Golden Star is on the top shelf.',
    'Hop up the ice cubes from shelf to shelf. The shelves are icy, so you will slide!',
    'The frozen fish wear an ice block: the first hit cracks it, the second finishes them. And the cracked ice cube will not hold you for long.',
  ], { y: Y, eyes: { hf: 0.6 } });
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
  const wl = waterLevelAt(want.x, want.z) ?? lavaAt(want.x); if (wl !== null && want.y < wl + 0.4) want.y = wl + 0.4;
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
  toast(world1Stars() >= 7 ? 'The Star Gate on the beach is open!' : 'Talk to Nonno Broccolo!', 3);
}
function togglePause() {
  if (G.mode === 'play') {
    G.mode = 'pause'; sfx.pause(); document.exitPointerLock?.();
    const li = (id) => `<li class="${G.stars.has(id) ? 'got' : 'no'}">${G.stars.has(id) ? '★' : '☆'} ${STAR_NAMES[id]}</li>`;
    const worlds = [['Garden Isle', STAR_ORDER, true], ['Isola Brace', STAR_ORDER2, world1Stars() >= 7], ['Mare Surgelato', STAR_ORDER3, world2Stars() >= 5], ['Dolceterra', STAR_ORDER4, world3Stars() >= 5], ['La Grande Cucina', STAR_ORDER5, world4Stars() >= 5]];
    $('starlist').innerHTML = worlds.map(([name, order, open], i) => {
      if (!open && i + 1 !== G.world) return `<li class="hd">??? <span class="n">locked</span></li>`;
      const hd = `<li class="hd">${name} <span class="n">${starsIn(order)} / ${order.length}</span></li>`;
      return i + 1 === G.world ? hd + order.map(li).join('') : hd;
    }).join('');
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
          if (e.kind === 'steak') updateSteak(e, STEP_DT); else if (e.kind === 'fish') updateFish(e, STEP_DT); else if (e.kind === 'ember') updateEmber(e, STEP_DT); else if (e.kind === 'tuna') updateTuna(e, STEP_DT); else if (e.kind === 'hopboss') updateHopBoss(e, STEP_DT); else if (e.kind === 'cleaver') updateCleaver(e, STEP_DT); else updateBoss(e, STEP_DT);
        }
      }
      updateFloes(dt); updateRun(dt); updateWinds(dt); updateHobs(dt); updateChoppers(dt); updateSteams(dt);
      if (healQueue > 0) { G.healT = (G.healT || 0) - dt; if (G.healT <= 0) { G.healT = 0.12; healQueue--; if (G.health < 8) setHealth(G.health + 1); } }
    }
    if (G.mode === 'dialog') updateDialog(dt);
    if (G.mode === 'starget') {
      G.starT += dt;
      if (G.starT > 2.8) {
        G.mode = 'play'; startAction('normal');
        if (G.stars.size >= TOTAL_STARS && !G.endingShown) { G.endingShown = true; G.mode = 'ending'; $('ending').style.display = 'flex'; document.exitPointerLock?.(); }
        else if (world4Stars() >= 5 && !G.gate5Announced) {
          G.gate5Announced = true; sfx.appear();
          openDialog('The Kitchen Gate', ['The 5 Golden Stars of Dolceterra shine together… and somewhere a pot lid starts to rattle!', 'The steel Kitchen Gate on the arrival biscuit, next to the Candy Gate, has woken up.', 'Step through it to reach La Grande Cucina, the Giant Kitchen — the last 5 Golden Stars, and the Chef\'s cleaver, are waiting!']);
        }
        else if (world3Stars() >= 5 && !G.gate4Announced) {
          G.gate4Announced = true; sfx.appear();
          openDialog('The Candy Gate', ['The 5 Golden Stars of Mare Surgelato shine together… and the cold air suddenly smells of vanilla!', 'The pink Candy Gate on the arrival floe, next to the Ice Gate, has woken up.', 'Step through it to reach Dolceterra, the Sugar Isles — 5 more Golden Stars are waiting there!']);
        }
        else if (world2Stars() >= 5 && !G.gate3Announced) {
          G.gate3Announced = true; sfx.appear();
          openDialog('The Ice Gate', ['The 5 Golden Stars of Isola Brace shine together… and a cold wind blows across the dock!', 'The frosty Ice Gate on the arrival dock, next to the Star Gate, has woken up.', 'Step through it to reach Mare Surgelato, the Frozen Sea — 5 more Golden Stars are waiting there!']);
        }
        else if (world1Stars() >= 7 && !G.gateAnnounced) {
          G.gateAnnounced = true; sfx.appear();
          openDialog('The Star Gate', ['The 7 Golden Stars shine together… and something rumbles down by the beach!', 'The old Star Gate, just south of where you landed, has woken up.', 'Step through it to reach Isola Brace, the Ember Isle — 5 more Golden Stars are waiting there!']);
        }
      }
    }
    if (G.mode === 'travel') {
      G.travelT += dt;
      if (!G.travelDone && G.travelT > 0.5) { G.travelDone = true; arriveWorld(G.travelTo); $('fade').classList.remove('on'); }
      if (G.travelT > 1.0) { G.mode = 'play'; banner(WORLD_BANNER[G.world], 3); }
    }
    if (G.mode === 'dying') {
      G.dieT += dt; animatePlayer(dt);
      $('fade').classList.toggle('on', G.dieT > 1.4);
      if (G.dieT > 2) { $('fade').classList.remove('on'); respawn(); }
    }
    updateItems(dt); updateParticles(dt); updateRings(dt); updateNPCs(dt); updateKids(dt); updateGates(dt);
    if (G.world === 2 && sim && Math.random() < dt * 7) { // sparks drifting up from the sauce
      const sx = player.pos.x + (Math.random() - 0.5) * 50, sz = player.pos.z + (Math.random() - 0.5) * 50;
      if (floorAt(sx, sz, 50, 0.3).y < LAVA) burst(new THREE.Vector3(sx, LAVA + 0.1, sz), { n: 1, color: 0xffb040, speed: 0.6, size: 0.16, life: 2.4, grav: -4, up: 1.5 });
    }
    if (G.world === 3 && sim && Math.random() < dt * 16) { // snowfall
      burst(new THREE.Vector3(player.pos.x + (Math.random() - 0.5) * 44, player.pos.y + 9 + Math.random() * 5, player.pos.z + (Math.random() - 0.5) * 44), { n: 1, color: 0xffffff, speed: 0.6, size: 0.13, life: 3.6, grav: 4, up: -1.5 });
    }
    for (const j of jellies) { j.wob = Math.max(0, j.wob - dt); j.m.scale.y = 1 - Math.sin(j.wob / 0.4 * Math.PI) * 0.35; }
    for (const b of belts) { b.tex.offset.x -= b.vx * dt / 2; b.tex.offset.y += b.vz * dt / 2; }
    for (const f of frozen) if (f.done) { f.t += dt; f.veg.position.y = f.pos.y + Math.abs(Math.sin(f.t * 4)) * 0.35; f.veg.rotation.y += dt * 1.2; }
    for (const s of springs) { s.t = Math.max(0, s.t - dt); s.o.scale.y = 2.6 * (1 - Math.sin(s.t / 0.4 * Math.PI) * 0.4); }
    for (const f of flags) if (f.on) f.o.rotation.y = Math.sin(G.time * 2) * 0.2;
    if (G.mode !== 'pause') updateCamera(dt);
    updateHUD(dt);
  }
  for (const c of clouds) { c.position.x += c.userData.v * dt; if (c.position.x > 160) c.position.x = -160; }
  texChoc.offset.x = G.time * 0.006; texChoc.offset.y = Math.sin(G.time * 0.3) * 0.02;
  texLava.offset.x = G.time * 0.012; texLava.offset.y = Math.sin(G.time * 0.4) * 0.03;
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
  setupPlayerModel(); buildLevel(); buildWorld2(); buildWorld3(); buildWorld4(); buildWorld5(); drawHealth();
  // already-collected stars from a previous session: re-spawn as ghost stars only where they are fixed
  $('loading').style.display = 'none'; $('title').style.display = 'flex'; G.mode = 'title';
  window.__game = { G, player, enemies, items, solids, camState, input, travel, gates, floes, frozen, thaw };
  frame();
})();
