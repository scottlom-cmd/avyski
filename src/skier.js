// Ski-mode physics: arrow-key steering on top of slope-following gravity.
// Deliberately arcade, not a rigid-body sim - tuned for the "make a choice
// and commit" feel called for at speed, not for realism.

const GRAVITY = 9.81;
const GRAVITY_SCALE = 0.8; // tames real-world g to a fun in-game descent rate
const BASE_TURN_RATE_DEG_S = 130; // heading turn rate at zero speed
const TURN_SPEED_REF = 14; // m/s at which turn rate has halved - the speed/control tradeoff
const FALL_LINE_ASSIST = 0.35; // how strongly skis "want" to point downhill when not steering
const DRAG_COEFF = 0.01; // speed-squared drag (snow + air)
// Real ski-snow friction is low (effective mu ~0.03-0.05 - waxed base on
// snow, not rubber on pavement). This has to stay below the downhill
// gravity component on anything but genuinely flat ground, or the skier
// grinds to a permanent halt on ordinary gentle terrain - which is exactly
// what an earlier, too-high constant here did on a 9deg slope.
const BASE_FRICTION = 0.3; // m/s^2, always-on snow friction
const BRAKE_FRICTION = 5.5; // extra friction while holding "down" (braking)
const TUCK_DRAG_MULT = 0.4; // drag multiplier while holding "up" (tucking)
const MAX_SPEED = 34; // m/s safety cap
const BOUNDARY_MARGIN_CELLS = 2;
const BOUNDARY_PUSHBACK = 40; // m/s^2, soft nudge back inside the mapped terrain
const CLEAN_DESCENT_ELEV_FRACTION = 0.12; // bottom 12% of the zone's elevation range = "skied out"
const AVERAGE_ASPECT_TRACKING_MIN_SLOPE = 12; // ignore near-flat cells when logging "aspects crossed"

function aspectToWorldDir(aspectDeg) {
  const rad = (aspectDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: -Math.cos(rad) };
}

function angleOf(x, z) {
  return Math.atan2(x, -z); // 0 = north (-z), clockwise, matches aspect convention
}

export class Skier {
  constructor(grid, startRow, startCol) {
    this.grid = grid;
    this.row = startRow;
    this.col = startCol;
    this.headingRad = 0; // 0 = facing north (-z)
    this.speed = 0;
    this.distanceSkied = 0;
    this.aspectsCrossed = new Set(); // "band|aspectLabel" pairs, for the debrief
    this.maxRatingEncountered = 0;
    this.maxRiskGaugeEncountered = 0;
    this.status = 'running'; // 'running' | 'triggered' | 'clean'
    this.triggerInfo = null;

    const cell = grid.at(startRow, startCol);
    this.worldX = startCol * grid.cellSize - grid.halfW;
    this.worldZ = startRow * grid.cellSize - grid.halfH;
    this.worldY = (cell?.elevation_m ?? grid.minElev) - grid.minElev;
    this.headingRad = ((cell?.aspect_deg ?? 180) * Math.PI) / 180; // start pointed downhill
  }

  /** input: { left, right, up, down } booleans. dt in seconds. */
  update(dt, input, hazardModel, rng = Math.random) {
    if (this.status !== 'running') return this.status;

    const cell = this.grid.at(this.row, this.col);
    if (!cell) {
      this.status = 'triggered';
      this.triggerInfo = { mechanism: 'out_of_bounds' };
      return this.status;
    }

    // --- steering ---
    const turnRate = ((BASE_TURN_RATE_DEG_S * Math.PI) / 180) / (1 + this.speed / TURN_SPEED_REF);
    if (input.left) this.headingRad -= turnRate * dt;
    if (input.right) this.headingRad += turnRate * dt;

    // Skis subtly pull toward the fall line (downhill aspect direction)
    // when the player isn't actively fighting that pull - stronger on
    // steeper ground, which is what "slope-following" gravity means here.
    const downhill = aspectToWorldDir(cell.aspect_deg);
    const downhillAngle = angleOf(downhill.x, downhill.z);
    let angleDiff = downhillAngle - this.headingRad;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const slopeRad = (cell.slope_deg * Math.PI) / 180;
    if (!input.left && !input.right) {
      this.headingRad += angleDiff * FALL_LINE_ASSIST * Math.sin(slopeRad) * dt * 2;
    }

    // --- speed: gravity along heading, minus drag/friction ---
    const headingX = Math.sin(this.headingRad);
    const headingZ = -Math.cos(this.headingRad);
    const gravityAccel = GRAVITY * GRAVITY_SCALE * Math.sin(slopeRad);
    const alongHeading = downhill.x * headingX + downhill.z * headingZ; // -1..1
    let accel = gravityAccel * alongHeading;

    const tuck = !!input.up;
    const brake = !!input.down;
    const dragMult = tuck ? TUCK_DRAG_MULT : 1.0;
    accel -= DRAG_COEFF * dragMult * this.speed * this.speed;
    accel -= BASE_FRICTION;
    if (brake) accel -= BRAKE_FRICTION;

    this.speed = Math.max(0, Math.min(MAX_SPEED, this.speed + accel * dt));

    // --- position ---
    let dx = headingX * this.speed * dt;
    let dz = headingZ * this.speed * dt;

    const { row: fRow, col: fCol } = this.grid.worldToGrid(this.worldX + dx, this.worldZ + dz);
    const margin = BOUNDARY_MARGIN_CELLS;
    if (fRow < margin || fRow > this.grid.height - 1 - margin || fCol < margin || fCol > this.grid.width - 1 - margin) {
      const towardCenterX = -Math.sign(this.worldX);
      const towardCenterZ = -Math.sign(this.worldZ);
      dx += towardCenterX * BOUNDARY_PUSHBACK * dt * dt;
      dz += towardCenterZ * BOUNDARY_PUSHBACK * dt * dt;
    }

    this.worldX += dx;
    this.worldZ += dz;
    this.distanceSkied += Math.hypot(dx, dz);

    const g = this.grid.worldToGrid(this.worldX, this.worldZ);
    this.row = Math.max(0, Math.min(this.grid.height - 1, g.row));
    this.col = Math.max(0, Math.min(this.grid.width - 1, g.col));
    const newElev = this.grid.gridToWorldY(this.row, this.col);
    if (newElev !== null) this.worldY = newElev;

    // --- exposure tracking for the debrief ---
    if (cell.slope_deg >= AVERAGE_ASPECT_TRACKING_MIN_SLOPE) {
      const risk = hazardModel.rateAt(this.row, this.col);
      if (risk) {
        this.aspectsCrossed.add(`${risk.band}|${risk.aspectLabel}`);
        this.maxRatingEncountered = Math.max(this.maxRatingEncountered, risk.rating);
        this.maxRiskGaugeEncountered = Math.max(this.maxRiskGaugeEncountered, risk.riskGauge);
      }
    }

    // --- hazard roll ---
    const tick = hazardModel.evaluateTick(this.row, this.col, dt, rng);
    if (tick) {
      this.status = 'triggered';
      this.triggerInfo = tick;
      return this.status;
    }

    // --- success: skied out to the bottom of the mapped terrain ---
    const elevFraction = (this.worldY) / (this.grid.maxElev - this.grid.minElev || 1);
    if (elevFraction <= CLEAN_DESCENT_ELEV_FRACTION) {
      this.status = 'clean';
    }

    return this.status;
  }

  currentRiskGauge(hazardModel) {
    const r = hazardModel.rateAt(this.row, this.col);
    return r ? r.riskGauge : 0;
  }
}
