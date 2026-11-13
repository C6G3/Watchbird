"""Compare anomaly models on real tracks with planted anomalies.

    python -m ml.benchmark            # full run, writes docs/ML_BENCHMARK.md
    python -m ml.benchmark --quick    # one seed, fewer configs, for a smoke test

Two data sets, reported separately and averaged for the decision:
    livestock  simulated herds (ml/simulate.py), the target use case
    gulls      dataset/bird_tracking.csv, ~62k real GPS fixes (a hard, wide-ranging proxy)
Each track is split in time: the first 60% trains the model, the last 40% gets
anomalies injected (ml/inject.py) and is scored.

Reported per configuration:
    AP           average precision over fixes (threshold-free ranking quality)
    recall       share of injected anomalies with at least one fix flagged
                 after thresholding and the event filter (what a farmer sees)
    false/1k     flagged events containing no injected fix, per 1000 clean fixes
    per-kind     recall for stray / transport / stall / night
Two injection seeds: "val" picks the settings, "test" reports them.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.inject import KINDS, inject  # noqa: E402
from ml.simulate import herd  # noqa: E402
from ml.pipeline import EVENT_GAP_S, WatchbirdModel, event_filter  # noqa: E402

TRAIN_SHARE = 0.6
PER_KIND = 5
# False alarms per 1000 clean fixes we accept: 4 is about one false alarm per
# animal every 2.5 days at 15-min fixes (the legacy model raises ~23).
FALSE_BUDGET = 4.0


def load_tracks() -> list[pd.DataFrame]:
    b = pd.read_csv(ROOT / "dataset" / "bird_tracking.csv")
    b = b.rename(columns={"date_time": "Timestamp", "bird_name": "Device_id", "latitude": "Latitude",
                          "longitude": "Longitude", "altitude": "Altitude"})
    b["Timestamp"] = pd.to_datetime(b["Timestamp"], utc=True, format="ISO8601")
    cols = ["Device_id", "Timestamp", "Latitude", "Longitude", "Altitude"]
    return [g[cols].sort_values("Timestamp").drop_duplicates("Timestamp").reset_index(drop=True)
            for _, g in b.groupby("Device_id")]


class LegacyModel:
    """The pre-v2 production path: db_csv.compute_features + train.build_features
    + RobustScaler + IsolationForest(contamination=0.1), flags from model.predict."""

    def __init__(self):
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import RobustScaler

        self.IF, self.RS = IsolationForest, RobustScaler

    def _feats(self, fixes):
        with contextlib.redirect_stdout(io.StringIO()):
            import train
            from dataset.db_csv import compute_features

            parts = [compute_features(g.copy()) for _, g in fixes.groupby("Device_id")]
            df, cols = train.build_features(pd.concat(parts, ignore_index=True))
        self.cols = cols
        return df.sort_values(["Device_id", "Timestamp"]).reset_index(drop=True)

    def fit(self, fixes):
        df = self._feats(fixes)
        self.scaler = self.RS().fit(df[self.cols].values)
        self.model = self.IF(n_estimators=200, contamination=0.1, random_state=42, n_jobs=-1).fit(
            self.scaler.transform(df[self.cols].values))
        return self

    def predict(self, fixes):
        df = self._feats(fixes)
        X = self.scaler.transform(df[self.cols].values)
        df["anomaly_score"] = -self.model.score_samples(X)
        df["Anomaly"] = np.where(event_filter(df, self.model.predict(X) == -1), -1, 1)
        return df


def evaluate(make_model, tracks, seed: int, per_device: bool) -> dict:
    rng = np.random.default_rng(seed)
    splits = [(t.iloc[: int(len(t) * TRAIN_SHARE)], t.iloc[int(len(t) * TRAIN_SHARE):].reset_index(drop=True)) for t in tracks]
    t0 = time.perf_counter()
    if per_device:
        models = [make_model().fit(tr) for tr, _ in splits]
    else:
        shared = make_model().fit(pd.concat([tr for tr, _ in splits], ignore_index=True))
        models = [shared] * len(splits)
    fit_s = time.perf_counter() - t0

    labels, scores, hits, clean_fixes, false_events = [], [], {k: [] for k in KINDS}, 0, 0
    t0 = time.perf_counter()
    for model, (_, test) in zip(models, splits):
        injected, segments = inject(test, PER_KIND, rng)
        injected["row"] = np.arange(len(injected))
        out = model.predict(injected).sort_values("row")
        flagged = out["Anomaly"].to_numpy() == -1
        labels.append(out["label"].to_numpy())
        scores.append(out["anomaly_score"].to_numpy())
        for seg in segments:
            hits[seg["kind"]].append(bool(flagged[seg["rows"]].any()))
        clean_fixes += int((out["label"] == 0).sum())
        # Count flagged events (runs of flags <= EVENT_GAP_S apart) that touch no injected fix.
        ts = out["Timestamp"].astype("int64").to_numpy() // 1_000_000_000
        lab = out["label"].to_numpy()
        run_has_label, prev = None, None
        for i in np.flatnonzero(flagged):
            if prev is None or ts[i] - ts[prev] > EVENT_GAP_S:
                if run_has_label is False:
                    false_events += 1
                run_has_label = False
            run_has_label |= bool(lab[i])
            prev = i
        if run_has_label is False:
            false_events += 1
    score_s = time.perf_counter() - t0

    y, s = np.concatenate(labels), np.concatenate(scores)
    all_hits = [h for k in KINDS for h in hits[k]]
    return {
        "AP": average_precision_score(y, s),
        "recall": float(np.mean(all_hits)),
        "false_per_1k": 1000 * false_events / max(clean_fixes, 1),
        **{k: float(np.mean(hits[k])) if hits[k] else float("nan") for k in KINDS},
        "fit_s": fit_s,
        "score_s": score_s,
    }


def run(configs, datasets: dict, seeds):
    """Rows per (config, dataset) plus an 'average' row per config."""
    rows = []
    for label, factory, per_device in configs:
        per_ds = []
        for ds, tracks in datasets.items():
            res = [evaluate(factory, tracks, s, per_device) for s in seeds]
            avg = {k: float(np.nanmean([r[k] for r in res])) for k in res[0]}
            per_ds.append(avg)
            rows.append({"model": label, "per_device": per_device, "data": ds, **avg})
        mean = {k: float(np.nanmean([a[k] for a in per_ds])) for k in per_ds[0]}
        rows.append({"model": label, "per_device": per_device, "data": "average", **mean})
        for r in rows[-len(datasets) - 1 :]:
            print(f"  {label[:46]:<46} {'device' if per_device else 'shared':<7} {r['data']:<9} AP {r['AP']:.3f}  recall {r['recall']:.2f}  "
                  f"false/1k {r['false_per_1k']:.2f}  " + " ".join(f"{k} {r[k]:.2f}" for k in KINDS), flush=True)
    return pd.DataFrame(rows)


def pick_best(rows: pd.DataFrame) -> pd.Series:
    """Best recall within the false-alarm budget (AP breaks ties); if nothing fits, the quietest."""
    ok = rows[rows["false_per_1k"] <= FALSE_BUDGET]
    return ok.sort_values(["recall", "AP"], ascending=False).iloc[0] if len(ok) else rows.sort_values("false_per_1k").iloc[0]


def table(df: pd.DataFrame) -> str:
    cols = ["model", "per_device", "data", "AP", "recall", "false_per_1k", *KINDS, "fit_s", "score_s"]
    head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    body = ""
    for _, r in df[cols].iterrows():
        cells = [r["model"], "per device" if r["per_device"] else "shared", r["data"]]
        cells += [f"{r[c]:.3f}" if c == "AP" else f"{r[c]:.2f}" for c in cols[3:]]
        body += "| " + " | ".join(cells) + " |\n"
    return head + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    datasets = {"livestock": herd(), "gulls": load_tracks()}
    for name, tracks in datasets.items():
        print(f"{name}: {len(tracks)} tracks, {sum(map(len, tracks))} fixes")
    VAL, TEST = [11], [23, 37]
    if args.quick:
        VAL, TEST = [11], [23]

    families = ["isolation_forest", "gaussian_mixture", "local_outlier_factor", "robust_z", "ensemble"]
    if args.quick:
        families = ["isolation_forest", "gaussian_mixture"]

    print("\n1) Model families, default settings (validation seed)")
    stage1 = [("legacy (current production)", LegacyModel, False)]
    for fam in families:
        for per_device in (False, True):
            stage1.append((fam, lambda fam=fam: WatchbirdModel(fam), per_device))
    r1 = run(stage1, datasets, VAL)

    # Pick what a farmer would see: best recall within the false-alarm budget at the
    # default threshold (AP breaks ties), then tune that family's settings and threshold.
    v2 = r1[(r1["model"] != "legacy (current production)") & (r1["data"] == "average")]
    best = pick_best(v2)
    fam, per_device = best["model"], bool(best["per_device"])
    grids = {
        "isolation_forest": [{"n_estimators": n, "max_samples": m} for n in (300, 600) for m in (256, 1024)],
        "gaussian_mixture": [{"n_components": c, "covariance_type": t} for c in (4, 8, 16) for t in ("full", "diag")],
        "local_outlier_factor": [{"n_neighbors": k} for k in (20, 50, 100)],
        "robust_z": [{}],
        "ensemble": [{}],
    }
    grid = grids[fam][:2] if args.quick else grids[fam]
    print(f"\n2) Tuning {fam} ({'per device' if per_device else 'shared'}) (validation seed)")
    stage2 = []
    for params in grid:
        for q in (0.98, 0.99, 0.995):
            stage2.append((f"{fam} {params} q={q}", lambda p=params, q=q: WatchbirdModel(fam, quantile=q, **p), per_device))
    r2 = run(stage2, datasets, VAL)
    r2avg = r2[r2["data"] == "average"].reset_index(drop=True)
    pick = pick_best(r2avg)
    chosen = stage2[list(r2avg["model"]).index(pick["model"])]

    print("\n3) Held-out test seeds: legacy vs chosen, shared and per device")
    final = run([("legacy (current production)", LegacyModel, False), (chosen[0], chosen[1], False), (chosen[0], chosen[1], True)],
                datasets, TEST)

    out = ROOT / "docs" / "ML_BENCHMARK.md"
    out.write_text(
        "# Movement-anomaly model benchmark\n\n"
        "Generated by `python -m ml.benchmark`. Data: simulated livestock herds (`ml/simulate.py`, the target "
        "use case) and 3 real gull tracks (~62k fixes, a hard wide-ranging proxy); first 60% of each "
        "track trains, the last 40% is scored after planting anomalies (`ml/inject.py`). Recall counts an "
        "anomaly as found if any of its fixes is flagged after the event filter. False/1k = flagged events "
        "with no planted anomaly, per 1000 clean fixes (1000 fixes is about 10 days at 15 min).\n\n"
        f"**Chosen:** `{chosen[0]}` (best recall with at most {FALSE_BUDGET:g} false alarms per 1000 "
        "clean fixes on the validation seed). The held-out table shows it trained once for all devices "
        "(shared) and once per device.\n\n"
        "## Held-out test\n\n" + table(final) +
        "\n## Stage 1: families (validation)\n\n" + table(r1) +
        "\n## Stage 2: tuning (validation)\n\n" + table(r2),
        encoding="utf-8",
    )
    print(f"\nwrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
