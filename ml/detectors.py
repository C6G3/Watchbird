"""Unsupervised anomaly detectors behind one interface.

Each detector: fit(X) on (mostly) normal feature rows, score(X) -> array where
HIGHER means MORE anomalous. Inputs are rank-gaussianised first so features
on very different scales (m/s, metres, radians) weigh in fairly.
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.mixture import GaussianMixture
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import QuantileTransformer

SEED = 42


class Detector:
    name = "base"

    def __init__(self, **params):
        self.params = params

    def _prep_fit(self, X):
        self.qt = QuantileTransformer(output_distribution="normal", n_quantiles=min(1000, len(X)), random_state=SEED)
        return self.qt.fit_transform(X)

    def _prep(self, X):
        return self.qt.transform(X)

    def fit(self, X):  # pragma: no cover - interface
        raise NotImplementedError

    def score(self, X):  # pragma: no cover - interface
        raise NotImplementedError


class IForest(Detector):
    name = "isolation_forest"

    def fit(self, X):
        p = {"n_estimators": 300, "max_samples": 512, "max_features": 1.0} | self.params
        self.model = IsolationForest(random_state=SEED, n_jobs=-1, **p).fit(self._prep_fit(X))
        return self

    def score(self, X):
        return -self.model.score_samples(self._prep(X))


class LOF(Detector):
    name = "local_outlier_factor"
    MAX_TRAIN = 15_000  # LOF memory/time grows fast; a sample describes "normal" well enough

    def fit(self, X):
        Z = self._prep_fit(X)
        if len(Z) > self.MAX_TRAIN:
            Z = Z[np.random.default_rng(SEED).choice(len(Z), self.MAX_TRAIN, replace=False)]
        p = {"n_neighbors": 50} | self.params
        self.model = LocalOutlierFactor(novelty=True, n_jobs=-1, **p).fit(Z)
        return self

    def score(self, X):
        return -self.model.score_samples(self._prep(X))


class GMM(Detector):
    name = "gaussian_mixture"

    def fit(self, X):
        p = {"n_components": 8, "covariance_type": "full"} | self.params
        self.model = GaussianMixture(random_state=SEED, reg_covar=1e-4, **p).fit(self._prep_fit(X))
        return self

    def score(self, X):
        return -self.model.score_samples(self._prep(X))


class RobustZ(Detector):
    """Rule-of-thumb baseline: mean of the 3 largest per-feature |z| values."""

    name = "robust_z"

    def fit(self, X):
        Z = self._prep_fit(X)
        self.med = np.median(Z, axis=0)
        self.mad = np.median(np.abs(Z - self.med), axis=0) + 1e-6
        return self

    def score(self, X):
        z = np.abs((self._prep(X) - self.med) / self.mad)
        return np.sort(z, axis=1)[:, -3:].mean(axis=1)


class Ensemble(Detector):
    """Average of member scores, each turned into its percentile within training scores."""

    name = "ensemble"

    def __init__(self, members: list[Detector]):
        super().__init__()
        self.members = members
        self.name = "ensemble(" + "+".join(m.name for m in members) + ")"

    def fit(self, X):
        self.ref = []
        for m in self.members:
            m.fit(X)
            self.ref.append(np.sort(m.score(X)))
        return self

    def score(self, X):
        pct = [np.searchsorted(ref, m.score(X)) / len(ref) for m, ref in zip(self.members, self.ref)]
        return np.mean(pct, axis=0)


def make(name: str, **params) -> Detector:
    if name == "ensemble":
        return Ensemble([IForest(**params.get("iforest", {})), GMM(**params.get("gmm", {})), LOF(**params.get("lof", {}))])
    return {"isolation_forest": IForest, "local_outlier_factor": LOF, "gaussian_mixture": GMM, "robust_z": RobustZ}[name](**params)
