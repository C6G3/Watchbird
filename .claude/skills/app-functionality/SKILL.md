---
name: app-functionality
description: What the Watchbird app does for each role and how each feature works end to end — auth and roles, the farm dashboard and map, anomaly events, tracker pages, photo scans with Hugging Face, the admin panel (devices, farms, people, models), the ML jobs, and demo mode. Use when building or changing a feature, answering "how does X work", writing user-facing copy, or checking that a change respects the farmer/admin permission split.
---

# Watchbird app functionality

## Roles

| | Farmer | Admin |
| --- | --- | --- |
| Sees | Only farms they're a member of, and those farms' devices + telemetry | Everything |
| Can change | Their own name; their own photo scans | Devices, farms, memberships, roles, models, jobs |
| Nav | Overview, Photo scans | + Devices, Farms, People, Models, Phone tracker |

Enforced twice: pages call `requireViewer()` / `requireAdmin()`
(`web/src/lib/session.ts`), and Postgres RLS (`supabase/migrations/*`) via
`is_admin()`, `is_farm_member()`, `can_see_device()`. **Never rely on the UI
alone** — any new table needs RLS policies, and a farmer must stay read-only.
Role changes only go through the `set_user_role()` RPC (users have a column
grant on `full_name` only, so they can't promote themselves).

## Auth

- Email + password via Supabase Auth (`app/login/actions.ts`). Sign-up stores
  `full_name` in user metadata; the `on_auth_user_created` trigger creates the
  `profiles` row as `farmer`. Confirmation links land on `/auth/callback`.
- New farmers see an empty-state dashboard until an admin links them to a farm
  (Admin → People).
- First admin: `update public.profiles set role = 'admin' where email = '…';`
- `proxy.ts` only refreshes cookies and redirects signed-out users; it is not authorization.

## Dashboard (`/dashboard`)

- Stats: trackers reporting (fix < 1 h old), anomaly events in 24 h,
  distance in 24 h, last fix time. Admins with several farms get a farm filter (`?farm=`).
- Map (`FieldMap`): satellite or plain basemap (plain follows the theme), farm
  boundary (GeoJSON Polygon on `farms.boundary`), one coloured track per device
  (`"Devices"."Color_1"`), rust rings on anomalous fixes, labelled last-fix
  marker. Clicking a fix opens a popup and selects the device; selecting dims others.
- Field notes: anomalous fixes grouped into **events** (`lib/geo.ts`
  `anomalyEvents`): consecutive `-1` fixes ≤ 900 s apart, ≥ 2 fixes, matching
  `train.Config.EVENT_GAP_THRESHOLD` / `MIN_EVENT_SIZE`. Each event is written
  in plain language with how far the device strayed from its usual position
  (median of normal fixes). Keep these sentences farmer-readable.
- Live: `LiveRefresh` subscribes to realtime changes on `"Data"` and calls
  `router.refresh()` at most every 10 s.

## Tracker page (`/devices/[id]`)

Last fix, 24 h distance, event count and % flagged, assigned model; map of the
track; speed sparkline with rust ticks at flagged fixes; altitude sparkline;
event list with coordinates; datasheet (attached to, usual/last position, notes).

## Photo scans (`/scans`)

1. Farmer drops, takes (`capture="environment"`) or **pastes a screenshot**;
   the browser downsizes to ≤ 1280 px JPEG.
2. Picks subject (crop / livestock / soil / other), optional note, farm.
3. `POST /api/scans`: upload to `scans/{user_id}/{uuid}.jpg` (storage RLS:
   own folder), insert `scans` row as the user, then run `analysePhoto`.
4. `lib/insights.ts`: for crops, an optional image classifier
   (`HF_PLANT_CLASSIFIER`, PlantVillage labels) → its top-3 labels are given
   as a hint to a vision-language model (`HF_VISION_MODEL`, default
   `Qwen/Qwen2.5-VL-7B-Instruct`) via the HF router's OpenAI-compatible
   `/v1/chat/completions`. The VLM must answer JSON matching `Insight`
   (`title, condition, urgency, confidence, summary, findings[], actions[]`).
   `parseInsight` clamps/validates it.
5. Result is written with the service-role client (farmers have no UPDATE on
   `scans`). Failures set `status='failed'` + `error`, shown on the scan page.

Insights are guidance, not diagnosis — keep the disclaimer in `InsightView`.

## Admin

- **Devices** (`/admin/devices`): expandable rows; edit name, farm, kind,
  model, status, colour, notes; register new (ID must equal the firmware's
  `Device_id`); delete (cascades telemetry).
- **Farms**: name, location, centre lat/lng, optional boundary GeoJSON.
- **People**: change role, tick farm memberships.
- **Models**: train (name + devices to learn from + "assign when done"),
  run detection now, registry (`ml_models`), job log (`ml_jobs`). Shows ML
  service health from `GET {ML_SERVICE_URL}/health`.

All mutations live in `app/(app)/admin/actions.ts`, return `{ok}|{error}`,
and render through `components/ActionForm.tsx`.

## Phone tracker (`/admin/track`)

Admin-only demo stand-in for an ESP32. `components/PhoneTracker.tsx` uses
`navigator.geolocation.watchPosition` (high accuracy) and queues one fix per
interval (5/15/30 s), then POSTs batches to `/api/track`. The route checks the
viewer is admin and the device exists (RLS), then inserts into `"Data"` with
the service role, same columns as `bridge.py`. Fixes queue in memory while
offline (cap 500) and flush on reconnect. A Screen Wake Lock keeps the phone
awake (re-acquired on `visibilitychange`). Needs a secure context (HTTPS).
Demo mode accepts fixes without saving.

## ML jobs (`ml/service.py`)

- Web inserts an `ml_jobs` row as the admin, then POSTs
  `/jobs/{id}/run` with header `X-ML-Secret`. The service marks it running, then done/failed with `result`.
- **train**: pulls the devices' fixes → `dataset/db_csv.compute_features` →
  `train.run_pipeline(model_name=…)` → `models/<name>.pkl` + `_Scaler.pkl`
  → upserts `ml_models` → optionally sets `"Devices"."IF_model"`.
- **monitor**: for each device with a model, take unscored fixes plus 20
  fixes of scored history for rolling-window context → `train.build_features`
  → `model.predict` (the model's own contamination threshold, not a per-batch
  quantile) → `filter_isolated_anomalies` → `apply_anomaly_labels` RPC.
- `POST /monitor` runs a synchronous pass, for a cron/Task Scheduler entry.
- Every endpoint except `/health` requires `ML_SERVICE_SECRET` (fails closed if unset).
- Models are uploaded to the private `models` bucket after training and
  downloaded into `models/` on first use, so a throwaway disk is fine.
- On Render (`render.yaml`) the service also runs the MQTT bridge
  (`RUN_BRIDGE=1`) and scores every 10 min (`MONITOR_INTERVAL_MIN`). Free
  instances sleep: the web app waits up to 90 s for it to wake on admin actions.

## Demo mode

If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset the
whole app runs on `lib/demo.ts` (a synthetic farm near DeKUT). Login shows
"Enter as farmer / admin" (cookie `wb_demo_role`), a banner says DEMO,
admin actions return "Demo mode: connect Supabase to save changes.", and
scans still call Hugging Face if `HF_TOKEN` is set (results not stored).
When adding a query to `lib/data.ts`, add its demo branch too.

## Themes

Light ("field paper") / dark ("night field") / auto. `ThemeToggle` sets
`data-theme` on `<html>` + `localStorage["wb-theme"]`; an inline script in
`app/layout.tsx` applies it before paint. `useResolvedTheme()` gives the
effective theme to client code (the map uses it to swap plain tiles).
