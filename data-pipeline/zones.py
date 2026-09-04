"""Zone registry: real-world locations the data pipeline can build a game zone from.

Each zone is a dict describing where to center the DEM pull, how large a
window to grab, which local UTM zone to project into for a flat meter grid,
and a handful of known reference facts used to sanity-check the pulled data
(export_zone.py prints these against what it actually computed).

`manual_traps` are hand-flagged terrain-trap features (named couloirs, cliff
bands) given as lat/lon points with a radius in meters. They get merged with
the DEM-curvature-derived trap flags in terrain_processing.py, because a
90m-wide feature like a couloir can be there in the data but not always pop
cleanly out of a curvature filter at 10m grid resolution.
"""

ZONES = {
    "mt_superior": {
        "name": "Mt Superior",
        "center_lat": 40.5721,
        "center_lon": -111.6142,
        "radius_m": 1300,
        "utm_epsg": 32612,  # UTM zone 12N
        "cell_size_m": 10,
        "trailhead": {"lat": 40.5657, "lon": -111.6172, "name": "Cardiff Fork / S-curve, LCC"},
        # Real Wasatch treeline bands, used to look up the UAC danger rose
        # (which is published per elevation band, not per raw elevation).
        # Typical published Central Wasatch cutoffs - not surveyed per zone.
        "elevation_bands_ft": {"below_treeline_max": 8700, "near_treeline_max": 9500},
        "reference": {
            "summit_elevation_ft": 11132,
            "summit_lat": 40.5721,
            "summit_lon": -111.6142,
            "south_face_slope_deg_range": [30, 40],
            "note": "Classic Wasatch prize line: broad south-facing bowl off the summit "
                    "ridge, steep north-facing terrain into Cardiff/Days Fork on the far side.",
        },
        "manual_traps": [
            # Suicide Chute: narrow, sustained, cliff-bound couloir dropping
            # skier's-left off the Superior summit ridge toward the highway.
            # Approximate centerline; exact placement is a best estimate, not surveyed.
            {"lat": 40.5726, "lon": -111.6156, "radius_m": 90, "severity": 2, "label": "Suicide Chute (approx.)"},
        ],
    },
    "wolverine_cirque": {
        "name": "Wolverine Cirque",
        "center_lat": 40.5875,
        "center_lon": -111.6280,
        "radius_m": 900,
        "utm_epsg": 32612,
        "cell_size_m": 10,
        "trailhead": {"lat": 40.5989, "lon": -111.6437, "name": "Days Fork TH, BCC"},
        "elevation_bands_ft": {"below_treeline_max": 8700, "near_treeline_max": 9500},
        "reference": {
            # Coordinates for this zone are a best estimate (upper Days Fork /
            "summit_elevation_ft": None,
            "note": "Coordinates are an approximate placement of the cirque in the upper "
                    "Days Fork drainage, not a surveyed pin — treat reference elevation "
                    "as whatever the real DEM returns, and confirm against a map before "
                    "treating this zone's summit stats as load-bearing the way mt_superior's are.",
        },
        "manual_traps": [],
    },
}


def get_zone(zone_id):
    if zone_id not in ZONES:
        raise KeyError(f"Unknown zone '{zone_id}'. Known zones: {list(ZONES)}")
    return {"id": zone_id, **ZONES[zone_id]}
