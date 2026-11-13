"""Upload every model in models/ to the Supabase "models" bucket.

One-off, for models trained before the ML service stored them itself:
    python -m ml.sync_models
"""
from ml.service import MODEL_DIR, ensure_bucket, upload_model

ensure_bucket()
names = sorted(p.stem for p in MODEL_DIR.glob("*.pkl") if not p.stem.endswith("_Scaler"))
for name in names:
    if (MODEL_DIR / f"{name}_Scaler.pkl").exists():
        upload_model(name)
        print("uploaded", name)
    else:
        print("skipped", name, "(no scaler file)")
