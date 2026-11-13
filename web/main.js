import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const EYE = 1.6, RADIUS = 0.22, WALK = 1.6, RUN = 3.2;
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer();   // MSAA is done in the composer target
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // static house + fixed sun: render the shadow map once
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);

// sky + image based light
new RGBELoader().load('../assets/hdri/sky.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
});
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6b5a48, 0.35));
const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
sun.position.set(-8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const draco = new DRACOLoader().setDecoderPath('../node_modules/three/examples/jsm/libs/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);

const [data, gltf] = await Promise.all([
  fetch('scene.json').then((r) => r.json()),
  loader.loadAsync('house.glb', (e) => {
    if (e.total) $('status').textContent = `Loading model… ${Math.round(100 * e.loaded / e.total)}%`;
  }),
]);

const house = gltf.scene;
const ceilings = [];
house.traverse((o) => {
  if (!o.isMesh) return;
  const glass = o.name.includes('glass') || [].concat(o.material).some((m) => m.transparent);
  o.castShadow = !glass;
  o.receiveShadow = true;
  if (o.name.startsWith('ceiling') && !o.name.startsWith('ceiling_fan') && !o.name.startsWith('ceiling_light')) ceilings.push(o);
});
scene.add(house);
renderer.shadowMap.needsUpdate = true;
// fan blades: spin the fan models slowly
const fans = [];
house.traverse((o) => { if (/ceiling_fan_blades/.test(o.name) && !/ceiling_fan_blades/.test(o.parent?.name)) fans.push(o); });

// plan (x, y) metres -> three (x, -y)
const toWorld = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const rooms = data.rooms;
// every point light costs on every pixel, so a fixed pool of 4 follows the player to the nearest rooms
// (a fixed count also avoids shader recompiles, which cause stutter)
const lampSpots = rooms.filter((r) => r.key !== 'ver' && r.key !== 'wash1').map((r) => {
  const [x0, x1, y0, y1] = r.rects[0];
  return toWorld((x0 + x1) / 2, (y0 + y1) / 2, data.wall_h - 0.25);
});
const roomLights = [];
for (let i = 0; i < 4; i++) {
  const L = new THREE.PointLight(0xffe2bd, 2.2, 7, 1.6);
  scene.add(L);
  roomLights.push(L);
}
function placeLights(p) {
  lampSpots.slice().sort((a, b) => a.distanceToSquared(p) - b.distanceToSquared(p))
    .slice(0, roomLights.length).forEach((s, i) => roomLights[i].position.copy(s));
}

// ---- collision (2D circle vs axis-aligned boxes, in plan coordinates)
const boxes = data.colliders;
function blocked(x, y) {
  for (const [x0, x1, y0, y1] of boxes) {
    const cx = Math.max(x0, Math.min(x, x1)), cy = Math.max(y0, Math.min(y, y1));
    if ((x - cx) ** 2 + (y - cy) ** 2 < RADIUS * RADIUS) return true;
  }
  return false;
}
function roomAt(x, y) {
  for (const r of rooms) for (const [x0, x1, y0, y1] of r.rects) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return r.label;
  return '';
}

// ---- walk controls
const player = { x: data.spawn[0], y: data.spawn[1] };
const walk = new PointerLockControls(camera, document.body);
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyT') toggleTop();
  if (e.code === 'KeyL') toggleLights();
  if (e.code === 'KeyO') ao.enabled = !ao.enabled;   // AO off = faster on weak GPUs
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
$('overlay').addEventListener('click', () => { if (!topView) walk.lock(); });
walk.addEventListener('lock', () => { $('overlay').style.display = 'none'; });
walk.addEventListener('unlock', () => { if (!topView) $('overlay').style.display = 'flex'; });

// ---- top (dollhouse) view
let topView = false;
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enabled = false;
camera.position.copy(toWorld(player.x, player.y, EYE));  // after OrbitControls, which re-aims the camera
camera.lookAt(toWorld(player.x, player.y + 5, EYE));
let saved = null;
function toggleTop() {
  topView = !topView;
  ceilings.forEach((c) => (c.visible = !topView));
  if (topView) {
    saved = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    walk.unlock();
    $('overlay').style.display = 'none';
    $('cross').style.display = 'none';
    orbit.target.copy(toWorld(5.5, 8, 0));
    camera.position.copy(toWorld(5.5, -6, 22));
    orbit.enabled = true;
    orbit.update();
  } else {
    orbit.enabled = false;
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    $('cross').style.display = 'block';
    $('overlay').style.display = 'flex';
  }
}
let lightsOn = true;
function toggleLights() {
  lightsOn = !lightsOn;
  roomLights.forEach((l) => (l.visible = lightsOn));
}

// ---- post-processing: ambient occlusion gives soft contact shadows in corners / under furniture
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight,
  { type: THREE.HalfFloatType, samples: 2 }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 8 });
ao.blendIntensity = 0.9;
composer.addPass(ao);
composer.addPass(new OutputPass());

// ---- loop
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
let frames = 0, fpsT = 0, lastLightPos = null;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05);
  frames++; fpsT += raw;
  if (fpsT > 0.5) { $('fps').textContent = `${Math.round(frames / fpsT)} FPS`; frames = 0; fpsT = 0; }
  if (!lastLightPos || lastLightPos.distanceToSquared(camera.position) > 0.25) {
    lastLightPos = camera.position.clone();
    placeLights(topView ? orbit.target : camera.position);
  }
  fans.forEach((f) => (f.rotation.y += dt * 2.5));
  if (walk.isLocked && !topView) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, camera.up);
    const sp = (keys.ShiftLeft || keys.ShiftRight ? RUN : WALK) * dt;
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += fwd.x; mz += fwd.z; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fwd.x; mz -= fwd.z; }
    if (keys.KeyD || keys.ArrowRight) { mx += right.x; mz += right.z; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= right.x; mz -= right.z; }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const dx = (mx / len) * sp, dy = -(mz / len) * sp;     // three z = -plan y
      if (!blocked(player.x + dx, player.y)) player.x += dx;  // slide along walls
      if (!blocked(player.x, player.y + dy)) player.y += dy;
    }
    camera.position.copy(toWorld(player.x, player.y, EYE));
    $('room').textContent = roomAt(player.x, player.y);
  }
  if (topView) orbit.update();
  composer.render();
});

$('status').textContent = 'Click to enter the house';
if (location.hash === '#top') toggleTop();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
