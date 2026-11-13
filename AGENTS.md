# AGENTS.md: rules for anyone (human or AI) changing Watchbird

Watchbird is field telemetry for farms. ESP32 GPS trackers (or a phone) send
fixes into Supabase, an unsupervised model (`ml/`) flags unusual movement, and a Next.js
web app shows each farm on a map. Farmers read insights and scan photos;
admins manage everything.

## Read these first, in this order

1. This file. Follow every rule in it.
2. `docs/ROADMAP.md`: current status, the next task to do, the decision log.
3. `docs/CODEBASE_MAP.md`: where every file lives and the conventions that bite.
4. `docs/APP_FUNCTIONALITY.md`: how each feature works end to end.

If the user asks for something and you don't know where it goes, the answer is
in `docs/CODEBASE_MAP.md`. Don't guess file locations.

## Hard rules

### Never

1. **Never print, log, paste or commit secrets.** Real keys live only in
   `web/.env.local` and the root `.env` (both git-ignored). Don't `cat` them.
   Don't put keys in code, docs, commit messages or chat. `.env.example` files
   hold variable names only.
2. **Never rename `"Devices"` or `"Data"` or their columns** (`"Device_id"`,
   `"Timestamp"`, `"Latitude"`, `"Longitude"`, `"Altitude"`, `"Anomaly"`, `"Id"`).
   Firmware, `bridge.py` and `train.py` depend on them. Device ids are **bigint**
   in the live database.
3. **Never give farmers write access** to devices, farms, telemetry, models or
   other users. Farmers may only edit their own name and their own scans.
4. **Never trust the UI for permissions.** Every new table gets
   `enable row level security` plus policies in the migration.
5. **Never upsert partial `"Data"` rows.** Write anomaly labels only through
   `rpc("apply_anomaly_labels", { labels })`.
6. **Never run destructive SQL or a scoring pass on the live database** without
   the user saying yes in this conversation. Scoring overwrites existing labels.
7. **Never push, merge to `main`, or deploy** unless the user asks.
8. **Never add a UI component library, CSS framework or new font.** Use the
   tokens and classes in `web/src/app/globals.css`.
9. **Never delete `demo` branches** in `web/src/lib/data.ts`. The app must keep
   working with no Supabase env (demo mode).

### Always

1. **Change the database only by editing
   `supabase/migrations/20261103000000_init.sql`** (or adding a new numbered
   file), and keep every statement idempotent: `create table if not exists`,
   `add column if not exists`, `create or replace function`,
   `drop policy if exists` before `create policy`. Then run the schema tests
   (below). Tell the user to paste the file into the Supabase SQL editor; you
   can't run it on the live project yourself.
2. **Put every web data read in `web/src/lib/data.ts`**, with a demo branch
   that returns data from `web/src/lib/demo.ts`.
3. **Put every admin mutation in `web/src/app/(app)/admin/actions.ts`**:
   call `requireAdmin()` (via `guard()`), return `{ ok }` or `{ error }`, and
   render it with `components/ActionForm.tsx`.
4. **Gate pages** with `requireViewer()` or `requireAdmin()` from `web/src/lib/session.ts`.
5. **Await** `params`, `searchParams` and `cookies()` (Next.js 16).
6. **Update the docs in the same change**: `docs/CODEBASE_MAP.md` when files
   move or appear, `docs/APP_FUNCTIONALITY.md` when behaviour changes,
   `docs/ROADMAP.md` when a task is done or a decision is made.
7. **Ask the user** when a request conflicts with a rule here or with the
   decision log in `docs/ROADMAP.md`.

## Before you say a change is done

Run these from the repo root and fix every error. Report honestly what you ran
and what you didn't.

```bash
npm --prefix web run typecheck          # must print nothing
npm --prefix web run build              # must end with the route list
npm --prefix supabase/tests test        # only if you touched supabase/; every line must say PASS
python -m py_compile ml/service.py bridge.py db_operations.py supabase_config.py   # if you touched Python
```

For UI changes, run `npm --prefix web run dev`, open http://localhost:3000 and
look at the page in **both** light and dark mode and at phone width (375 px).
Without Supabase env vars the login page offers "Enter as farmer / admin".

## Recipes

### Add a signed-in page
1. Create `web/src/app/(app)/<name>/page.tsx` (admin-only: under `(app)/admin/`).
2. First line of the component: `const viewer = await requireViewer();` (or `requireAdmin()`).
3. Fetch through functions in `lib/data.ts`. Never call Supabase directly from a page.
4. Layout: `<div className="page">` → `<header className="page-head">` → panels
   (`<section className="panel">` with `panel__head` / `panel__body`).
5. Add it to the nav list in `web/src/components/AppShell.tsx`.

### Add a database table
1. Append to the migration: `create table if not exists …`, `alter table … enable row level security`,
   then policies (read: `is_admin()` or a membership check; write: `is_admin()` only unless it's the user's own row).
2. Add the table name to the list in the `drop policy` loop in the RLS section.
3. Add tests in `supabase/tests/rls.test.mjs` for who can and can't read/write it.
4. Run `npm --prefix supabase/tests test`.
5. Add the TS type to `web/src/lib/types.ts` and a query + demo branch to `lib/data.ts`.

### Change the anomaly model or scoring
Features are in `ml/features.py`, detectors in `ml/detectors.py`, the
train/score wrapper in `ml/pipeline.py`; `ml/service.py` only moves data. Every
feature must use only the current and earlier fixes (live scoring sees no future).
After any change run `python -m ml.benchmark` and only keep it if the held-out
table in `docs/ML_BENCHMARK.md` beats the previous one (recall up at the same or
fewer false alarms per 1k). Don't edit `train.py`; it is the legacy v1 path.
Labels are `1` normal / `-1` anomaly, written with `apply_anomaly_labels`.
Event grouping must match in Python (`ml/pipeline.py` `EVENT_GAP_S`,
`MIN_EVENT_SIZE`) and TypeScript (`web/src/lib/geo.ts`).

### Change what a tracker sends
The payload is `{Timestamp, Device_id, Latitude, Longitude, Altitude}` from
`tracker_stable_3.cpp` via `bridge.py`, and from `/api/track` for phones.
Change all three together, and the migration if a column is added.

## Design rules (the user cares about these)

- Hand-made, calm, "no AI slop". No gradients, glows, emoji, stock illustrations.
- Palette "canopy & sprout": `--leaf` is the accent, `--rust` means **anomaly
  only**, `--ochre` means warning. Never hard-code colours in components.
- Rounded and smooth: pills (`--pill`) for buttons/tags/toggles,
  `--r-md`/`--r-lg` for inputs and cards. No square corners, no all-caps labels.
- Fonts: Outfit (`.display`, headings, big numbers), Figtree (everything
  else), Geist Mono only for numbers and coordinates (`.num`).
- Show enum values with `cap()` from `lib/format.ts`. Write labels in sentence case.
- Farmer-facing text is plain language ("wb_3 left its usual range for 1 h").

## Commits

Work on a branch, not `main`. One logical change per commit, with a message
that says what and why. Check that `git status` shows no `.env` files before committing.
