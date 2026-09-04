import * as THREE from 'three';

export const RISKY_SKIN_SLOPE_DEG = 26;

/**
 * Click-to-place skin track: waypoints from a trailhead up to a drop-in
 * point, switchbacks included for free (just more waypoints - there's no
 * constraint forcing a straight line). Segments steeper than
 * RISKY_SKIN_SLOPE_DEG render differently so the player can see, live,
 * that they're choosing an inefficient/risky skin line rather than
 * sidehilling around it.
 */
export class SkinTrack {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.waypoints = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._segmentObjects = [];
    this._markerObjects = [];
    this._previewLine = null;
  }

  get length() {
    return this.waypoints.length;
  }

  worldFromGrid(row, col) {
    const x = col * this.grid.cellSize - this.grid.halfW;
    const z = row * this.grid.cellSize - this.grid.halfH;
    const y = this.grid.gridToWorldY(row, col);
    return new THREE.Vector3(x, (y ?? 0) + 1.5, z);
  }

  segmentSlopeDeg(a, b) {
    const pa = this.worldFromGrid(a.row, a.col);
    const pb = this.worldFromGrid(b.row, b.col);
    const horiz = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const vert = Math.abs(pb.y - pa.y);
    if (horiz < 1e-6) return 90;
    return (Math.atan2(vert, horiz) * 180) / Math.PI;
  }

  addWaypoint(row, col) {
    this.waypoints.push({ row, col });
    this._rebuild();
  }

  removeLast() {
    this.waypoints.pop();
    this._rebuild();
  }

  clear() {
    this.waypoints = [];
    this._rebuild();
  }

  hasRiskySegment() {
    for (let i = 1; i < this.waypoints.length; i++) {
      if (this.segmentSlopeDeg(this.waypoints[i - 1], this.waypoints[i]) > RISKY_SKIN_SLOPE_DEG) return true;
    }
    return false;
  }

  totalVerticalGainM() {
    let gain = 0;
    for (let i = 1; i < this.waypoints.length; i++) {
      const y0 = this.grid.gridToWorldY(this.waypoints[i - 1].row, this.waypoints[i - 1].col) ?? 0;
      const y1 = this.grid.gridToWorldY(this.waypoints[i].row, this.waypoints[i].col) ?? 0;
      if (y1 > y0) gain += y1 - y0;
    }
    return gain;
  }

  /** Live dashed preview segment from the last waypoint to a hover point;
   * returns the slope/risky info so the caller can show a HUD readout. */
  setPreview(row, col) {
    this._clearPreview();
    if (!this.waypoints.length) return null;
    const last = this.waypoints[this.waypoints.length - 1];
    const slopeDeg = this.segmentSlopeDeg(last, { row, col });
    const risky = slopeDeg > RISKY_SKIN_SLOPE_DEG;

    const pa = this.worldFromGrid(last.row, last.col);
    const pb = this.worldFromGrid(row, col);
    const geometry = new THREE.BufferGeometry().setFromPoints([pa, pb]);
    const material = new THREE.LineDashedMaterial({
      color: risky ? 0xff5533 : 0xffe27a,
      dashSize: 6,
      gapSize: 4,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.group.add(line);
    this._previewLine = line;
    return { slopeDeg, risky };
  }

  _clearPreview() {
    if (this._previewLine) {
      this.group.remove(this._previewLine);
      this._previewLine.geometry.dispose();
      this._previewLine.material.dispose();
      this._previewLine = null;
    }
  }

  _rebuild() {
    for (const obj of [...this._segmentObjects, ...this._markerObjects]) {
      this.group.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._segmentObjects = [];
    this._markerObjects = [];

    for (let i = 1; i < this.waypoints.length; i++) {
      const a = this.waypoints[i - 1];
      const b = this.waypoints[i];
      const risky = this.segmentSlopeDeg(a, b) > RISKY_SKIN_SLOPE_DEG;
      const pa = this.worldFromGrid(a.row, a.col);
      const pb = this.worldFromGrid(b.row, b.col);
      const geometry = new THREE.BufferGeometry().setFromPoints([pa, pb]);
      const material = new THREE.LineBasicMaterial({ color: risky ? 0xff5533 : 0xffe27a });
      const line = new THREE.Line(geometry, material);
      this.group.add(line);
      this._segmentObjects.push(line);
    }

    this.waypoints.forEach((wp, i) => {
      const isLast = i === this.waypoints.length - 1;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(this.grid.cellSize * (isLast ? 0.6 : 0.4), 8, 8),
        new THREE.MeshBasicMaterial({ color: isLast ? 0x33ff77 : 0xffffff })
      );
      marker.position.copy(this.worldFromGrid(wp.row, wp.col));
      this.group.add(marker);
      this._markerObjects.push(marker);
    });
  }
}
