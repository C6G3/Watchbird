"""The production anomaly model: features -> detector -> threshold -> events.

    model = WatchbirdModel("gaussian_mixture").fit(fixes_df)
    out = model.predict(fixes_df)   # adds anomaly_score and Anomaly (1 / -1)
    model.save("models/cattle_v2.joblib")

The threshold is calibrated on the training data: a fix is flagged when its
score is above the `quantile` of training scores. Flags then go through the
same event filter the web app uses (web/src/lib/geo.ts): flagged fixes less
than EVENT_GAP_S apart form an event, and events shorter than MIN_EVENT_SIZE
are discarded as GPS noise.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from ml.detectors import make
from ml.features import FEATURES, build_features

VERSION = 2
EVENT_GAP_S = 900
MIN_EVENT_SIZE = 2


def event_filter(df: pd.DataFrame, flags: np.ndarray) -> np.ndarray:
    """Keep only flags that belong to an event of >= MIN_EVENT_SIZE fixes. df sorted by device, time."""
    keep = np.zeros(len(df), dtype=bool)
    ts = df["Timestamp"].astype("int64").to_numpy() // 1_000_000_000
    dev = df["Device_id"].to_numpy()
    run: list[int] = []

    def close():
        if len(run) >= MIN_EVENT_SIZE:
            keep[run] = True

    for i in np.flatnonzero(flags):
        if run and (dev[i] != dev[run[-1]] or ts[i] - ts[run[-1]] > EVENT_GAP_S):
            close()
            run = []
        run.append(i)
    close()
    return keep


class WatchbirdModel:
    def __init__(self, detector: str = "gaussian_mixture", quantile: float = 0.99, **params):
        self.detector_name = detector
        self.quantile = quantile
        self.params = params
        self.meta: dict = {}

    def fit(self, fixes: pd.DataFrame) -> "WatchbirdModel":
        df = build_features(fixes)
        X = df[FEATURES].to_numpy()
        self.detector = make(self.detector_name, **self.params).fit(X)
        scores = self.detector.score(X)
        self.threshold = float(np.quantile(scores, self.quantile))
        flagged = event_filter(df, scores > self.threshold)
        self.meta = {
            "version": VERSION,
            "detector": self.detector.name,
            "params": self.params,
            "quantile": self.quantile,
            "features": FEATURES,
            "samples": int(len(df)),
            "devices": sorted(map(str, df["Device_id"].unique())),
            "anomaly_rate": float(flagged.mean()),
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }
        return self

    def predict(self, fixes: pd.DataFrame) -> pd.DataFrame:
        """Feature frame with anomaly_score and Anomaly (-1 anomaly, 1 normal) added."""
        df = build_features(fixes)
        scores = self.detector.score(df[FEATURES].to_numpy())
        df["anomaly_score"] = scores
        df["Anomaly"] = np.where(event_filter(df, scores > self.threshold), -1, 1)
        return df

    def save(self, path: str | Path):
        joblib.dump(self, path)

    @staticmethod
    def load(path: str | Path) -> "WatchbirdModel":
        model = joblib.load(path)
        if not isinstance(model, WatchbirdModel):
            raise TypeError(f"{path} is not a WatchbirdModel")
        return model
