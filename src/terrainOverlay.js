import * as THREE from 'three';

// Contour lines and place labels, computed straight from the real
// elevation grid we already have - no imagery/network dependency. This is
// the fix for "the terrain is hard to read without reference points":
// contour lines are how backcountry skiers actually read a slope in the
// field, and labeled summit/trailhead points give a fixed frame of
// reference the way a real map would.

function interpFrac(v0, v1, level) {
  if (v1 === v0) return 0.5;
  return (level - v0) / (v1 - v0);
}

/**
 * Marching-squares contour extraction on the elevation grid. Returns a
 * THREE.LineSegments per "weight" (regular vs. bolder index contours every
 * 5th level, matching how topo maps distinguish them).
 */
export function buildContours(zoneData, grid, intervalM = 25, indexEvery = 5) {
  const { width, height, cellSize } = grid;
  const elevation = zoneData.elevation_m;
  const idx = (r, c) => r * width + c;

  const firstLevel = Math.ceil(grid.minElev / intervalM) * intervalM;
  const lift = 0.8; // world units above the surface, avoids z-fighting

  const worldPos = (row, col, elev, out) => {
    out[0] = col * cellSize - grid.halfW;
    out[1] = elev - grid.minElev + lift;
    out[2] = row * cellSize - grid.halfH;
  };

  const regular = [];
  const index = [];
  const p = [0, 0, 0];
  let levelIndex = 0;

  for (let level = firstLevel; level <= grid.maxElev; level += intervalM, levelIndex++) {
    const bucket = levelIndex % indexEvery === 0 ? index : regular;
    for (let row = 0; row < height - 1; row++) {
      for (let col = 0; col < width - 1; col++) {
        const a = elevation[idx(row, col)];
        const b = elevation[idx(row, col + 1)];
        const c = elevation[idx(row + 1, col + 1)];
        const d = elevation[idx(row + 1, col)];

        const crossings = [];
        if ((a >= level) !== (b >= level)) {
          worldPos(row, col + interpFrac(a, b, level), level, p);
          crossings.push([...p]);
        }
        if ((b >= level) !== (c >= level)) {
          worldPos(row + interpFrac(b, c, level), col + 1, level, p);
          crossings.push([...p]);
        }
        if ((d >= level) !== (c >= level)) {
          worldPos(row + 1, col + interpFrac(d, c, level), level, p);
          crossings.push([...p]);
        }
        if ((a >= level) !== (d >= level)) {
          worldPos(row + interpFrac(a, d, level), col, level, p);
          crossings.push([...p]);
        }

        if (crossings.length === 2) {
          bucket.push(...crossings[0], ...crossings[1]);
        } else if (crossings.length === 4) {
          // Ambiguous saddle cell - pick a consistent pairing. Cosmetic
          // overlay only, so an occasional wrong pairing here isn't worth
          // full topological disambiguation.
          bucket.push(...crossings[0], ...crossings[1]);
          bucket.push(...crossings[2], ...crossings[3]);
        }
      }
    }
  }

  const group = new THREE.Group();
  const makeLines = (arr, opacity, linewidth) => {
    if (!arr.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x3a2f1f, transparent: true, opacity });
    return new THREE.LineSegments(geometry, material);
  };
  const regularLines = makeLines(regular, 0.22);
  const indexLines = makeLines(index, 0.4);
  if (regularLines) group.add(regularLines);
  if (indexLines) group.add(indexLines);

  return group;
}

function makeLabelSprite(text, { color = '#f2f0e8', bg = 'rgba(20,24,20,0.55)' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 56px -apple-system, sans-serif';
  ctx.font = font;
  const padX = 22, padY = 14;
  const textWidth = ctx.measureText(text).width;
  canvas.width = textWidth + padX * 2;
  canvas.height = 56 + padY * 2;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  // Sprites are billboards in world units (meters) on a zone that spans
  // roughly 1800-2600m - too small here and they're an unreadable dot from
  // the default camera distance, which is exactly the "labels" bug found
  // in testing (they rendered, but as illegible specks).
  const scale = 0.5;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/** Builds labeled markers for a zone's reference_points (summit, trailhead,
 * named terrain-trap features) - anything the export pipeline could place
 * in-bounds on this grid. */
export function buildReferenceLabels(zoneData, grid) {
  const group = new THREE.Group();
  for (const pt of zoneData.reference_points || []) {
    if (!pt.in_bounds) continue;
    const x = pt.col * grid.cellSize - grid.halfW;
    const z = pt.row * grid.cellSize - grid.halfH;
    const y = grid.gridToWorldY(pt.row, pt.col);
    if (y === null) continue;
    const sprite = makeLabelSprite(pt.label);
    sprite.position.set(x, y + 30, z);
    group.add(sprite);
  }
  return group;
}
