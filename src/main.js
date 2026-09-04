import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadZone, loadZoneIndex, buildTerrain } from './terrain.js';
import { buildHazardModel } from './hazard.js';
import { SkinTrack } from './skintrack.js';
import { Skier } from './skier.js';
import {
  renderMenu, renderHUD, drawDangerRose,
  renderSkinningPanel, renderSkiingPanel, setRiskVignette,
  renderDebrief, hideDebrief,
} from './ui.js';
import { dataUrl } from './dataUrl.js';

const ASPECT_LABELS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function aspectLabel(deg) {
  return ASPECT_LABELS[Math.round(deg / 22.5) % 16];
}

const canvas = document.getElementById('scene');
const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const modePanelEl = document.getElementById('mode-panel');
const riskVignetteEl = document.getElementById('risk-vignette');
const debriefEl = document.getElementById('debrief');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb6d9);
scene.fog = new THREE.Fog(0x8fb6d9, 1200, 4000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 8000);
camera.position.set(0, 900, 900);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 80;
controls.maxDistance = 3000;

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-600, 800, 400);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

const skierGeometry = new THREE.ConeGeometry(4, 12, 8);
skierGeometry.rotateX(-Math.PI / 2); // bake tip-forward (-Z) into the geometry so
// object.rotation.y alone steers it - composing a live X and Y rotation on
// the object itself would leave the cone's apex sitting on the Y axis,
// making heading changes invisible.
const skierMesh = new THREE.Mesh(skierGeometry, new THREE.MeshStandardMaterial({ color: 0xff3344 }));
skierMesh.visible = false;
scene.add(skierMesh);

// --- game state ---
let mode = 'menu'; // 'menu' | 'skinning' | 'skiing'
let zoneData = null;
let scenario = null;
let grid = null;
let hazardModel = null;
let terrainMesh = null;
let skinTrack = null;
let skier = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const input = { left: false, right: false, up: false, down: false };
let lastFrameTime = performance.now();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const MOVEMENT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
window.addEventListener('keydown', (e) => { if (MOVEMENT_KEYS.has(e.code)) e.preventDefault(); setInput(e.code, true); });
window.addEventListener('keyup', (e) => setInput(e.code, false));
function setInput(code, value) {
  if (code === 'ArrowLeft' || code === 'KeyA') input.left = value;
  if (code === 'ArrowRight' || code === 'KeyD') input.right = value;
  if (code === 'ArrowUp' || code === 'KeyW') input.up = value;
  if (code === 'ArrowDown' || code === 'KeyS') input.down = value;
}

function terrainMeshes() {
  return scene.children.filter((c) => c === terrainMesh);
}

function raycastTerrain(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(terrainMeshes());
  if (!hits.length) return null;
  const p = hits[0].point;
  const { row, col } = grid.worldToGrid(p.x, p.z);
  return { row: Math.round(row), col: Math.round(col), point: p };
}

renderer.domElement.addEventListener('click', (ev) => {
  if (mode === 'skinning') {
    const hit = raycastTerrain(ev.clientX, ev.clientY);
    if (hit) {
      skinTrack.addWaypoint(hit.row, hit.col);
      refreshSkinningPanel();
      setHUDFromCell(hit.row, hit.col);
    }
  }
});

