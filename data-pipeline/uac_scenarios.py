#!/usr/bin/env python3
"""Cached historical Utah Avalanche Center forecast scenarios.

avalanche.org / utahavalanchecenter.org are unreachable from this pipeline's
network environment (egress policy blocks them outright — confirmed 2026-09-03,
not a UAC-side outage), so these are NOT scraped from a live endpoint. They're
hand-built from real, publicly documented forecast days, with a `confidence`
field being honest about how each one was sourced:

  - "high": built from widely-reported specifics of a real, well-documented
    avalanche event (the danger rose matches the public accounting of that
    day's conditions/problem type, even though the literal archived UAC page
    wasn't fetched here).
  - "illustrative": built from a general pattern the user pointed at (a
    real phenomenon on a real date) but without being able to verify exact
    per-aspect numbers against the source. Treat these numbers as
    representative, not archival.
  - "synthetic-baseline": not tied to a specific date at all - a plausible
    "quiet day" composite, included so the scenario picker has contrast
    against the high-danger days above.

Danger rose format matches avalanche.org's standard: 3 elevation bands
(above_treeline / near_treeline / below_treeline) x 8 compass aspects,
rating 1-5 (Low, Moderate, Considerable, High, Extreme).

Swap in scripts/fetch_uac_live.py (not built yet - see project notes) if
avalanche.org ever becomes reachable and you want to pull real current or
archived forecasts instead of/in addition to these.
"""

import json
import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "public" / "data" / "forecasts"

ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
RATING_NAMES = {1: "Low", 2: "Moderate", 3: "Considerable", 4: "High", 5: "Extreme"}


def rose(vals):
    """vals: dict of aspect -> rating for one elevation band."""
    assert set(vals) == set(ASPECTS), f"missing aspects: {set(ASPECTS) - set(vals)}"
    return vals


SCENARIOS = [
    {
        "scenario_id": "2021-02-06-persistent-slab",
        "date": "2021-02-06",
        "region": "Salt Lake / Central Wasatch",
        "title": "Feb 6, 2021 — Considerable, persistent slab",
        "primary_problem": "persistent slab (early-season facet layer)",
        "confidence": "high",
        "source": "Reconstructed from the widely-published UAC accident investigation "
                   "and news coverage of the Wilson Glade avalanche this day (Millcreek "
                   "Canyon): 4 backcountry skiers caught and killed after remote-triggering "
                   "a slope from a lower-angle bench connected to steeper terrain above — "
                   "the textbook real-world case for this game's remote-trigger mechanic. "
                   "Per-aspect numbers below are a reconstruction consistent with the "
                   "reported Considerable rating and broad persistent-slab distribution, "
                   "not a pixel-for-pixel copy of the archived forecast page (unreachable "
                   "from this pipeline's network).",
        "danger_rose": {
            "above_treeline": rose({"N": 3, "NE": 3, "E": 3, "SE": 3, "S": 3, "SW": 3, "W": 3, "NW": 3}),
            "near_treeline": rose({"N": 3, "NE": 3, "E": 3, "SE": 2, "S": 2, "SW": 2, "W": 2, "NW": 3}),
            "below_treeline": rose({"N": 2, "NE": 2, "E": 2, "SE": 1, "S": 1, "SW": 1, "W": 2, "NW": 2}),
        },
        "notes": "Considerable danger doesn't mean 'obviously dangerous' — that's the "
                 "point of this scenario. Low-angle, innocuous-looking terrain connected "
                 "to steeper slopes above was enough.",
    },
    {
        "scenario_id": "2023-02-07-wind-loaded-south",
        "date": "2023-02-07",
        "region": "Salt Lake / Little Cottonwood Canyon",
        "title": "Feb 7, 2023 — wind-loaded south aspects",
        "primary_problem": "wind slab",
        "confidence": "illustrative",
        "source": "Based on a real UAC field observation referenced by the project owner "
                   "describing wind-loading concentrated on south-facing terrain this day. "
                   "Exact per-aspect/elevation numbers weren't verifiable against the "
                   "archived forecast from this environment (avalanche.org unreachable) - "
                   "treat this scenario's ratings as representative of that wind-loading "
                   "pattern, not an archival-accuracy copy.",
        "danger_rose": {
            "above_treeline": rose({"N": 2, "NE": 2, "E": 2, "SE": 3, "S": 4, "SW": 4, "W": 3, "NW": 2}),
            "near_treeline": rose({"N": 2, "NE": 2, "E": 2, "SE": 3, "S": 3, "SW": 3, "W": 2, "NW": 2}),
            "below_treeline": rose({"N": 1, "NE": 1, "E": 1, "SE": 2, "S": 2, "SW": 2, "W": 1, "NW": 1}),
        },
        "notes": "Good scenario for teaching aspect-hopping: the same run can cross from "
                 "High danger to Moderate danger just by favoring shaded aspects over the "
                 "wind-loaded south-facing ones.",
    },
    {
        "scenario_id": "baseline-favorable",
        "date": None,
        "region": "Salt Lake / Central Wasatch",
        "title": "Composite favorable day — Moderate",
        "primary_problem": "isolated wind slab, generally stabilizing snowpack",
        "confidence": "synthetic-baseline",
        "source": "Not tied to a specific date — a plausible 'quiet' day composite so the "
                   "scenario picker has a low-danger option to contrast against the two "
                   "historical high-danger days above.",
        "danger_rose": {
            "above_treeline": rose({"N": 2, "NE": 2, "E": 2, "SE": 2, "S": 2, "SW": 2, "W": 2, "NW": 2}),
            "near_treeline": rose({"N": 2, "NE": 1, "E": 1, "SE": 1, "S": 1, "SW": 1, "W": 1, "NW": 2}),
            "below_treeline": rose({"N": 1, "NE": 1, "E": 1, "SE": 1, "S": 1, "SW": 1, "W": 1, "NW": 1}),
        },
        "notes": "Even on a favorable day, above-treeline terrain carries Moderate danger "
                 "— there's rarely a truly zero-risk day in the alpine.",
    },
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for scenario in SCENARIOS:
        out_path = OUT_DIR / f"{scenario['scenario_id']}.json"
        with open(out_path, "w") as f:
            json.dump(scenario, f, indent=2)
        print(f"Wrote {out_path.relative_to(REPO_ROOT)}  [{scenario['confidence']}]")
        index.append({
            "scenario_id": scenario["scenario_id"],
            "date": scenario["date"],
            "title": scenario["title"],
            "confidence": scenario["confidence"],
        })

    index_path = OUT_DIR / "index.json"
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
    print(f"Wrote {index_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
