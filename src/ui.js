export const RATING_COLORS = {
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

export function renderSkinningPanel(container, { waypointCount, gainM, preview }, handlers) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.innerHTML = `
    <div class="mode-title">Setting skin track</div>
    <div class="mode-hint">Click terrain to lay a waypoint. Switchbacks are fine — click anywhere,
    the track doesn't need to be a straight line. Segments over ${26}&deg; are flagged: efficient
    skinning avoids them.</div>
  `;
  if (preview) {
    const readout = document.createElement('div');
    readout.className = 'segment-readout' + (preview.risky ? ' risky' : '');
    readout.textContent = `Segment: ${preview.slopeDeg.toFixed(0)}°${preview.risky ? '  — steep for a skin track' : ''}`;
    box.appendChild(readout);
  }
  const stats = document.createElement('div');
  stats.className = 'segment-readout';
  stats.textContent = `${waypointCount} waypoint${waypointCount === 1 ? '' : 's'} · ${Math.round(gainM)}m gain`;
  box.appendChild(stats);

  const undoBtn = document.createElement('button');
  undoBtn.className = 'btn-secondary';
  undoBtn.textContent = 'Undo';
  undoBtn.disabled = waypointCount === 0;
  undoBtn.onclick = handlers.onUndo;

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-secondary';
  clearBtn.textContent = 'Clear';
  clearBtn.disabled = waypointCount === 0;
  clearBtn.onclick = handlers.onClear;

  const dropInBtn = document.createElement('button');
  dropInBtn.className = 'btn-primary';
  dropInBtn.textContent = 'Drop In';
  dropInBtn.disabled = waypointCount < 2;
  dropInBtn.onclick = handlers.onDropIn;

  box.appendChild(undoBtn);
  box.appendChild(clearBtn);
  box.appendChild(dropInBtn);
  container.appendChild(box);
}

export function renderSkiingPanel(container) {
  container.innerHTML = `
    <div class="mode-title">Skiing</div>
    <div class="mode-hint">Arrow keys: &larr;/&rarr; steer, &uarr; tuck (faster, less drag), &darr; brake.
    Speed trades against control — the faster you're going, the more you're committed to a line.</div>
  `;
}

export function setRiskVignette(el, gauge) {
  el.style.opacity = String(Math.max(0, Math.min(0.85, gauge * 0.85)));
}

export function renderDebrief(container, result, onRestart) {
  container.innerHTML = '';
  container.classList.add('visible');

  const panel = document.createElement('div');

  if (result.type === 'triggered') {
    panel.className = 'debrief-panel triggered';
    const mech = result.mechanism === 'remote'
      ? 'Remote-triggered — the slope you were on wasn’t the one that released. Your weight loaded terrain connected to a much more loaded slope nearby, and it propagated back to you.'
      : 'Direct trigger — the slope under your skis released.';
    panel.innerHTML = `
      <h1>Triggered</h1>
      <div class="debrief-sub">${mech}</div>
      <div class="debrief-stats">
        <div><span class="stat-label">Elevation band</span>${result.band?.replace('_', ' ') ?? '—'}</div>
        <div><span class="stat-label">Aspect</span>${result.aspectLabel ?? '—'}</div>
        <div><span class="stat-label">Slope angle</span>${result.slope_deg != null ? Math.round(result.slope_deg) + '°' : '—'}</div>
        <div><span class="stat-label">Forecast rating there</span>${result.rating != null ? ratingName(result.rating) : '—'}</div>
        <div><span class="stat-label">Terrain trap</span>${result.trapSeverity > 0 ? 'Yes — confined, limited escape' : 'No'}</div>
      </div>
    `;
  } else {
    panel.className = 'debrief-panel clean';
    const aspectList = [...result.aspectsCrossed].map((s) => s.replace('|', ' ').replace('_', ' ')).join(', ') || 'none steep enough to count';
    panel.innerHTML = `
      <h1>Clean descent</h1>
      <div class="debrief-sub">You skied out.</div>
      <div class="debrief-stats">
        <div><span class="stat-label">Distance skied</span>${Math.round(result.distanceSkied)}m</div>
        <div><span class="stat-label">Aspects/bands crossed</span>${aspectList}</div>
        <div><span class="stat-label">Highest rating exposed to</span>${result.maxRatingEncountered ? ratingName(result.maxRatingEncountered) : 'Low'}</div>
      </div>
    `;
  }

  const btn = document.createElement('button');
  btn.textContent = 'Back to menu';
  btn.onclick = onRestart;
  panel.appendChild(btn);
  container.appendChild(panel);
}

export function hideDebrief(container) {
  container.classList.remove('visible');
}

export function renderHUD(container, state) {
  container.innerHTML = `
    <div class="hud-row"><span class="hud-label">Zone</span><span>${state.zoneName}</span></div>
    <div class="hud-row"><span class="hud-label">Elevation</span><span>${state.elevationFt} ft</span></div>
    <div class="hud-row"><span class="hud-label">Slope</span><span>${state.slopeDeg}°</span></div>
    <div class="hud-row"><span class="hud-label">Aspect</span><span>${state.aspectLabel}</span></div>
    ${state.speedText ? `<div class="hud-row"><span class="hud-label">Speed</span><span>${state.speedText}</span></div>` : ''}
  `;
}
