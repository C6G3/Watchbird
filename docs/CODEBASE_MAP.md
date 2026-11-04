# Watchbird codebase map

> Source of truth for where things live. Agents: read `AGENTS.md` first.
> Update this file in the same commit whenever you add, move or delete a file it lists.

Watchbird is field telemetry for farms: ESP32 GPS trackers → MQTT → Supabase,
unsupervised models (one per device) that flag unusual movement, and a Next.js web app where
farmers see their farm and scan photos, and admins manage everything.

## Data flow

```
ESP32 (tracker_stable_3.cpp)  ──MQTT watchbird/device/location──▶  bridge.py
   {Timestamp, Device_id, Latitude, Longitude, Altitude}              │ service-role insert
                                                                       ▼
                                                     Supabase  public."Data"
                                                                       │
Phone (/admin/track) ──POST /api/track──▶ service-role insert ──▶ "Data"
                                                                       │
          ml/service.py ◀── POST /jobs/{id}/run ── web admin (Models)  │ realtime
            │ ml/pipeline.py, models/*.joblib                          ▼
            └── rpc apply_anomaly_labels ──▶ "Data"."Anomaly"  ──▶  web/ dashboard map
```

Photo scans never touch Python: `web/src/app/api/scans/route.ts` → Supabase
Storage bucket `scans` → Hugging Face (`web/src/lib/insights.ts`) → `public.scans`.

## Directory guide

| Path | What it is |
| --- | --- |
| `web/` | Next.js 16 (App Router, React 19, TypeScript, plain CSS). The product. |
| `web/src/app/(app)/` | Signed-in pages. `layout.tsx` = auth gate + `AppShell` + realtime refresh. |
| `web/src/app/(app)/dashboard` | Farm overview: stats, map, tracker list, field notes. |
| `web/src/app/(app)/devices/[id]` | One tracker: map, speed/altitude sparklines, events, datasheet. |
| `web/src/app/(app)/scans` | Photo upload + history; `scans/[id]` shows one insight. |
| `web/src/app/(app)/admin/*` | Admin only (`admin/layout.tsx` calls `requireAdmin`). `actions.ts` holds every admin mutation. |
| `web/src/app/login`, `auth/*` | Email/password auth, signup, email callback, sign-out, demo entry. |
| `web/src/app/api/scans/route.ts` | Upload → storage → HF models → save insight. |
| `web/src/app/api/track/route.ts` | Phone-tracker fixes → `"Data"` (admin only, service-role insert). |
| `web/src/proxy.ts` | Next 16 "proxy" (was middleware): refreshes Supabase cookie, bounces signed-out users. |
| `web/src/lib/data.ts` | **All reads.** Supabase queries with a demo-data fallback. Add new queries here. |
| `web/src/lib/session.ts` | `getViewer` / `requireViewer` / `requireAdmin`. |
| `web/src/lib/demo.ts` | Synthetic farm used when Supabase env vars are missing (demo mode). |
| `web/src/lib/geo.ts` | Haversine, anomaly-event grouping (mirrors `ml/pipeline.py` `EVENT_GAP_S`/`MIN_EVENT_SIZE`), distance. |
| `web/src/lib/insights.ts` | Hugging Face: optional PlantVillage classifier + VLM that returns `Insight` JSON. |
| `web/src/lib/types.ts` | Shared TS types (`Device`, `Fix`, `DeviceTrack`, `AnomalyEvent`, `Insight`, …). |
| `web/src/components/FieldMap.tsx` | MapLibre map: ESRI satellite / CARTO plain, tracks, anomaly rings, farm edges. |
| `web/src/components/PhoneTracker.tsx` | Phone-as-tracker page logic: geolocation, wake lock, offline queue. |
| `web/src/components/ActionForm.tsx` | Form wrapper for server actions with pending/ok/error feedback. |
| `web/src/lib/format.ts` | Time, distance, coordinate formatting; `describeEvent`; `cap`. |
| `web/src/app/globals.css` | The whole design system: tokens (light/dark), shell, panels, sheets, map, forms. |
| `supabase/migrations/` | Schema + RLS + storage + RPCs. Single source of truth for the database. |
| `supabase/seed.sql` | Starter farms/devices. `bird_data_300m_dist.sql` adds telemetry for device 3. |
| `supabase/tests/` | PGlite tests that run the migration on a fresh DB and on a replica of the live legacy schema, then check RLS. `npm --prefix supabase/tests test`. |
| `ml/service.py` | FastAPI: `/health`, `/jobs/{id}/run` (train or monitor), `/monitor`. With `RUN_BRIDGE=1` it also hosts the MQTT bridge; `MONITOR_INTERVAL_MIN` scores on a timer. |
| `ml/features.py` | v2 movement features (15, all trailing-window, mostly relative to the device's own routine). |
| `ml/detectors.py` | Unsupervised detectors behind one interface: IsolationForest, GMM, LOF, robust-z, ensemble. Higher score = more anomalous. |
| `ml/pipeline.py` | `WatchbirdModel`: features → detector → threshold (training-score quantile) → event filter. One `.joblib` file per model. |
| `ml/benchmark.py` | Picks the model: plants anomalies (`ml/inject.py`) into simulated herds (`ml/simulate.py`) and real gull tracks, writes `docs/ML_BENCHMARK.md`. `python -m ml.benchmark`. |
| `ml/inject.py`, `ml/simulate.py` | Synthetic anomalies (stray, transport, stall, night) and a simulated livestock herd, for the benchmark only. |
| `ml/sync_models.py` | One-off: uploads legacy `models/*.pkl` to the `models` storage bucket. |
| `render.yaml` | Render blueprint: free `watchbird-web` (Node) + `watchbird-ml` (Python). |
| `train.py` | **Legacy** v1 pipeline (35 features + IsolationForest). Only used to score devices whose model is still a `.pkl`; delete once all are retrained. |
| `db_operations.py`, `dataset/db_csv.py` | Legacy data helpers; now read creds via `supabase_config.py`. |
| `supabase_config.py` | Env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) → fallback `.streamlit/secrets.toml`. |
| `bridge.py` | MQTT subscriber that writes tracker fixes into `"Data"`. `python bridge.py` runs it alone; `start_background()` is what the ML service calls. |
| `app.py` | **Legacy** Streamlit UI. Kept for reference; the web app replaces it. |
| `tracker*.cpp`, `gpstest.cpp` | ESP32 firmware (Wi-Fi or SIM800 GPRS, TinyGPS++, PubSubClient). `tracker_stable_3.cpp` is the current one. |
| `docs/` | This map, `APP_FUNCTIONALITY.md`, `ROADMAP.md`. `AGENTS.md` (root) is the rulebook. |
| `.claude/skills/` | Thin Claude Code pointers to the docs above. Don't put knowledge there. |
| `models/` | Local cache of trained `<name>.joblib` (legacy: `<name>.pkl` + `<name>_Scaler.pkl`). Source of truth is the private Supabase Storage bucket `models` (service role only). Name = `"Devices"."IF_model"` = `ml_models.name`. |

