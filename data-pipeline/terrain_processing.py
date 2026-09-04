"""Reproject a raw DEM window to a flat local-meters grid, then derive the
per-cell slope/aspect/terrain-trap layers the game actually consumes.

Everything downstream of fetch_dem_window() (in sources/*) works in real
meters on a regular grid, not lat/lon — much simpler for both the game
renderer and the adjacency logic the hazard model needs (Phase 2).
"""

import numpy as np
from affine import Affine
from pyproj import Transformer
from rasterio.warp import reproject, Resampling
from scipy.ndimage import uniform_filter, laplace


def reproject_to_grid(dem_window, center_lat, center_lon, radius_m, cell_size_m, utm_epsg):
    """Resample the source DEM window onto a north-up UTM grid centered on
    (center_lat, center_lon), covering [-radius_m, +radius_m] on each axis.
    """
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    center_x, center_y = to_utm.transform(center_lon, center_lat)

    n = int(round((2 * radius_m) / cell_size_m))
    origin_x = center_x - radius_m
    origin_y = center_y + radius_m  # top edge; raster rows go north -> south
    dst_transform = Affine(cell_size_m, 0, origin_x, 0, -cell_size_m, origin_y)

    dst = np.full((n, n), np.nan, dtype=np.float32)
    reproject(
        source=dem_window.array,
        destination=dst,
        src_transform=dem_window.transform,
        src_crs=dem_window.crs,
        dst_transform=dst_transform,
        dst_crs=f"EPSG:{utm_epsg}",
        src_nodata=dem_window.nodata,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    if np.isnan(dst).any():
        raise ValueError(
            "Reprojected grid has NaN cells: the fetched DEM window didn't "
            "fully cover the requested zone radius. Increase the padding in "
            "sources/usgs_3dep._bbox_for_center or shrink the zone radius."
        )

    grid_info = {
        "n": n,
        "cell_size_m": cell_size_m,
        "origin_x": origin_x,
        "origin_y": origin_y,
        "center_x": center_x,
        "center_y": center_y,
        "utm_epsg": utm_epsg,
    }
    return dst.astype(np.float64), dst_transform, grid_info


def latlon_to_grid_rc(lat, lon, grid_info, utm_epsg):
    """Projects a real-world lat/lon (e.g. a named summit or trailhead) into
    fractional (row, col) on the same grid reproject_to_grid() built, so the
    renderer can place a reference-point label without doing its own
    lat/lon -> UTM projection in the browser.
    """
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    x, y = to_utm.transform(lon, lat)
    col = (x - grid_info["origin_x"]) / grid_info["cell_size_m"]
    row = (grid_info["origin_y"] - y) / grid_info["cell_size_m"]
    in_bounds = 0 <= row <= grid_info["n"] - 1 and 0 <= col <= grid_info["n"] - 1
    return {"row": row, "col": col, "in_bounds": in_bounds}


def slope_aspect_horn(elevation, cell_size_m):
    """Horn's algorithm (the standard 3x3-kernel method used by ArcGIS/QGIS
    `gdaldem slope|aspect`). Edge cells are handled by replicating the
    border row/column, which is precise enough here since every zone's DEM
    window has generous pad outside the playable radius already.
    """
    z = np.pad(elevation, 1, mode="edge")
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]

    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell_size_m)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell_size_m)

    slope_deg = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))

    aspect_deg = np.degrees(np.arctan2(dzdy, -dzdx))
    aspect_deg = np.where(
        aspect_deg < 0,
        90.0 - aspect_deg,
        np.where(aspect_deg > 90.0, 360.0 - aspect_deg + 90.0, 90.0 - aspect_deg),
    )
    # Flat ground: aspect is undefined. Keep it numeric (0/North) for a
    # clean int grid, but zero out via slope elsewhere before it matters.
    aspect_deg = np.where(slope_deg < 0.5, 0.0, aspect_deg)

    return slope_deg, aspect_deg % 360.0


def detect_curvature_traps(elevation, slope_deg, cell_size_m,
                            smooth_radius_m=40, concavity_threshold=0.02,
                            slope_threshold_deg=25):
    """Flag terrain-trap cells (gullies, couloirs, confined concave
    features) from DEM curvature. Positive Laplacian of a smoothed
    elevation surface means the cross-section curves upward around this
    cell — i.e. it's lower than its surroundings in a channelized way,
    which on steep ground is exactly what a couloir/gully cross-section
    looks like. Combined with a slope floor so open, gently concave valley
    floors don't get flagged.

    Returns a uint8 grid: 0 = open, 1 = DEM-derived trap candidate.
    Zone-specific `manual_traps` (named, hand-placed features) are merged
    in separately by export_zone.py, with their own severity level.
    """
    smooth_cells = max(3, int(round(smooth_radius_m / cell_size_m)) | 1)
    smoothed = uniform_filter(elevation, size=smooth_cells, mode="nearest")
    curvature = laplace(smoothed, mode="nearest") / (cell_size_m ** 2)

    trap = np.zeros(elevation.shape, dtype=np.uint8)
    trap[(curvature > concavity_threshold) & (slope_deg > slope_threshold_deg)] = 1
    return trap, curvature


def apply_manual_traps(trap_grid, grid_info, manual_traps, utm_epsg):
    """Stamp hand-flagged named features (e.g. a known couloir) into the
    trap grid at higher severity than DEM-derived detection, since these
    are ground-truthed rather than inferred.
    """
    if not manual_traps:
        return trap_grid

    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    n = grid_info["n"]
    cs = grid_info["cell_size_m"]
    ox, oy = grid_info["origin_x"], grid_info["origin_y"]

    cols = ox + (np.arange(n) + 0.5) * cs
    rows = oy - (np.arange(n) + 0.5) * cs
    grid_x, grid_y = np.meshgrid(cols, rows)

    for feat in manual_traps:
        fx, fy = to_utm.transform(feat["lon"], feat["lat"])
        dist = np.hypot(grid_x - fx, grid_y - fy)
        mask = dist <= feat["radius_m"]
        trap_grid[mask] = np.maximum(trap_grid[mask], feat.get("severity", 2))

    return trap_grid
