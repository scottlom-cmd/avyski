// Risk model: direct triggering, remote triggering across connected
// terrain, terrain-trap consequence, and ridge/pocket transit safety.
// Pure grid logic - no Three.js/DOM here, so it's easy to reason about and
// to unit-test independently of rendering.

const ASPECTS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass8(aspectDeg) {
  return ASPECTS8[Math.round(aspectDeg / 45) % 8];
}

export function elevationBand(elevationM, bandsFt) {
  const ft = elevationM * 3.28084;
  if (ft < bandsFt.below_treeline_max) return 'below_treeline';
  if (ft < bandsFt.near_treeline_max) return 'near_treeline';
  return 'above_treeline';
}

function circularAspectDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Cells this steep or steeper are grouped into avalanche-path "facets" -
// connected components of similarly-oriented steep terrain. This is what
// makes remote-triggering possible: a facet's danger rating can reach a
// player standing on a much gentler, connected cell nearby.
const STEEP_THRESHOLD_DEG = 27;
const MAX_ASPECT_DRIFT_DEG = 50; // how much a facet's aspect can curve before we call it a different path
const MIN_FACET_CELLS = 4;
const MIN_HOT_FACET_CELLS = 6;
const HOT_RATING_THRESHOLD = 3; // Considerable+

/**
 * Flood-fills the slope/aspect grids into avalanche-path facets: connected
 * (8-neighbor) regions of steep, similarly-oriented terrain. Grouping by
 * aspect continuity (not just slope) keeps a facet from bleeding across a
 * rounded ridge onto the opposite-facing slope, which would otherwise
 * merge two unrelated avalanche paths into one.
 */
function buildFacets(width, height, slope, aspect, elevation) {
  const n = width * height;
  const visited = new Uint8Array(n);
  const facetId = new Int32Array(n).fill(-1);
  const facets = [];
  const queue = new Int32Array(n);
  const idx = (r, c) => r * width + c;

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    if (slope[start] < STEEP_THRESHOLD_DEG) { visited[start] = 1; continue; }

    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    visited[start] = 1;

    const cells = [];
    let sumElev = 0, sumRow = 0, sumCol = 0, sumSin = 0, sumCos = 0;

    while (qHead < qTail) {
      const cur = queue[qHead++];
      cells.push(cur);
      const r = Math.floor(cur / width);
      const c = cur % width;
      sumElev += elevation[cur];
      sumRow += r;
      sumCol += c;
      const rad = (aspect[cur] * Math.PI) / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          const ni = idx(nr, nc);
          if (visited[ni] || slope[ni] < STEEP_THRESHOLD_DEG) continue;
          if (circularAspectDiff(aspect[cur], aspect[ni]) > MAX_ASPECT_DRIFT_DEG) continue;
          visited[ni] = 1;
          queue[qTail++] = ni;
        }
      }
    }

    if (cells.length < MIN_FACET_CELLS) continue;

    const meanAspectDeg = ((Math.atan2(sumSin / cells.length, sumCos / cells.length) * 180) / Math.PI + 360) % 360;
    const facet = {
      id: facets.length,
      cells,
      size: cells.length,
      meanElevation: sumElev / cells.length,
      meanRow: sumRow / cells.length,
      meanCol: sumCol / cells.length,
      meanAspectDeg,
    };
    for (const ci of cells) facetId[ci] = facet.id;
    facets.push(facet);
  }

  return { facets, facetId };
}

/**
 * Multi-source BFS out from every "hot" facet cell (Considerable+ danger),
 * recording distance-in-cells and which facet reached each cell first.
 * Expansion is capped by a per-branch elevation-gain tolerance measured
 * against that branch's own origin cell - not a global tolerance - so a
 * real ridge or rollover taller than the tolerance blocks propagation onto
 * the far (unconnected) side, while a gently rolling apron or bench at
 * roughly the same elevation as the hot slope above it stays reachable.
 * This is the adjacency logic that drives remote triggering: proximity is
 * measured through the terrain, not "same cell" or straight-line distance.
 */
function computeRemoteReach(width, height, elevation, facetId, hotFacetIds, maxRadiusCells, climbToleranceM) {
  const n = width * height;
  const dist = new Int16Array(n).fill(-1);
  const originElev = new Float32Array(n);
  const nearestFacet = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;
  const idx = (r, c) => r * width + c;

  for (let i = 0; i < n; i++) {
    if (facetId[i] >= 0 && hotFacetIds.has(facetId[i])) {
      dist[i] = 0;
      originElev[i] = elevation[i];
      nearestFacet[i] = facetId[i];
      queue[qTail++] = i;
    }
  }

  while (qHead < qTail) {
    const cur = queue[qHead++];
    const d = dist[cur];
    if (d >= maxRadiusCells) continue;
    const r = Math.floor(cur / width);
    const c = cur % width;
    const oe = originElev[cur];

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
        const ni = idx(nr, nc);
        if (dist[ni] !== -1) continue;
        if (elevation[ni] > oe + climbToleranceM) continue;
        dist[ni] = d + 1;
        originElev[ni] = oe;
        nearestFacet[ni] = nearestFacet[cur];
        queue[qTail++] = ni;
      }
    }
  }

  return { dist, nearestFacet };
}

