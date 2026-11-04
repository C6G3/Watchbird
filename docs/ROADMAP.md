# Watchbird roadmap and decision log

> Where the project stands, what to build next, and why things are the way
> they are. Agents: read `AGENTS.md` first. When you finish an item, tick it
> here in the same commit. When you make a design decision, add it to the log.

## Status (2026-11-04)

Branch `web-rebuild` holds the rebuild (not yet merged to `main`, not pushed).

| Area | State |
| --- | --- |
| Web app (`web/`) | Built: auth, roles, dashboard + map, tracker pages, photo scans, admin panel, phone tracker, light/dark. Typecheck and build pass. |
| Database | Live on the original Supabase project; migration applied; RLS verified; 4 devices, ~1.5k fixes. |
| ML service | v2 model (LOF, `ml/`) benchmarked and wired in; works locally. Live devices still point at legacy v1 `.pkl` models. Not deployed. |
| Deployment | `render.yaml` ready (all-on-Render free demo). Not deployed. |
| Tests | `supabase/tests` (schema + RLS). Web has typecheck/build only. |

## Next steps, in order

Owner "user" means it needs the human (accounts, keys, dashboards).

1. [ ] **User**: sign up at `/login`, then `update public.profiles set role = 'admin' where email = '…';`
2. [ ] **User**: add farms (Admin → Farms) and assign the 4 devices (Admin → Devices).
3. [ ] **User**: put `HF_TOKEN` in `web/.env.local`; test one photo scan.
4. [ ] **User**: push `web-rebuild`, deploy with the Render blueprint (README → Deploy).
       Then in Supabase → Authentication: set Site URL and redirect URLs to the
       Render domain (and `http://localhost:3000/**`), or confirmation and reset
       links point at the wrong host; set the minimum password length to 8.
5. [ ] **User**: retrain in Admin → Models (select devices, keep "assign" on)
       so every device gets a v2 `.joblib` model. Then, **asking the user first**,
       run the first scoring pass. It overwrites the old Streamlit app's
       `"Anomaly"` labels on all existing fixes.
6. [ ] **Secure the MQTT path** (highest-risk gap, see Known issues #1).
7. [ ] **CI**: GitHub Action running `npm --prefix web run typecheck`,
       `npm --prefix web run build` and `npm --prefix supabase/tests test` on every push.
8. [ ] **Remove legacy** once the web app is confirmed in use: `app.py`,
       tracked `__pycache__/`, generated `results/` and `dataset/derived.csv`
       (untrack + ignore), Streamlit deps in root `requirements.txt`.
9. [ ] **Web smoke tests** (Playwright, demo mode): login → dashboard → device
       page → scans → each admin page renders without errors.

## Feature ideas (not started)

Pick from here once the list above is done. Keep the farmer view read-only.

- **Alerts**: notify farm members when a new anomaly event appears (email via
  Supabase, later SMS/WhatsApp, e.g. Africa's Talking). Needs a `notifications`
  table + per-user preferences.
- **Geofence events**: a fix outside `farms.boundary` is an event even without
  a trained model. Pure SQL/TS, no ML needed. Highest-value next ML-adjacent
  task: the model only catches about half of strays (`docs/ML_BENCHMARK.md`).
- **Draw farm boundaries on the map** instead of pasting GeoJSON.
- **Swahili translation** of farmer-facing text.
- **Installable PWA** for farmers (offline shell, home-screen icon).
- **Scan history per farm** for admins, with filters by condition/urgency.
- **Model quality page**: anomaly rate per device over time, so drift is visible.

## Known issues and tech debt

1. **MQTT is open.** `bridge.py` subscribes to `watchbird/device/location` on
   *public* brokers (HiveMQ, Mosquitto, Eclipse). Anyone can publish fake fixes
   that get written to `"Data"`. Fix: private broker with credentials (e.g.
   HiveMQ Cloud free tier), and in `bridge.py` reject payloads whose
   `Device_id` isn't in `"Devices"` or whose coordinates are invalid.
2. **Firmware secrets**: Wi-Fi SSID/password are hard-coded in `tracker*.cpp`
   (and in git history). Move to a git-ignored `secrets.h`.
3. **Firmware timezone**: timestamps are formatted with a fixed `+03:00`.
4. **ML jobs are in-process** (`BackgroundTasks`). If the service restarts
   mid-job the row stays `running` forever. Fine for a demo; a real queue later.
5. **`train.py` is legacy** (65 KB, writes CSVs/plots to disk, imports
   matplotlib/seaborn/folium at top level). It works; refactor only with tests.
6. **Free Render sleeps**: the bridge stops while asleep, so fixes sent then are lost.
7. **Phone tracker needs HTTPS** and a screen kept on; it is a demo tool, not production tracking.

## Decision log

Newest last. Don't reverse one of these without the user's say-so.

| Decision | Why |
| --- | --- |
| Keep `"Devices"`/`"Data"` names and columns as-is | ESP32 payload, `bridge.py` and `train.py` depend on them; the live DB already has them (ids are **bigint**). |
| Migration is one idempotent file | It must run on both a fresh project and the live one, and be safe to re-run. |
| Permissions enforced in both pages and RLS | UI checks can be bypassed; Postgres can't. Farmers are read-only by design (the user's requirement). |
| Own unsupervised model for movement anomalies, not Hugging Face | No HF model does GPS-trajectory anomalies, and there are no labelled anomalies to fine-tune on. |
| Hugging Face VLM (+ optional PlantVillage classifier) for photo scans | Gives farmer-readable, structured advice; model names are env-configurable because HF availability changes. |
| Next.js + plain CSS tokens, no UI library | Matches the user's portfolio stack; keeps the design hand-made (user asked for "no AI slop"). |
| MapLibre with ESRI satellite / CARTO raster tiles | No map API key needed; same imagery the old Folium map used. |
| Palette "canopy & sprout", rounded pills, Outfit/Figtree/Geist Mono | User rejected the portfolio's colours, then asked for smoother shapes and fonts. Don't bring back square corners or all-caps condensed type. |
| Demo mode when Supabase env is missing | Lets anyone preview the UI and lets agents test pages without a backend. |
| All on Render free tier for the demo | User's choice: Render's "waking up" page beats a silent cold start. Bridge runs inside the ML service to avoid a paid worker. |
| Models in Supabase Storage bucket `models` | Render's free disk is wiped on restart. |
| ML service fails closed without `ML_SERVICE_SECRET` | It's on a public URL. |
| Phone tracker is admin-only | Writing telemetry is "control"; farmers only get insights. |
| v2 model: Local Outlier Factor (50 neighbours), threshold q=0.99, replaces train.py's IsolationForest | Benchmark (`docs/ML_BENCHMARK.md`, held-out): livestock recall 0.86 vs 0.71 with 4.5x fewer false alarms; catches "stopped moving" (0.93 vs 0.02). Trade-off: misses more strays (0.50 vs 0.85), which geofencing should cover. Chosen over IF/GMM/robust-z/ensemble by recall at <= 4 false alarms per 1k fixes. |
| One model per group by default; per device is opt-in | The user expected per-device models to win; the benchmark found them equal or worse, because the features are already relative to each device's own routine and per-device models see less data. New devices also need ~3 days of data first. |
