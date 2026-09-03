"""OpenTopography elevation source — stub, not wired up yet.

Same interface as sources/usgs_3dep.fetch_dem_window so export_zone.py can
switch sources with a one-line change once an API key exists. OpenTopography
serves 3DEP (and other) DEMs through a REST "globaldem" endpoint that wants
a bbox + an API key:

    https://portal.opentopography.org/API/globaldem
        ?demtype=USGS30m (or USGS10m)
        &south=...&north=...&west=...&east=...
        &outputFormat=GTiff
        &API_Key=...

Not implemented: this environment's egress policy also blocks
opentopography.org outright, so there's nothing to verify against yet.
Wire this up when a key is available and opentopography.org is reachable.
"""

from .usgs_3dep import DemWindow  # re-export the shared return type


def fetch_dem_window(center_lat, center_lon, radius_m, api_key=None) -> DemWindow:
    raise NotImplementedError(
        "OpenTopography source is not wired up yet — needs an API key and a "
        "reachable network path to opentopography.org. Use sources.usgs_3dep "
        "(the default) until then."
    )
