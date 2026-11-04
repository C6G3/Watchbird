"""Feature engineering for movement anomalies (v2).

Every feature uses only the current fix and earlier ones (trailing windows),
so a fix scored live gets the same value it would get in training.

Most features are *relative to the device's own recent behaviour* (its rolling
home position, typical speed, typical range). That makes one model usable
across species: a goat and a gull have very different absolute speeds, but
"5x faster than usual" or "3x further from home than usual" mean the same.

Input columns (the legacy "Data" names): Device_id, Timestamp, Latitude,
Longitude, Altitude (optional). Output: the same rows, sorted by device and
time, with FEATURES added.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

EARTH_M = 6_371_000.0
HOME_WINDOW = 96  # fixes used for the rolling "usual position" (24 h at 15 min)
SHORT = 5  # short window for local motion statistics
STILL_WINDOW = 8  # window for "has it stopped moving" checks
CELL_M = 250  # grid size for "has it been here before"
FAMILIAR_DAYS = 7  # how far back "familiar" looks
FAMILIAR_GAP_S = 2 * 3600  # ignore the last 2 h, or every place looks familiar
HOUR_WINDOW = 30  # same-hour fixes used for "typical speed at this hour"

FEATURES = [
    "log_speed",  # how fast, absolute
    "log_speed_rel",  # how fast vs the device's recent typical speed
    "accel",  # change in speed per second
    "turn",  # sharpness of direction change, 0..pi
    "straightness",  # net displacement / path length over the short window
    "log_speed_std",  # jerkiness of speed over the short window
    "log_dist_home",  # metres from the rolling usual position
    "log_novelty",  # metres to the nearest place visited in the past week (high = new ground)
    "log_path_vs_hour",  # distance walked recently vs usual at this hour (low = stopped moving)
    "log_familiar",  # share of last week's fixes spent in this 250 m cell (low = new ground)
    "log_speed_vs_hour",  # speed vs the device's typical speed at this hour (night wandering)
    "log_vspeed",  # vertical speed, |m/s|
    "hour_sin",  # local solar time of day
    "hour_cos",
    "log_dt",  # gap since the previous fix
]


def _haversine(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _bearing(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    return np.arctan2(np.sin(dl) * np.cos(p2), np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl))


def _trailing_median(s: pd.Series, window: int, min_periods: int) -> pd.Series:
    """Median of the previous `window` values, excluding the current one."""
    return s.shift(1).rolling(window, min_periods=min_periods).median()


def _familiarity(lat, lon, secs):
    """log share of the previous FAMILIAR_DAYS (minus the last 2 h) spent in the same grid cell."""
    m_per_deg_lon = 111_320.0 * np.cos(np.radians(np.median(lat)))
    key = np.floor(lat * 111_320.0 / CELL_M).astype(np.int64) * 10_000_019 + np.floor(lon * m_per_deg_lon / CELL_M).astype(np.int64)
    lo_t, hi_t = secs - FAMILIAR_DAYS * 86400, secs - FAMILIAR_GAP_S
    total = np.searchsorted(secs, hi_t, "right") - np.searchsorted(secs, lo_t, "left")
    visits = np.zeros(len(secs))
    for idx in pd.Series(np.arange(len(secs))).groupby(key).indices.values():
        t = secs[idx]
        visits[idx] = np.searchsorted(t, hi_t[idx], "right") - np.searchsorted(t, lo_t[idx], "left")
    return np.log1p(visits) - np.log1p(np.maximum(total, 0))


def _novelty(lat, lon, secs, k: int = 64):
    """Metres to the nearest fix from the previous FAMILIAR_DAYS, ignoring the last 2 h.

    Looks at the k spatially nearest fixes and takes the closest one inside the
    time window. If none of them qualify (the area is only visited "right now"),
    the k-th neighbour's distance is used: a lower bound that keeps dense,
    just-arrived-at spots from looking novel.
    """
    from sklearn.neighbors import BallTree

    pts = np.radians(np.c_[lat, lon])
    k = min(k, len(pts))
    dist, idx = BallTree(pts, metric="haversine").query(pts, k=k)
    dist *= EARTH_M
    t = secs[idx]
    ok = (t >= secs[:, None] - FAMILIAR_DAYS * 86400) & (t <= secs[:, None] - FAMILIAR_GAP_S)
    return np.where(ok.any(axis=1), dist[np.arange(len(pts)), ok.argmax(axis=1)], dist[:, -1])


def _device_features(g: pd.DataFrame) -> pd.DataFrame:
    g = g.sort_values("Timestamp").copy()
    lat, lon = g["Latitude"].to_numpy(float), g["Longitude"].to_numpy(float)
    t = g["Timestamp"]

    dt = t.diff().dt.total_seconds().to_numpy()
    dt[0] = np.nanmedian(dt[1:]) if len(dt) > 1 else 60.0
    dt = np.clip(np.nan_to_num(dt, nan=60.0), 1.0, None)

    step = np.zeros(len(g))
    step[1:] = _haversine(lat[:-1], lon[:-1], lat[1:], lon[1:])
    speed = step / dt

    bearing = np.zeros(len(g))
    bearing[1:] = _bearing(lat[:-1], lon[:-1], lat[1:], lon[1:])
    turn = np.abs(np.angle(np.exp(1j * np.diff(bearing, prepend=bearing[0]))))
    turn[step < 5] = 0.0  # GPS jitter while standing still isn't turning

    s_speed = pd.Series(speed, index=g.index)
    s_step = pd.Series(step, index=g.index)
    typical_speed = _trailing_median(s_speed, HOME_WINDOW, 5).fillna(s_speed.expanding().median())

    # Net displacement over the short window vs distance actually walked.
    lat_back = g["Latitude"].shift(SHORT).fillna(g["Latitude"].iloc[0]).to_numpy()
    lon_back = g["Longitude"].shift(SHORT).fillna(g["Longitude"].iloc[0]).to_numpy()
    net = _haversine(lat_back, lon_back, lat, lon)
    path = s_step.rolling(SHORT, min_periods=1).sum().to_numpy()
    straightness = np.where(path > 1, net / np.maximum(path, 1), 0.0)

    # Rolling usual position and how far the device is from it.
    home_lat = _trailing_median(g["Latitude"], HOME_WINDOW, 10).fillna(g["Latitude"].expanding().median())
    home_lon = _trailing_median(g["Longitude"], HOME_WINDOW, 10).fillna(g["Longitude"].expanding().median())
    dist_home = _haversine(home_lat.to_numpy(), home_lon.to_numpy(), lat, lon)
    s_home = pd.Series(dist_home, index=g.index)
    usual_home = _trailing_median(s_home, HOME_WINDOW, 10).fillna(s_home.expanding().median())

    path_still = s_step.rolling(STILL_WINDOW, min_periods=1).sum()
    usual_path = _trailing_median(path_still, HOME_WINDOW, 10).fillna(path_still.expanding().median())

    if "Altitude" in g and g["Altitude"].notna().any():
        alt = g["Altitude"].astype(float).interpolate().bfill().ffill().to_numpy()
        vspeed = np.abs(np.diff(alt, prepend=alt[0])) / dt
    else:
        vspeed = np.zeros(len(g))

    # Solar time from longitude, so night means night anywhere on Earth.
    utc_hours = (t.dt.hour + t.dt.minute / 60).to_numpy()
    solar = (utc_hours + lon / 15.0) % 24
    angle = 2 * np.pi * solar / 24

    def by_hour(s: pd.Series) -> pd.Series:
        """Trailing median of `s` over earlier fixes taken at the same solar hour."""
        return s.groupby(np.floor(solar).astype(int)).transform(
            lambda x: x.shift(1).rolling(HOUR_WINDOW, min_periods=3).median()
        )

    hour_typical = by_hour(s_speed).fillna(typical_speed)
    hour_path = by_hour(path_still).fillna(usual_path)
    secs = (t.astype("int64") // 1_000_000_000).to_numpy()

    g["speed_m_s"] = speed
    g["log_speed"] = np.log1p(speed)
    g["log_speed_rel"] = np.log1p(speed / (typical_speed.to_numpy() + 0.05))
    g["accel"] = np.diff(speed, prepend=speed[0]) / dt
    g["turn"] = turn
    g["straightness"] = straightness
    g["log_speed_std"] = np.log1p(s_speed.rolling(SHORT, min_periods=1).std().fillna(0).to_numpy())
    g["log_dist_home"] = np.log1p(dist_home)
    g["log_novelty"] = np.log1p(_novelty(lat, lon, secs))
    g["log_path_vs_hour"] = np.log1p(path_still.to_numpy()) - np.log1p(hour_path.to_numpy())
    g["log_familiar"] = _familiarity(lat, lon, secs)
    g["log_speed_vs_hour"] = np.log1p(speed / (hour_typical.to_numpy() + 0.05))
    g["log_vspeed"] = np.log1p(vspeed)
    g["hour_sin"] = np.sin(angle)
    g["hour_cos"] = np.cos(angle)
    g["log_dt"] = np.log(dt)
    return g


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add FEATURES to a frame of fixes from one or more devices."""
    df = df.copy()
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], utc=True, format="ISO8601")
    df = df.dropna(subset=["Latitude", "Longitude", "Timestamp"])
    df = df[(df["Latitude"].abs() <= 90) & (df["Longitude"].abs() <= 180)]
    out = pd.concat([_device_features(g) for _, g in df.groupby("Device_id", sort=False)], ignore_index=True)
    out[FEATURES] = out[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return out.sort_values(["Device_id", "Timestamp"]).reset_index(drop=True)
