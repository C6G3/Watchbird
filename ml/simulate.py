"""Simulated livestock tracks: the target domain for benchmarking.

Real farm-animal data with labelled incidents doesn't exist for Watchbird yet,
and the gull tracks behave very differently from cattle or goats. This
generates herds whose *normal* day looks like East African smallholder
grazing: rest at the boma at night, walk out at dawn to one of several
pastures, graze slowly, walk home at dusk. GPS noise and dropped fixes are
included. Anomalies are injected separately by ml/inject.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

M_PER_DEG = 111_320.0
FARMS = [(-0.3981, 36.9616), (-0.3262, 36.9011)]  # Kiganjo, Mweiga


def _animal(rng, name, farm, boma_m, pastures_m, days, dt):
    lat0, lon0 = farm
    t = pd.date_range("2025-01-01", periods=days * 86400 // dt, freq=f"{dt}s", tz="UTC")
    solar = ((t.hour + t.minute / 60).to_numpy() + lon0 / 15) % 24
    pos = np.array(boma_m, float) + rng.normal(0, 15, 2)
    personal = rng.normal(0, 20, 2)  # where this animal lies down in the boma
    out = np.zeros((len(t), 2))
    pasture = pastures_m[0]
    heading = rng.uniform(0, 2 * np.pi)
    for i, h in enumerate(solar):
        if i % (86400 // dt) == 0:
            pasture = pastures_m[rng.integers(len(pastures_m))]
        if h < 6.5 or h >= 19:
            target, speed = np.array(boma_m) + personal, 0.9
        elif h < 8 or h >= 17:
            target, speed = (pasture if h < 12 else np.array(boma_m) + personal), rng.uniform(0.7, 1.1)
        else:
            heading += rng.normal(0, 0.8)
            graze = rng.uniform(0.03, 0.25) * dt
            pull = (np.array(pasture) - pos) * 0.15
            pos = pos + graze * np.array([np.cos(heading), np.sin(heading)]) + pull
            out[i] = pos
            continue
        gap = target - pos
        dist = np.linalg.norm(gap)
        pos = pos + (gap / dist * min(dist, speed * dt) if dist > 1 else 0)
        out[i] = pos
    out += rng.normal(0, 4, out.shape)  # GPS noise
    df = pd.DataFrame({
        "Device_id": name,
        "Timestamp": t,
        "Latitude": lat0 + out[:, 0] / M_PER_DEG,
        "Longitude": lon0 + out[:, 1] / (M_PER_DEG * np.cos(np.radians(lat0))),
        "Altitude": 1800 + rng.normal(0, 3, len(t)),
    })
    return df[rng.random(len(df)) > 0.02].reset_index(drop=True)  # ~2% of fixes lost


def herd(animals_per_farm: int = 3, days: int = 40, dt: int = 900, seed: int = 7) -> list[pd.DataFrame]:
    rng = np.random.default_rng(seed)
    tracks = []
    for f, farm in enumerate(FARMS):
        boma = rng.normal(0, 100, 2)
        pastures = [boma + rng.uniform(600, 1800) * np.array([np.cos(a), np.sin(a)]) for a in rng.uniform(0, 2 * np.pi, 4)]
        for a in range(animals_per_farm):
            tracks.append(_animal(rng, f"cow_{f}{a}", farm, boma, pastures, days, dt))
    return tracks
