"""Watchbird ML service.

A small FastAPI app the web admin panel calls to train movement-anomaly models
(ml/pipeline.py, choice backed by ml/benchmark.py) and to score new telemetry.
By default one model is trained for the selected group of devices (the
benchmark found that as good as or better than one per device); per_device=True
gives each device with enough history its own.

    pip install -r ml/requirements.txt
    uvicorn ml.service:app --port 8000          # run from the repo root

Jobs are rows in public.ml_jobs. The web app inserts one as the admin, then
POSTs /jobs/{id}/run; the job runs in the background and writes its outcome
back to the row, so the admin page's job log shows progress.

Trained models live in the private Supabase Storage bucket "models"
(<name>.joblib; legacy <name>.pkl + _Scaler.pkl) and are cached in models/ on
first use, so a throwaway disk (Render's free tier) loses nothing on restart.

Environment (see .env.example):
    ML_SERVICE_SECRET     required; callers must send it as X-ML-Secret
    RUN_BRIDGE=1          also run bridge.py (MQTT -> "Data") in this process
    MONITOR_INTERVAL_MIN  score new fixes every N minutes (0 = only on demand)
    ML_DETECTOR, ML_DETECTOR_PARAMS, ML_QUANTILE   override the default model settings
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)  # train.py uses repo-relative paths (models/, results/, dataset/)

from db_operations import supabase  # noqa: E402
from ml.pipeline import WatchbirdModel  # noqa: E402

SECRET = os.environ.get("ML_SERVICE_SECRET", "")
MODEL_BUCKET = "models"
MODEL_DIR = ROOT / "models"
PAGE = 1000
# Default model comes from docs/ML_BENCHMARK.md; override per deployment if needed.
DETECTOR = os.environ.get("ML_DETECTOR", "local_outlier_factor")
DETECTOR_PARAMS = json.loads(os.environ.get("ML_DETECTOR_PARAMS", "{}"))
QUANTILE = float(os.environ.get("ML_QUANTILE", "0.99"))
MIN_DEVICE_FIXES = 300  # ~3 days at 15 min: enough to learn one animal's routine
MIN_SHARED_FIXES = 100

def _check(secret: str | None):
    # Fail closed: on a public host an unset secret must not mean "open".
    if not SECRET:
        raise HTTPException(status_code=503, detail="ML_SERVICE_SECRET is not set on the service")
    if secret != SECRET:
        raise HTTPException(status_code=401, detail="bad secret")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _fetch(query) -> list[dict]:
    rows, offset = [], 0
    while True:
        chunk = query.range(offset, offset + PAGE - 1).execute().data
        rows.extend(chunk)
        if len(chunk) < PAGE:
            return rows
        offset += PAGE


COLUMNS = "Id, Device_id, Timestamp, Latitude, Longitude, Altitude, Anomaly"


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], utc=True)
    df["Device_id"] = df["Device_id"].astype(int)
    return df


# ---------------------------------------------------------------------------
# Model files: Supabase Storage is the source of truth, models/ is a cache.
# v2 models are one file, <name>.joblib (ml/pipeline.py). Legacy train.py
# models are <name>.pkl + <name>_Scaler.pkl and are still scored until retrained.
# ---------------------------------------------------------------------------


def ensure_bucket():
    try:
        supabase.storage.create_bucket(MODEL_BUCKET, options={"public": False})
    except Exception:
        pass  # already exists


def upload_file(filename: str):
    supabase.storage.from_(MODEL_BUCKET).upload(
        filename, (MODEL_DIR / filename).read_bytes(), {"content-type": "application/octet-stream", "upsert": "true"}
    )


def fetch_file(filename: str) -> bool:
    """Make sure models/<filename> exists locally; download it if not."""
    MODEL_DIR.mkdir(exist_ok=True)
    if (MODEL_DIR / filename).exists():
        return True
    try:
        (MODEL_DIR / filename).write_bytes(supabase.storage.from_(MODEL_BUCKET).download(filename))
        return True
    except Exception:
        return False


def upload_model(name: str):
    """Legacy helper kept for ml/sync_models.py: uploads <name>.pkl + scaler."""
    for f in (f"{name}.pkl", f"{name}_Scaler.pkl"):
        upload_file(f)


# ---------------------------------------------------------------------------
# Training (v2)
# ---------------------------------------------------------------------------


def _device_frame(device_ids: list[int]) -> pd.DataFrame:
    rows = _fetch(supabase.table("Data").select(COLUMNS).in_("Device_id", device_ids).order("Timestamp"))
    return _frame(rows) if rows else pd.DataFrame(columns=COLUMNS.split(", "))


def _fit_and_store(name: str, fixes: pd.DataFrame, device_ids: list[int]) -> dict:
    model = WatchbirdModel(DETECTOR, quantile=QUANTILE, **DETECTOR_PARAMS).fit(fixes)
    MODEL_DIR.mkdir(exist_ok=True)
    model.save(MODEL_DIR / f"{name}.joblib")
    upload_file(f"{name}.joblib")
    meta = model.meta
    supabase.table("ml_models").upsert(
        {
            "name": name,
            "algorithm": meta["detector"],
            "device_ids": device_ids,
            "metrics": {"samples": meta["samples"], "anomaly_rate": round(meta["anomaly_rate"], 4), "version": meta["version"]},
            "params": {"quantile": meta["quantile"], **meta["params"]},
            "trained_at": _now(),
        }
    ).execute()
    return {"model": name, "devices": device_ids, "samples": meta["samples"], "anomaly_rate": round(meta["anomaly_rate"], 4)}


def train_model(model_name: str, device_ids: list[int], assign: bool, per_device: bool = False) -> dict:
    """Train v2 models. per_device: each device with MIN_DEVICE_FIXES of history gets
    its own model (<model_name>-<device_id>); the rest share one named <model_name>."""
    fixes = _device_frame(device_ids)
    counts = fixes["Device_id"].value_counts().to_dict() if len(fixes) else {}
    own = [d for d in device_ids if per_device and counts.get(d, 0) >= MIN_DEVICE_FIXES]
    shared = [d for d in device_ids if d not in own and counts.get(d, 0) > 0]
    trained, assignment = [], {}

    for d in own:
        name = f"{model_name}-{d}"
        trained.append(_fit_and_store(name, fixes[fixes["Device_id"] == d], [d]))
        assignment[d] = name
    if shared:
        subset = fixes[fixes["Device_id"].isin(shared)]
        if len(subset) < MIN_SHARED_FIXES:
            raise ValueError(f"only {len(subset)} fixes for devices {shared}; need {MIN_SHARED_FIXES} to train")
        trained.append(_fit_and_store(model_name, subset, shared))
        assignment.update({d: model_name for d in shared})
    if not trained:
        raise ValueError(f"no telemetry for devices {device_ids}")

    if assign:
        for d, name in assignment.items():
            supabase.table("Devices").update({"IF_model": name}).eq("Device_id", d).execute()
    return {"models": trained, "assigned": assign}


# ---------------------------------------------------------------------------
# Scoring new telemetry
# ---------------------------------------------------------------------------


def score_device(device_id: int, model_name: str) -> dict:
    new = _fetch(
        supabase.table("Data").select(COLUMNS).eq("Device_id", device_id).is_("scored_at", "null").order("Timestamp")
    )
    if not new:
        return {"device": device_id, "scored": 0, "anomalies": 0}

    if fetch_file(f"{model_name}.joblib"):
        # v2 features look back up to a week (familiarity), so give them that history.
        since = (pd.Timestamp(new[0]["Timestamp"]) - pd.Timedelta(days=7)).isoformat()
        context = _fetch(
            supabase.table("Data").select(COLUMNS).eq("Device_id", device_id)
            .gte("Timestamp", since).lt("Timestamp", new[0]["Timestamp"]).order("Timestamp")
        )
        df = WatchbirdModel.load(MODEL_DIR / f"{model_name}.joblib").predict(_frame(context + new))
    elif fetch_file(f"{model_name}.pkl") and fetch_file(f"{model_name}_Scaler.pkl"):
        df = _legacy_predict(device_id, model_name, new)
    else:
        return {"device": device_id, "skipped": f"model {model_name} not in storage bucket '{MODEL_BUCKET}'"}

    out = df[df["Id"].isin({r["Id"] for r in new})]
    labels = [
        {"Id": int(r.Id), "Anomaly": int(r.Anomaly), "anomaly_score": float(np.round(r.anomaly_score, 5))}
        for r in out.itertuples()
    ]
    for i in range(0, len(labels), PAGE):
        supabase.rpc("apply_anomaly_labels", {"labels": labels[i : i + PAGE]}).execute()
    return {"device": device_id, "scored": len(labels), "anomalies": sum(lab["Anomaly"] == -1 for lab in labels)}


def _legacy_predict(device_id: int, model_name: str, new: list[dict]) -> pd.DataFrame:
    """Pre-v2 path (train.py features + IsolationForest). Delete once every device is retrained."""
    import train
    from dataset.db_csv import compute_features

    context = (
        supabase.table("Data").select(COLUMNS).eq("Device_id", device_id)
        .lt("Timestamp", new[0]["Timestamp"]).order("Timestamp", desc=True).limit(20).execute().data
    )
    df, _ = train.build_features(compute_features(_frame(list(reversed(context)) + new)))
    model, scaler, cols = train.load_model(str(MODEL_DIR / f"{model_name}.pkl"), str(MODEL_DIR / f"{model_name}_Scaler.pkl"))
    X = scaler.transform(df[cols].values)
    df["anomaly_score"] = -model.score_samples(X)  # higher = more anomalous, same as v2
    df["Anomaly"] = model.predict(X)
    return train.filter_isolated_anomalies(
        df, gap_threshold=train.Config.EVENT_GAP_THRESHOLD, min_event_size=train.Config.MIN_EVENT_SIZE
    )


def monitor(device_ids: list[int] | None = None) -> dict:
    query = supabase.table("Devices").select("Device_id, IF_model").not_.is_("IF_model", "null")
    if device_ids:
        query = query.in_("Device_id", device_ids)
    per_device = [score_device(d["Device_id"], d["IF_model"]) for d in query.execute().data]
    return {
        "scored": sum(d.get("scored", 0) for d in per_device),
        "anomalies": sum(d.get("anomalies", 0) for d in per_device),
        "devices": per_device,
    }


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _run_job(job_id: str):
    job = supabase.table("ml_jobs").select("*").eq("id", job_id).single().execute().data
    supabase.table("ml_jobs").update({"status": "running"}).eq("id", job_id).execute()
    try:
        p = job["payload"] or {}
        if job["kind"] == "train":
            result = train_model(
                p["model_name"], [int(i) for i in p["device_ids"]], bool(p.get("assign")), bool(p.get("per_device", False))
            )
        else:
            result = monitor([int(i) for i in p.get("device_ids") or []] or None)
        supabase.table("ml_jobs").update({"status": "done", "result": result, "finished_at": _now()}).eq("id", job_id).execute()
    except Exception as e:  # the job row is the only place an admin will see this
        traceback.print_exc()
        supabase.table("ml_jobs").update({"status": "failed", "error": str(e)[:500], "finished_at": _now()}).eq("id", job_id).execute()


def _monitor_loop(minutes: float):
    while True:
        time.sleep(minutes * 60)
        try:
            print("[monitor]", monitor())
        except Exception:
            traceback.print_exc()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_bucket()
    if os.environ.get("RUN_BRIDGE") == "1":
        import bridge

        bridge.start_background()
    minutes = float(os.environ.get("MONITOR_INTERVAL_MIN") or 0)
    if minutes > 0:
        threading.Thread(target=_monitor_loop, args=(minutes,), daemon=True).start()
    yield


app = FastAPI(title="Watchbird ML", lifespan=lifespan)


@app.get("/health")
def health():
    try:
        names = [o["name"] for o in supabase.storage.from_(MODEL_BUCKET).list()]
        models = sorted(
            {n.rsplit(".", 1)[0] for n in names if n.endswith(".joblib") or (n.endswith(".pkl") and not n.endswith("_Scaler.pkl"))}
        )
    except Exception:
        models = []
    return {"ok": True, "models": models, "bridge": os.environ.get("RUN_BRIDGE") == "1"}


@app.post("/jobs/{job_id}/run", status_code=202)
def run_job(job_id: str, tasks: BackgroundTasks, x_ml_secret: str | None = Header(default=None)):
    _check(x_ml_secret)
    tasks.add_task(_run_job, job_id)
    return {"accepted": job_id}


@app.post("/monitor")
def monitor_now(x_ml_secret: str | None = Header(default=None)):
    """Synchronous scoring pass for schedulers."""
    _check(x_ml_secret)
    return monitor()
