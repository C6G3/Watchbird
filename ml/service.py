"""Watchbird ML service.

A small FastAPI app the web admin panel calls to train Isolation Forest models
and to score new telemetry. It reuses train.py unchanged; this file only moves
data between Supabase and that pipeline.

    pip install -r ml/requirements.txt
    uvicorn ml.service:app --port 8000          # run from the repo root

Jobs are rows in public.ml_jobs. The web app inserts one as the admin, then
POSTs /jobs/{id}/run; the job runs in the background and writes its outcome
back to the row, so the admin page's job log shows progress.

Trained models live in the private Supabase Storage bucket "models"
(<name>.pkl + <name>_Scaler.pkl) and are cached in models/ on first use, so
hosts with a throwaway disk (Render's free tier) don't lose them on restart.

Environment (see .env.example):
    ML_SERVICE_SECRET     required; callers must send it as X-ML-Secret
    RUN_BRIDGE=1          also run bridge.py (MQTT -> "Data") in this process
    MONITOR_INTERVAL_MIN  score new fixes every N minutes (0 = only on demand)
"""
from __future__ import annotations

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

import train  # noqa: E402
from dataset.db_csv import compute_features  # noqa: E402
from db_operations import supabase  # noqa: E402

SECRET = os.environ.get("ML_SERVICE_SECRET", "")
MODEL_BUCKET = "models"
MODEL_DIR = ROOT / "models"
PAGE = 1000
# Fixes of already-scored history fed in ahead of new ones, so rolling-window
# features (largest window is 9) see real neighbours instead of zeros.
CONTEXT = 20

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
# Model files: Supabase Storage is the source of truth, models/ is a cache
# ---------------------------------------------------------------------------


def _model_files(name: str) -> list[str]:
    return [f"{name}.pkl", f"{name}_Scaler.pkl"]


def ensure_bucket():
    try:
        supabase.storage.create_bucket(MODEL_BUCKET, options={"public": False})
    except Exception:
        pass  # already exists


def upload_model(name: str):
    for f in _model_files(name):
        supabase.storage.from_(MODEL_BUCKET).upload(
            f, (MODEL_DIR / f).read_bytes(), {"content-type": "application/octet-stream", "upsert": "true"}
        )


def fetch_model(name: str) -> bool:
    """Make sure models/<name>*.pkl exist locally; download them if not."""
    MODEL_DIR.mkdir(exist_ok=True)
    for f in _model_files(name):
        if (MODEL_DIR / f).exists():
            continue
        try:
            (MODEL_DIR / f).write_bytes(supabase.storage.from_(MODEL_BUCKET).download(f))
        except Exception:
            return False
    return True


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


def train_model(model_name: str, device_ids: list[int], assign: bool) -> dict:
    rows = _fetch(
        supabase.table("Data").select(COLUMNS).in_("Device_id", device_ids).order("Timestamp")
    )
    if len(rows) < train.Config.MIN_SAMPLES_FOR_TRAINING:
        raise ValueError(f"only {len(rows)} fixes for devices {device_ids}; need {train.Config.MIN_SAMPLES_FOR_TRAINING}")

    # Same path the Streamlit app took: base features to CSV, then the pipeline.
    compute_features(_frame(rows)).to_csv(train.Config.DATA_PATH, index=False)
    results = train.run_pipeline(
        device_ids=device_ids,
        perform_hp_search=False,
        create_visualizations=False,
        model_name=model_name,
    )
    upload_model(model_name)
    full = results["full_df"]
    metrics = {
        "samples": int(len(full)),
        "anomaly_rate": float((full["Anomaly"] == -1).mean()),
        "features": len(results["feature_columns"]),
    }
    supabase.table("ml_models").upsert(
        {
            "name": model_name,
            "device_ids": device_ids,
            "metrics": metrics,
            "params": {
                "n_estimators": train.Config.N_ESTIMATORS,
                "contamination": train.Config.CONTAMINATION,
            },
            "trained_at": _now(),
        }
    ).execute()
    if assign:
        supabase.table("Devices").update({"IF_model": model_name}).in_("Device_id", device_ids).execute()
    return metrics


# ---------------------------------------------------------------------------
# Scoring new telemetry
# ---------------------------------------------------------------------------


def score_device(device_id: int, model_name: str) -> dict:
    model_path = MODEL_DIR / f"{model_name}.pkl"
    scaler_path = MODEL_DIR / f"{model_name}_Scaler.pkl"
    if not fetch_model(model_name):
        return {"device": device_id, "skipped": f"model {model_name} not in storage bucket '{MODEL_BUCKET}'"}

    new = _fetch(
        supabase.table("Data").select(COLUMNS).eq("Device_id", device_id).is_("scored_at", "null").order("Timestamp")
    )
    if not new:
        return {"device": device_id, "scored": 0, "anomalies": 0}

    context = (
        supabase.table("Data")
        .select(COLUMNS)
        .eq("Device_id", device_id)
        .lt("Timestamp", new[0]["Timestamp"])
        .order("Timestamp", desc=True)
        .limit(CONTEXT)
        .execute()
        .data
    )
    new_ids = {r["Id"] for r in new}
    df = compute_features(_frame(list(reversed(context)) + new))
    df, _ = train.build_features(df)

    model, scaler, feature_columns = train.load_model(str(model_path), str(scaler_path))
    X = scaler.transform(df[feature_columns].values)
    # The model's own threshold (set by contamination at training time), not a
    # per-batch quantile, which would flag a fixed share of every batch.
    df["anomaly_score"] = model.score_samples(X)
    df["Anomaly"] = model.predict(X)
    df = train.filter_isolated_anomalies(
        df,
        gap_threshold=train.Config.EVENT_GAP_THRESHOLD,
        min_event_size=train.Config.MIN_EVENT_SIZE,
    )

    out = df[df["Id"].isin(new_ids)]
    labels = [
        {"Id": int(r.Id), "Anomaly": int(r.Anomaly), "anomaly_score": float(np.round(r.anomaly_score, 5))}
        for r in out.itertuples()
    ]
    for i in range(0, len(labels), PAGE):
        supabase.rpc("apply_anomaly_labels", {"labels": labels[i : i + PAGE]}).execute()
    return {"device": device_id, "scored": len(labels), "anomalies": sum(l["Anomaly"] == -1 for l in labels)}


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
            result = train_model(p["model_name"], [int(i) for i in p["device_ids"]], bool(p.get("assign")))
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
        stored = supabase.storage.from_(MODEL_BUCKET).list()
        models = sorted(o["name"][:-4] for o in stored if o["name"].endswith(".pkl") and not o["name"].endswith("_Scaler.pkl"))
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
