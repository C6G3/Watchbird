"""Plant realistic farm anomalies into clean tracks, for benchmarking only.

There are no labelled anomalies in Watchbird's data, so models are compared on
copies of real tracks with known anomalies injected. Each kind mirrors
something a farmer cares about:

    stray      walks off well beyond its usual range (lost, straying, theft on foot)
    transport  moves in a straight line at vehicle speed (theft by truck, chased)
    stall      stops moving for hours when it was travelling (sick, stuck, dead, tag dropped)
    night      wanders at night when it is normally still (disturbed by predators, people)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ml.features import build_features

KINDS = ("stray", "transport", "stall", "night")
LENGTH = {"stray": 8, "transport": 6, "stall": 16, "night": 8}
M_PER_DEG = 111_320.0


def _offset(lat, lon, north_m, east_m):
    return lat + north_m / M_PER_DEG, lon + east_m / (M_PER_DEG * np.cos(np.radians(lat)))


def inject(track: pd.DataFrame, per_kind: int, rng: np.random.Generator) -> tuple[pd.DataFrame, list[dict]]:
    """track: one device, sorted by time. Returns (copy with `label` 0/1, list of segments)."""
    df = track.sort_values("Timestamp").reset_index(drop=True).copy()
    df["label"] = 0
    feats = build_features(df)
    usual = float(np.median(np.expm1(feats["log_dist_home"])))  # typical metres from home
    step = np.expm1(feats["log_speed"]).to_numpy() * np.exp(feats["log_dt"]).to_numpy()
    solar = (np.degrees(np.arctan2(feats["hour_sin"], feats["hour_cos"])) / 15) % 24
    taken = np.zeros(len(df), dtype=bool)
    segments = []

    def free(start, n, margin=30):
        return not taken[max(0, start - margin) : start + n + margin].any()

    for kind in KINDS:
        n = LENGTH[kind]
        placed, tries = 0, 0
        while placed < per_kind and tries < 4000:
            tries += 1
            s = int(rng.integers(120, len(df) - n - 2))
            if not free(s, n):
                continue
            seg = np.arange(s, s + n)
            moved = step[seg].sum()
            if kind == "stall" and moved < 2000:  # must have been travelling
                continue
            if kind == "night" and (not np.all((solar[seg] >= 0) & (solar[seg] <= 4)) or moved > 300):
                continue  # must be night and normally still
            lat0, lon0 = df.at[s, "Latitude"], df.at[s, "Longitude"]
            angle = rng.uniform(0, 2 * np.pi)
            secs = (df.loc[seg, "Timestamp"] - df.at[s, "Timestamp"]).dt.total_seconds().to_numpy()
            if kind == "stray":
                dist = float(np.clip(6 * usual, 800, 20_000))
                ramp = np.minimum(1.0, (np.arange(n) + 1) / 3)
                lat, lon = _offset(df.loc[seg, "Latitude"].to_numpy(), df.loc[seg, "Longitude"].to_numpy(),
                                   np.cos(angle) * dist * ramp, np.sin(angle) * dist * ramp)
            elif kind == "transport":
                v = rng.uniform(12, 20)
                lat, lon = _offset(np.full(n, lat0), np.full(n, lon0), np.cos(angle) * v * secs, np.sin(angle) * v * secs)
                seg = np.append(seg, s + n)  # the jump back to the real track is part of it
                lat, lon = np.append(lat, df.at[s + n, "Latitude"]), np.append(lon, df.at[s + n, "Longitude"])
            elif kind == "stall":
                lat, lon = _offset(np.full(n, lat0), np.full(n, lon0), rng.normal(0, 3, n), rng.normal(0, 3, n))
            else:  # night: a slow random walk where it normally rests
                v = rng.uniform(0.8, 2.0)
                legs = v * np.diff(secs, prepend=0.0)
                heading = angle + np.cumsum(rng.normal(0, 0.6, n))
                north, east = np.cumsum(legs * np.cos(heading)), np.cumsum(legs * np.sin(heading))
                lat, lon = _offset(np.full(n, lat0), np.full(n, lon0), north, east)
            df.loc[seg, "Latitude"], df.loc[seg, "Longitude"] = lat, lon
            df.loc[seg, "label"] = 1
            taken[seg] = True
            segments.append({"kind": kind, "rows": seg, "device": df.at[s, "Device_id"]})
            placed += 1
    return df, segments
