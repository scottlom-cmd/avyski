const RATING_COLORS = {
  1: '#6bbf59', // Low
  2: '#ffeb3b', // Moderate
  3: '#ff9800', // Considerable
  4: '#e53935', // High
  5: '#1a1a1a', // Extreme
};
const RATING_NAMES = { 1: 'Low', 2: 'Moderate', 3: 'Considerable', 4: 'High', 5: 'Extreme' };
const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const BANDS = [
  { key: 'below_treeline', rOuterFrac: 0.45 },
  { key: 'near_treeline', rOuterFrac: 0.72 },
  { key: 'above_treeline', rOuterFrac: 1.0 },
];

/** Draws a standard avalanche.org-style danger rose (elevation band x aspect). */
export function drawDangerRose(canvas, dangerRose) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 18;

  let rInner = 0;
  for (const band of BANDS) {
    const rOuter = band.rOuterFrac * maxR;
    ASPECTS.forEach((aspect, i) => {
      const rating = dangerRose[band.key][aspect];
      const startAngle = ((-90 + i * 45 - 22.5) * Math.PI) / 180;
      const endAngle = ((-90 + i * 45 + 22.5) * Math.PI) / 180;

      ctx.beginPath();
      ctx.moveTo(cx + rInner * Math.cos(startAngle), cy + rInner * Math.sin(startAngle));
      ctx.arc(cx, cy, rOuter, startAngle, endAngle);
      ctx.arc(cx, cy, rInner, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = RATING_COLORS[rating] || '#555';
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,18,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    rInner = rOuter;
  }

  ctx.fillStyle = '#e8edf2';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelR = maxR + 11;
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([label, deg]) => {
    const rad = ((-90 + deg) * Math.PI) / 180;
    ctx.fillText(label, cx + labelR * Math.cos(rad), cy + labelR * Math.sin(rad));
  });
}

export function ratingName(rating) {
  return RATING_NAMES[rating] || '?';
}

/** Renders the pre-game zone + scenario picker into `container`; calls
 * onStart(zoneId, scenarioId) when the player confirms. */
export function renderMenu(container, { zones, scenarios }, onStart) {
  let selectedZone = zones[0]?.zone_id ?? null;
  let selectedScenario = scenarios[0]?.scenario_id ?? null;

  function render() {
    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    panel.innerHTML = `
      <h1>avyski</h1>
      <div class="subtitle">Real terrain. Real forecasts. Set your track, then ski it.</div>
    `;

    const zoneSection = document.createElement('div');
    zoneSection.className = 'menu-section';
    zoneSection.innerHTML = '<h2>Zone</h2>';
    const zoneGrid = document.createElement('div');
    zoneGrid.className = 'option-grid';
    zones.forEach((z) => {
      const card = document.createElement('button');
      card.className = 'option-card' + (z.zone_id === selectedZone ? ' selected' : '');
      card.innerHTML = `<div class="card-title">${z.name}</div><div class="card-meta">${z.zone_id}</div>`;
      card.onclick = () => { selectedZone = z.zone_id; render(); };
      zoneGrid.appendChild(card);
    });
    zoneSection.appendChild(zoneGrid);

    const scenarioSection = document.createElement('div');
    scenarioSection.className = 'menu-section';
    scenarioSection.innerHTML = '<h2>Forecast day</h2>';
    const scenarioGrid = document.createElement('div');
    scenarioGrid.className = 'option-grid';
    scenarios.forEach((s) => {
      const card = document.createElement('button');
      card.className = 'option-card' + (s.scenario_id === selectedScenario ? ' selected' : '');
      card.innerHTML = `
        <div class="card-title">${s.title}</div>
        <div class="card-meta">${s.date ?? 'composite'}</div>
        <span class="confidence-tag ${s.confidence}">${s.confidence}</span>
      `;
      card.onclick = () => { selectedScenario = s.scenario_id; render(); };
      scenarioGrid.appendChild(card);
    });
    scenarioSection.appendChild(scenarioGrid);

    const startBtn = document.createElement('button');
    startBtn.className = 'start-btn';
    startBtn.textContent = 'Start';
    startBtn.disabled = !selectedZone || !selectedScenario;
    startBtn.onclick = () => onStart(selectedZone, selectedScenario);

    panel.appendChild(zoneSection);
    panel.appendChild(scenarioSection);
    panel.appendChild(startBtn);
    container.appendChild(panel);
  }

  render();
}

export function renderHUD(container, state) {
  container.innerHTML = `
    <div class="hud-row"><span class="hud-label">Zone</span><span>${state.zoneName}</span></div>
    <div class="hud-row"><span class="hud-label">Elevation</span><span>${state.elevationFt} ft</span></div>
    <div class="hud-row"><span class="hud-label">Slope</span><span>${state.slopeDeg}°</span></div>
    <div class="hud-row"><span class="hud-label">Aspect</span><span>${state.aspectLabel}</span></div>
  `;
}