## Conventions that bite

- `"Devices"` and `"Data"` keep their **quoted, capitalised** legacy names and
  columns (`"Device_id"`, `"Timestamp"`, `"Anomaly"`…) because firmware,
  bridge and `train.py` depend on them. New tables are snake_case. In
  PostgREST selects write the names bare: `.select("Id, Device_id, Timestamp")`.
- `Anomaly` is `1` normal / `-1` anomalous (scikit-learn outlier convention).
  `scored_at IS NULL` means "not scored yet" — that's how the monitor job finds new fixes.
- Never upsert partial `"Data"` rows (NOT NULL columns reject it). Write labels
  with `rpc("apply_anomaly_labels", {labels: [{Id, Anomaly, anomaly_score}]})`.
- Server-only modules start with `import "server-only"`. Anything taking a
  function prop or using hooks needs `"use client"`.
- Next 16: `params` / `searchParams` / `cookies()` are Promises — always `await`.
- MapLibre's worker is copied to `web/public/maplibre/` by `postinstall`;
  `FieldMap` calls `setWorkerUrl`. If the map shows labels but no tracks, check that file.
- Styling: tokens on `:root` / `[data-theme]` in `globals.css`. Palette is
  "canopy & sprout": deep forest surfaces/ink + sprout chartreuse accent
  (`--leaf`; forest buttons with sprout text in light mode, sprout buttons in
  dark); `--rust` (signal coral) means anomaly and nothing else; `--ochre`
  (harvest amber) for warnings. Shapes are soft: pills (`--pill`) for buttons,
  tags, toggles and map overlays; `--r-md`/`--r-lg` for inputs and cards; round
  dots. Type is smooth: Outfit (`.display`, headings, big numbers), Figtree
  (body and labels, sentence case, never forced uppercase), Geist Mono only for
  data (`.num`, coordinates, times). Use `cap()` from `lib/format.ts` when
  showing enum values. No gradients/glows/emoji. Match it.

## Running things

```bash
npm --prefix web install && npm --prefix web run dev     # http://localhost:3000 (demo mode without env)
npm --prefix web run typecheck
npm --prefix web run build
pip install -r ml/requirements.txt && uvicorn ml.service:app --port 8000
python bridge.py                                          # MQTT → Supabase
python -m ml.benchmark                                    # re-pick the model (~15 min)

npm --prefix supabase/tests install && npm --prefix supabase/tests test   # schema + RLS tests
```

Env files: `web/.env.local` (see `web/.env.example`) and repo-root `.env`
(see `.env.example`). Both are git-ignored and hold real keys: never print or
commit them. The preview config is `.claude/launch.json` (`web`).