// Per-second hazard rates. These are game-balance constants, not
// avalanche-science ones - tuned so Considerable feels noticeably riskier
// than Moderate on steep terrain without making every run a coin flip.
const DIRECT_SLOPE_RAMP_START = 28;
const DIRECT_SLOPE_RAMP_END = 40;
const DIRECT_RATE_BY_RATING = { 1: 0.0015, 2: 0.006, 3: 0.018, 4: 0.040, 5: 0.075 };
const REMOTE_RATE_BY_RATING = { 1: 0, 2: 0, 3: 0.016, 4: 0.035, 5: 0.065 };
const REMOTE_MAX_RADIUS_CELLS = 20; // ~200m at 10m cells
const REMOTE_CLIMB_TOLERANCE_M = 20;
const RIDGE_SLOPE_CUTOFF_DEG = 10;
const RIDGE_REMOTE_DAMPEN = 0.3;
const TRAP_MULTIPLIER = { 0: 1.0, 1: 1.3, 2: 1.6 };
const RISK_GAUGE_REFERENCE_RATE = 0.05; // per-second rate that reads as "1.0" on the subtle visual cue

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

export function buildHazardModel(zoneData, scenario) {
  const { width, height, cell_size_m: cellSize } = zoneData.grid;
  const elevation = zoneData.elevation_m;
  const slope = zoneData.slope_deg;
  const aspect = zoneData.aspect_deg;
  const trap = zoneData.trap;
  const bandsFt = zoneData.elevation_bands_ft;

  const { facets, facetId } = buildFacets(width, height, slope, aspect, elevation);

  for (const facet of facets) {
    facet.band = elevationBand(facet.meanElevation, bandsFt);
    facet.aspectLabel = compass8(facet.meanAspectDeg);
    facet.rating = scenario.danger_rose[facet.band][facet.aspectLabel];
  }

  const hotFacetIds = new Set(
    facets.filter((f) => f.rating >= HOT_RATING_THRESHOLD && f.size >= MIN_HOT_FACET_CELLS).map((f) => f.id)
  );

  const { dist: remoteDist, nearestFacet: remoteFacet } = computeRemoteReach(
    width, height, elevation, facetId, hotFacetIds, REMOTE_MAX_RADIUS_CELLS, REMOTE_CLIMB_TOLERANCE_M
  );

  const idx = (row, col) => row * width + col;
  const inBounds = (row, col) => row >= 0 && row < height && col >= 0 && col < width;

  function ratingAt(i) {
    const band = elevationBand(elevation[i], bandsFt);
    const label = compass8(aspect[i]);
    return scenario.danger_rose[band][label];
  }

  function slopeFactor(slopeDeg) {
    return clamp01((slopeDeg - DIRECT_SLOPE_RAMP_START) / (DIRECT_SLOPE_RAMP_END - DIRECT_SLOPE_RAMP_START));
  }

  function rateAt(rowIn, colIn) {
    const row = Math.round(rowIn);
    const col = Math.round(colIn);
    if (!inBounds(row, col)) return null;
    const i = idx(row, col);
    const trapMult = TRAP_MULTIPLIER[trap[i]] ?? 1.0;

    const rating = ratingAt(i);
    const directRate = slopeFactor(slope[i]) * (DIRECT_RATE_BY_RATING[rating] ?? 0) * trapMult;

    let remoteRate = 0;
    let remoteFacetInfo = null;
    const d = remoteDist[i];
    if (d >= 0 && remoteFacet[i] >= 0) {
      const facet = facets[remoteFacet[i]];
      const proximity = 1 - d / REMOTE_MAX_RADIUS_CELLS;
      const ridgeDampen = slope[i] < RIDGE_SLOPE_CUTOFF_DEG ? RIDGE_REMOTE_DAMPEN : 1.0;
      remoteRate = (REMOTE_RATE_BY_RATING[facet.rating] ?? 0) * proximity * ridgeDampen * trapMult;
      remoteFacetInfo = facet;
    }

    const totalRate = directRate + remoteRate;
    return {
      row, col,
      elevation_m: elevation[i],
      slope_deg: slope[i],
      aspect_deg: aspect[i],
      aspectLabel: compass8(aspect[i]),
      band: elevationBand(elevation[i], bandsFt),
      rating,
      trapSeverity: trap[i],
      directRate,
      remoteRate,
      totalRate,
      remoteFacet: remoteFacetInfo,
      riskGauge: clamp01(totalRate / RISK_GAUGE_REFERENCE_RATE),
    };
  }

  function evaluateTick(row, col, dtSeconds, rng = Math.random) {
    const r = rateAt(row, col);
    if (!r || r.totalRate <= 0) return null;
    const pDirect = 1 - Math.exp(-r.directRate * dtSeconds);
    const pRemote = 1 - Math.exp(-r.remoteRate * dtSeconds);
    const roll = rng();
    if (roll < pDirect) {
      return { mechanism: 'direct', ...r };
    }
    if (roll < pDirect + pRemote) {
      return { mechanism: 'remote', ...r };
    }
    return null;
  }

  return { width, height, cellSize, facets, rateAt, evaluateTick };
}