renderer.domElement.addEventListener('mousemove', (ev) => {
  if (mode !== 'skinning' || !skinTrack.length) return;
  const hit = raycastTerrain(ev.clientX, ev.clientY);
  if (hit) {
    const preview = skinTrack.setPreview(hit.row, hit.col);
    refreshSkinningPanel(preview);
  }
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (mode === 'skiing' && skier) {
    stepSkiing(dt);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();

async function boot() {
  const [zones, scenarioIndex] = await Promise.all([
    loadZoneIndex(),
    fetch(dataUrl('data/forecasts/index.json')).then((r) => r.json()),
  ]);
  renderMenu(menuEl, { zones, scenarios: scenarioIndex }, (zoneId, scenarioId) => startRun(zoneId, scenarioId));
}

async function startRun(zoneId, scenarioId) {
  menuEl.classList.add('hidden');
  hideDebrief(debriefEl);

  [zoneData, scenario] = await Promise.all([
    loadZone(zoneId),
    fetch(dataUrl(`data/forecasts/${scenarioId}.json`)).then((r) => r.json()),
  ]);

  clearScene();

  const built = buildTerrain(zoneData);
  terrainMesh = built.mesh;
  grid = built.grid;
  scene.add(terrainMesh);

  hazardModel = buildHazardModel(zoneData, scenario);

  const span = Math.max(grid.width, grid.height) * grid.cellSize;
  camera.position.set(0, span * 0.55, span * 0.6);
  controls.target.set(0, (grid.maxElev - grid.minElev) * 0.3, 0);
  controls.enabled = true;
  controls.update();

  skinTrack = new SkinTrack(scene, grid);
  skier = null;
  skierMesh.visible = false;

  setupRosePanel(scenario);
  mode = 'skinning';
  refreshSkinningPanel();
  setHUDFromCell(Math.round(grid.height / 2), Math.round(grid.width / 2));
}

function clearScene() {
  for (const child of [terrainMesh, skinTrack?.group].filter(Boolean)) {
    scene.remove(child);
  }
  terrainMesh = null;
  skinTrack = null;
}

function refreshSkinningPanel(preview = null) {
  renderSkinningPanel(
    modePanelEl,
    { waypointCount: skinTrack.length, gainM: skinTrack.totalVerticalGainM(), preview },
    { onUndo: () => { skinTrack.removeLast(); refreshSkinningPanel(); }, onClear: () => { skinTrack.clear(); refreshSkinningPanel(); }, onDropIn: dropIn }
  );
}

function dropIn() {
  if (skinTrack.length < 2) return;
  const last = skinTrack.waypoints[skinTrack.waypoints.length - 1];
  skier = new Skier(grid, last.row, last.col);
  skierMesh.visible = true;
  controls.enabled = false;
  mode = 'skiing';
  renderSkiingPanel(modePanelEl);
}

function stepSkiing(dt) {
  const status = skier.update(dt, input, hazardModel);

  skierMesh.position.set(skier.worldX, skier.worldY + 6, skier.worldZ);
  skierMesh.rotation.y = -skier.headingRad;

  const forward = { x: Math.sin(skier.headingRad), z: -Math.cos(skier.headingRad) };
  const camBack = 90;
  const camHeight = 45;
  camera.position.set(
    skier.worldX - forward.x * camBack,
    skier.worldY + camHeight,
    skier.worldZ - forward.z * camBack
  );
  camera.lookAt(skier.worldX + forward.x * 40, skier.worldY + 10, skier.worldZ + forward.z * 40);

  setRiskVignette(riskVignetteEl, skier.currentRiskGauge(hazardModel));
  setHUDFromCell(skier.row, skier.col, skier.speed);

  if (status !== 'running') {
    endRun(status);
  }
}

function endRun(status) {
  mode = 'debrief'; // blocks skinning-click/skiing-input handling while the debrief is shown
  controls.enabled = false;
  if (status === 'triggered') {
    renderDebrief(debriefEl, { type: 'triggered', ...skier.triggerInfo }, backToMenu);
  } else {
    renderDebrief(debriefEl, {
      type: 'clean',
      distanceSkied: skier.distanceSkied,
      aspectsCrossed: skier.aspectsCrossed,
      maxRatingEncountered: skier.maxRatingEncountered,
    }, backToMenu);
  }
}

async function backToMenu() {
  hideDebrief(debriefEl);
  skierMesh.visible = false;
  mode = 'menu';
  modePanelEl.innerHTML = '';
  riskVignetteEl.style.opacity = '0';
  const [zones, scenarioIndex] = await Promise.all([
    loadZoneIndex(),
    fetch(dataUrl('data/forecasts/index.json')).then((r) => r.json()),
  ]);
  menuEl.classList.remove('hidden');
  renderMenu(menuEl, { zones, scenarios: scenarioIndex }, (zoneId, scenarioId) => startRun(zoneId, scenarioId));
}

function setHUDFromCell(row, col, speedMs = null) {
  const cell = grid.at(row, col);
  if (!cell) return;
  renderHUD(hudEl, {
    zoneName: zoneData.name,
    elevationFt: Math.round(cell.elevation_m * 3.28084),
    slopeDeg: cell.slope_deg,
    aspectLabel: cell.slope_deg < 1 ? 'flat' : aspectLabel(cell.aspect_deg),
    speedText: speedMs != null ? `${(speedMs * 2.23694).toFixed(0)} mph` : null,
  });
}

function setupRosePanel(scenarioData) {
  let panel = document.getElementById('rose-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'rose-panel';
    document.getElementById('app').appendChild(panel);
  }
  panel.innerHTML = '';
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 190;
  canvasEl.height = 190;
  panel.appendChild(canvasEl);
  const title = document.createElement('div');
  title.className = 'rose-title';
  title.textContent = scenarioData.title;
  panel.appendChild(title);
  drawDangerRose(canvasEl, scenarioData.danger_rose);
}

boot();
