#!/usr/bin/env python3
"""Build a zone's terrain.json from real USGS 3DEP elevation data.

Usage:
    source venv/bin/activate
    python export_zone.py --zone mt_superior
    python export_zone.py --zone wolverine_cirque
    python export_zone.py --all

Writes public/data/zones/<zone_id>/terrain.json and prints a sanity check
against the zone's known reference stats (see zones.py) so bad data gets
caught here, before it's load-bearing for gameplay.
"""

import argparse
import json
import math
import pathlib

import numpy as np

from zones import ZONES, get_zone
from sources import usgs_3dep
from terrain_processing import (
    reproject_to_grid,
    slope_aspect_horn,
    detect_curvature_traps,
    apply_manual_traps,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "public" / "data" / "zones"


def build_zone(zone_id, source_module=usgs_3dep):
    zone = get_zone(zone_id)
    print(f"\n=== {zone['name']} ({zone_id}) ===")
    print(f"Fetching DEM window: center=({zone['center_lat']}, {zone['center_lon']}), "
          f"radius={zone['radius_m']}m, source={source_module.__name__}")

    dem_window = source_module.fetch_dem_window(
        zone["center_lat"], zone["center_lon"], zone["radius_m"]
    )
    print(f"  DEM window array shape: {dem_window.array.shape}, crs={dem_window.crs}")

    elevation, transform, grid_info = reproject_to_grid(
        dem_window,
        zone["center_lat"], zone["center_lon"],
        zone["radius_m"], zone["cell_size_m"], zone["utm_epsg"],
    )
    n = grid_info["n"]
    print(f"  Resampled grid: {n}x{n} cells @ {zone['cell_size_m']}m")

    slope_deg, aspect_deg = slope_aspect_horn(elevation, zone["cell_size_m"])
    trap_grid, curvature = detect_curvature_traps(elevation, slope_deg, zone["cell_size_m"])
    trap_grid = apply_manual_traps(trap_grid, grid_info, zone.get("manual_traps", []), zone["utm_epsg"])

    sanity_check(zone, elevation, slope_deg, grid_info)

    payload = {
        "zone_id": zone_id,
        "name": zone["name"],
        "grid": {
            "width": n,
            "height": n,
            "cell_size_m": zone["cell_size_m"],
        },
        "origin": {
            "center_lat": zone["center_lat"],
            "center_lon": zone["center_lon"],
            "utm_epsg": zone["utm_epsg"],
            "utm_origin_x": round(grid_info["origin_x"], 2),
            "utm_origin_y": round(grid_info["origin_y"], 2),
            "utm_center_x": round(grid_info["center_x"], 2),
            "utm_center_y": round(grid_info["center_y"], 2),
        },
        "trailhead": zone.get("trailhead"),
        "reference": zone.get("reference"),
        # Flat, row-major (north -> south, west -> east) arrays, quantized
        # to int16 to keep this a fast browser fetch. elevation/slope are
        # whole units (meters / degrees) - plenty of precision for gameplay.
        "elevation_m": np.round(elevation).astype(np.int16).flatten().tolist(),
        "slope_deg": np.round(slope_deg).astype(np.int16).flatten().tolist(),
        "aspect_deg": (np.round(aspect_deg).astype(np.int16) % 360).flatten().tolist(),
        "trap": trap_grid.astype(np.uint8).flatten().tolist(),
    }

    out_dir = OUT_DIR / zone_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "terrain.json"
    with open(out_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    size_kb = out_path.stat().st_size / 1024
    print(f"  Wrote {out_path.relative_to(REPO_ROOT)} ({size_kb:.0f} KB)")
    return payload


def sanity_check(zone, elevation, slope_deg, grid_info):
    ref = zone.get("reference", {})
    print("  --- sanity check ---")
    print(f"  grid elevation range: {elevation.min():.0f}m - {elevation.max():.0f}m "
          f"({elevation.min()*3.28084:.0f}ft - {elevation.max()*3.28084:.0f}ft)")

    expected_ft = ref.get("summit_elevation_ft")
    if expected_ft:
        actual_max_ft = elevation.max() * 3.28084
        delta = abs(actual_max_ft - expected_ft)
        status = "OK" if delta < 250 else "CHECK THIS"
        print(f"  expected summit ~{expected_ft}ft vs grid max {actual_max_ft:.0f}ft "
              f"(delta {delta:.0f}ft) [{status}]")
    else:
        print("  (no reference summit elevation for this zone - skipping that check)")

    slope_range = ref.get("south_face_slope_deg_range")
    if slope_range:
        # Sample slope near the middle-upper part of the grid as a rough
        # proxy for "the face" - this is a coarse spot check, not a precise
        # polygon query.
        n = grid_info["n"]
        mid = slice(n // 3, 2 * n // 3)
        sample = slope_deg[mid, mid]
        p50, p90 = np.percentile(sample, [50, 90])
        lo, hi = slope_range
        in_range = lo <= p50 <= hi or lo <= p90 <= hi
        status = "OK" if in_range else "CHECK THIS"
        print(f"  expected face slope {lo}-{hi}deg vs grid center-region "
              f"median={p50:.0f}deg / p90={p90:.0f}deg [{status}]")

    print(f"  slope grid overall: mean={slope_deg.mean():.1f}deg max={slope_deg.max():.1f}deg")
    print("  --------------------")


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--zone", choices=list(ZONES.keys()))
    group.add_argument("--all", action="store_true")
    args = parser.parse_args()

    zone_ids = list(ZONES.keys()) if args.all else [args.zone]
    for zone_id in zone_ids:
        build_zone(zone_id)


if __name__ == "__main__":
    main()
