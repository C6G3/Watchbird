# Watchbird

Field telemetry for farms. ESP32 GPS trackers report every 15 seconds, and an
Isolation Forest flags movement that doesn't look normal: an animal leaving
its range, a bird circling where it never goes, a tractor moving at 3 a.m.
Farmers see their farm on a map in plain language and can photograph a crop
or animal for a diagnosis. Admins manage devices, farms, people and models.

```
ESP32 tracker ──MQTT──▶ bridge.py ──▶ Supabase (Postgres + Auth + Storage + Realtime)
                                         ▲            │
                         ml/service.py ──┘            ▼
                         (train / score)          web/  Next.js app
                                                  └─ photo scans → Hugging Face
```

| Part | Stack |
| --- | --- |
| `web/` | Next.js 16, React 19, TypeScript, MapLibre, plain CSS (light/dark) |
| `supabase/` | Schema, row-level security, storage bucket, RPCs |
| `ml/service.py` | FastAPI around the existing `train.py` pipeline (scikit-learn) |
| `bridge.py` | MQTT → Supabase |
| `tracker_stable_3.cpp` | ESP32 firmware, Wi-Fi or SIM800 GPRS |
| `app.py` | Legacy Streamlit UI, kept for reference |

## Try it in 1 minute (demo mode)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 and choose **Enter as farmer** or **Enter as
admin**. With no Supabase keys, the app runs on a synthetic farm near DeKUT
and nothing is saved.

## Go live

### 1. Supabase

1. Use the existing Watchbird project or create one at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/migrations/20261103000000_init.sql`. It is
   idempotent: on the original project it keeps `"Devices"`/`"Data"` and their
   rows, adds the new columns and tables, and replaces the old open anon
   policies. Optionally run `supabase/seed.sql` for starter farms.
3. In **Authentication → URL configuration**, add `http://localhost:3000/auth/callback`
   (and your production URL) to the redirect URLs.

### 2. Web app

```bash
cp web/.env.example web/.env.local   # fill in the Supabase URL, anon key and service-role key
npm --prefix web run dev
```

Sign up at `/login`, then make yourself admin in the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### 3. Photo insights (Hugging Face)

Create a token at https://huggingface.co/settings/tokens with **Make calls to
Inference Providers** enabled, then set `HF_TOKEN` in `web/.env.local`.
Defaults:

- `HF_VISION_MODEL=Qwen/Qwen2.5-VL-7B-Instruct` looks at the photo and writes
  the diagnosis and next steps as structured JSON.
- `HF_PLANT_CLASSIFIER` is an optional PlantVillage leaf classifier. Its top
  labels are passed to the vision model as a hint.

### 4. ML service and bridge

```bash
cp .env.example .env                 # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ML_SERVICE_SECRET
pip install -r ml/requirements.txt
uvicorn ml.service:app --port 8000   # from the repo root
python bridge.py                     # in another terminal
```

Set `ML_SERVICE_URL` and the same `ML_SERVICE_SECRET` in `web/.env.local`.
Admin → Models can then train models and run detection. To score
automatically, schedule `POST http://127.0.0.1:8000/monitor` (with header
`X-ML-Secret`) every few minutes.

> With row-level security on, the anon key can no longer write telemetry.
> `bridge.py` and the ML service need the **service-role** key. Keep it server-side.

## Deploy (Render, free)

`render.yaml` defines two free web services: `watchbird-web` (Next.js) and
`watchbird-ml` (FastAPI, which also runs the MQTT bridge and scores new fixes
every 10 minutes).

1. Push the repo to GitHub. In Render: **New → Blueprint** and pick the repo.
2. Fill in the values it asks for: Supabase URL, anon key and service-role
   key, and `HF_TOKEN`. Leave `ML_SERVICE_URL` for now.
3. After the first deploy, set `ML_SERVICE_URL` on `watchbird-web` to
   `watchbird-ml`'s public URL (e.g. `https://watchbird-ml.onrender.com`) and redeploy.
4. In Supabase **Authentication → URL configuration**, set the Site URL to the
   `watchbird-web` URL and add `<that URL>/auth/callback` to the redirect URLs.

Free services sleep after ~15 minutes idle. Visitors then see Render's
"waking up" page for 30–60 s. While `watchbird-ml` sleeps, its bridge sleeps
too, so tracker fixes sent in that window are dropped: fine for a demo, not
for production. Trained models live in the private `models` storage bucket, so
restarts don't lose them (`python -m ml.sync_models` uploads local ones).

## Roles

- **Farmer**: sees only the farms an admin has linked them to. Read-only,
  apart from their own photo scans.
- **Admin**: manages devices, farms, people, roles, models and jobs.

Both rules are enforced in Postgres (RLS), not just in the UI.

## Database

| Table | Purpose |
| --- | --- |
| `"Devices"`, `"Data"` | Trackers and GPS fixes. Legacy names kept for firmware/bridge/`train.py` compatibility. `"Data"` gains `anomaly_score` and `scored_at`. |
| `profiles` | One per auth user: name, email, role (`admin` / `farmer`). |
| `farms`, `farm_members` | Farms (centre, optional boundary polygon) and who can see them. |
| `scans` + `scans` bucket | Photo scans and their structured insight. |
| `ml_models`, `ml_jobs` | Model registry and the train/monitor job log. |

## Anomaly model

Isolation Forest over 35 engineered features: speed, acceleration and
vertical speed, rolling mean/std over 3/5/9 fixes, hover and burst flags,
z-scores, log transforms and time of day. Single-fix outliers are discarded,
so only clustered anomalies (≥ 2 fixes within 15 minutes) count as events.
See `train.py`.

## For Claude Code

Two project skills describe the repo: `.claude/skills/codebase-map` (where
things live) and `.claude/skills/app-functionality` (what each feature does
and its permission rules).

MIT licensed. Made by [Psynolyn](https://github.com/Psynolyn).
