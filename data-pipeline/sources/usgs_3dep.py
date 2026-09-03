"""USGS 3DEP elevation source — no API key required.

Pulls from the public S3 bucket that backs the National Map's staged
products (the same bucket rockyweb.usgs.gov and the TNM download page point
at). We open GeoTIFFs directly over HTTPS with GDAL's /vsicurl/ driver,
which does ranged HTTP reads, so we only pull the bytes covering our window
instead of downloading a ~400MB whole-degree tile per zone.

This module and sources/opentopography.py both expose the same
`fetch_dem_window(center_lat, center_lon, radius_m) -> DemWindow` signature
so export_zone.py can swap sources without touching the rest of the
pipeline. USGS is the default/primary; OpenTopography is a stub for when an
API key is available.

Tried and confirmed working from this environment on 2026-09-03:
  https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w112/USGS_13_n41w112.tif
The dynamic REST/WCS endpoints under elevation.nationalmap.gov and
tnmaccess.nationalmap.gov were NOT reachable from this environment (egress
policy blocked them outright, not a USGS-side issue) — if you're running
this pipeline somewhere those are reachable, they'd work too, but S3 is
the only path this was actually verified against.
"""

import math
from dataclasses import dataclass

import rasterio
from rasterio.merge import merge

S3_BASE = "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current"

# ~1/3 arc-second seamless DEM, NAD83 (EPSG:4269), meters.
SOURCE_CRS = "EPSG:4269"


@dataclass
class DemWindow:
    array: "object"          # 2D numpy array, elevation in meters
    transform: "object"      # affine transform, in SOURCE_CRS units (degrees)
    crs: str
    nodata: float


def _tiles_for_bbox(min_lat, max_lat, min_lon, max_lon):
    """1x1 degree tile names (e.g. 'n41w112') covering a lat/lon bbox."""
    s0, s1 = math.floor(min_lat), math.floor(max_lat)
    w0, w1 = math.floor(min_lon), math.floor(max_lon)
    tiles = []
    for s in range(s0, s1 + 1):
        for w in range(w0, w1 + 1):
            north = s + 1
            west = abs(w)
            tiles.append(f"n{north}w{west}")
    return tiles


def _tile_url(tile_name):
    return f"/vsicurl/{S3_BASE}/{tile_name}/USGS_13_{tile_name}.tif"


def _bbox_for_center(center_lat, center_lon, radius_m):
    # Generous padding: resampling/reprojection downstream needs a little
    # margin outside the exact target radius so edge cells aren't starved.
    pad_m = radius_m * 1.2
    dlat = pad_m / 111_320.0
    dlon = pad_m / (111_320.0 * math.cos(math.radians(center_lat)))
    return (
        center_lat - dlat, center_lat + dlat,
        center_lon - dlon, center_lon + dlon,
    )


def fetch_dem_window(center_lat, center_lon, radius_m) -> DemWindow:
    min_lat, max_lat, min_lon, max_lon = _bbox_for_center(center_lat, center_lon, radius_m)
    tiles = _tiles_for_bbox(min_lat, max_lat, min_lon, max_lon)

    datasets = []
    try:
        for tile in tiles:
            url = _tile_url(tile)
            ds = rasterio.open(url)
            datasets.append(ds)

        array, transform = merge(
            datasets,
            bounds=(min_lon, min_lat, max_lon, max_lat),
        )
        nodata = datasets[0].nodata
    finally:
        for ds in datasets:
            ds.close()

    return DemWindow(array=array[0], transform=transform, crs=SOURCE_CRS, nodata=nodata)
