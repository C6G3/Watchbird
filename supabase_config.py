"""Supabase credentials for the Python side (bridge, training, ML service).

Reads environment variables first (SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY),
loading a .env file next to this one if present, and falls back to the legacy
.streamlit/secrets.toml. Writers need the service-role key: with RLS on,
the anon key can no longer insert telemetry or write anomaly labels.
"""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")

if not (SUPABASE_URL and SUPABASE_KEY):
    import tomllib

    secrets = Path(__file__).with_name(".streamlit") / "secrets.toml"
    if secrets.exists():
        with secrets.open("rb") as f:
            data = tomllib.load(f)
        SUPABASE_URL = SUPABASE_URL or data.get("SUPABASE_URL", "")
        SUPABASE_KEY = SUPABASE_KEY or data.get("SUPABASE_SERVICE_ROLE_KEY") or data.get("SUPABASE_KEY", "")

if not (SUPABASE_URL and SUPABASE_KEY):
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).")
