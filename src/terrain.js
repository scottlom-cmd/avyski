import * as THREE from 'three';

// Elevation-band color ramp for the base terrain look. Rough approximation
// of real Wasatch ground cover at these elevations, not a satellite texture.
const ELEVATION_STOPS = [
  { t: 0.0, color: new THREE.Color(0x4a5a3a) },  // low, brushy/talus
  { t: 0.35, color: new THREE.Color(0x5f6b52) }, // mid, sparse timber
  { t: 0.62, color: new THREE.Color(0x8a8f80) }, // near treeline, rock/scrub
  { t: 0.82, color: new THREE.Color(0xb9bcb4) }, // alpine rock
  { t: 1.0, color: new THREE.Color(0xf2f4f0) },  // ridge/snow
];

function elevationColor(t) {
  for (let i = 1; i < ELEVATION_STOPS.length; i++) {
    if (t <= ELEVATION_STOPS[i].t) {
      const a = ELEVATION_STOPS[i - 1];
      const b = ELEVATION_STOPS[i];
      const localT = (t - a.t) / (b.t - a.t || 1);
      return a.color.clone().lerp(b.color, localT);
    }
  }
  return ELEVATION_STOPS[ELEVATION_STOPS.length - 1].color.clone();
}

export async function loadZone(zoneId) {
  const res = await fetch(`/data/zones/${zoneId}/terrain.json`);
  if (!res.ok) throw new Error(`Failed to load zone '${zoneId}': HTTP ${res.status}`);
  return res.json();
}

export async function loadZoneIndex() {
  // No index.json for zones yet (only two, hardcoded here) - keep this
  // function as the seam for when a zone catalog file exists.
  return [
    { zone_id: 'mt_superior', name: 'Mt Superior' },
    { zone_id: 'wolverine_cirque', name: 'Wolverine Cirque' },
  ];
}

/**
 * Builds a Three.js mesh from a zone's terrain.json, plus a lookup object
 * exposing the same grid so gameplay code (Phase 2) can convert between
 * world-space (x, z) and grid (row, col) without re-deriving the layout.
 */
export function buildTerrain(zoneData) {
  const { width, height, cell_size_m: cellSize } = zoneData.grid;
  const elevation = zoneData.elevation_m;
  const slope = zoneData.slope_deg;
  const trap = zoneData.trap;

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] < minElev) minElev = elevation[i];
    if (elevation[i] > maxElev) maxElev = elevation[i];
  }
  const elevRange = maxElev - minElev || 1;

  const halfW = ((width - 1) * cellSize) / 2;
  const halfH = ((height - 1) * cellSize) / 2;

  const positions = new Float32Array(width * height * 3);
  const colors = new Float32Array(width * height * 3);

  const idx = (row, col) => row * width + col;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = idx(row, col);
      const x = col * cellSize - halfW;
      const z = row * cellSize - halfH; // row increases -> south -> +z
      const y = elevation[i] - minElev;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const t = (elevation[i] - minElev) / elevRange;
      const c = elevationColor(t);

      // Steep terrain reads a bit more exposed/rocky than grass-green,
      // independent of elevation band.
      const steepness = Math.min(1, Math.max(0, (slope[i] - 25) / 30));
      c.lerp(new THREE.Color(0x9a968c), steepness * 0.5);

      // Terrain-trap cells (gullies/couloirs/cliff bands): a faint cool
      // tint, not a red flag - legible on close inspection, not a UI alarm.
      if (trap[i] > 0) {
        c.lerp(new THREE.Color(0x35415a), trap[i] === 2 ? 0.35 : 0.18);
      }

      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  }

  const indices = [];
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = idx(row, col);
      const b = idx(row, col + 1);
      const c = idx(row + 1, col);
      const d = idx(row + 1, col + 1);
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const grid = {
    width,
    height,
    cellSize,
    halfW,
    halfH,
    minElev,
    maxElev,
    // world (x, z) -> fractional (col, row); callers round/clamp as needed.
    worldToGrid(x, z) {
      return { col: (x + halfW) / cellSize, row: (z + halfH) / cellSize };
    },
    gridToWorldY(row, col) {
      const r = Math.round(row);
      const c = Math.round(col);
      if (r < 0 || r >= height || c < 0 || c >= width) return null;
      return elevation[idx(r, c)] - minElev;
    },
    at(row, col) {
      const r = Math.round(row);
      const c = Math.round(col);
      if (r < 0 || r >= height || c < 0 || c >= width) return null;
      const i = idx(r, c);
      return { elevation_m: elevation[i], slope_deg: slope[i], aspect_deg: zoneData.aspect_deg[i], trap: trap[i] };
    },
  };

  return { mesh, grid };
}
