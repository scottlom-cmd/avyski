import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadZone, loadZoneIndex, buildTerrain } from './terrain.js';
import { renderMenu, renderHUD, drawDangerRose, ratingName } from './ui.js';

const ASPECT_LABELS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function aspectLabel(deg) {
  const i = Math.round(deg / 22.5) % 16;
  return ASPECT_LABELS[i];
}

const canvas = document.getElementById('scene');
const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');

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

let currentGrid = null;
let cursorMarker = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

async function boot() {
  const [zones, scenarioIndex] = await Promise.all([
    loadZoneIndex(),
    fetch('/data/forecasts/index.json').then((r) => r.json()),
  ]);
  renderMenu(menuEl, { zones, scenarios: scenarioIndex }, (zoneId, scenarioId) => startRun(zoneId, scenarioId));
}

async function startRun(zoneId, scenarioId) {
  menuEl.classList.add('hidden');

  const [zoneData, scenario] = await Promise.all([
    loadZone(zoneId),
    fetch(`/data/forecasts/${scenarioId}.json`).then((r) => r.json()),
  ]);

  // Clear any previously loaded terrain (switching runs from the menu later).
  for (const child of [...scene.children]) {
    if (child.userData.isTerrain) scene.remove(child);
  }

  const { mesh, grid } = buildTerrain(zoneData);
  mesh.userData.isTerrain = true;
  scene.add(mesh);
  currentGrid = grid;

  const span = Math.max(grid.width, grid.height) * grid.cellSize;
  camera.position.set(0, span * 0.55, span * 0.6);
  controls.target.set(0, (grid.maxElev - grid.minElev) * 0.3, 0);
  controls.update();

  cursorMarker = new THREE.Mesh(
    new THREE.SphereGeometry(grid.cellSize * 1.2, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5533 })
  );
  cursorMarker.userData.isTerrain = true;
  scene.add(cursorMarker);

  setupRosePanel(scenario);
  setHUD(zoneData.name, grid.height / 2, grid.width / 2, grid);

  renderer.domElement.addEventListener('click', (ev) => onTerrainClick(ev, zoneData, grid));
}

function onTerrainClick(ev, zoneData, grid) {
  pointer.x = (ev.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children.filter((c) => c.userData.isTerrain && c.type === 'Mesh' && c.geometry.type === 'BufferGeometry'));
  if (!hits.length) return;
  const p = hits[0].point;
  const { row, col } = grid.worldToGrid(p.x, p.z);
  cursorMarker.position.set(p.x, p.y + 2, p.z);
  setHUD(zoneData.name, row, col, grid);
}

function setHUD(zoneName, row, col, grid) {
  const cell = grid.at(row, col);
  if (!cell) return;
  renderHUD(hudEl, {
    zoneName,
    elevationFt: Math.round(cell.elevation_m * 3.28084),
    slopeDeg: cell.slope_deg,
    aspectLabel: cell.slope_deg < 1 ? 'flat' : aspectLabel(cell.aspect_deg),
  });
}

function setupRosePanel(scenario) {
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
  title.textContent = scenario.title;
  panel.appendChild(title);
  drawDangerRose(canvasEl, scenario.danger_rose);
}

boot();
