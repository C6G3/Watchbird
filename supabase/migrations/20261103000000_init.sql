-- Watchbird schema.
--
-- Safe on BOTH a fresh project and the original Watchbird project: every
-- statement is idempotent. On the original project it keeps "Devices" and
-- "Data" and all their rows, only adding columns, and creates the new tables.
-- Re-running it is harmless.
--
-- "Devices" and "Data" keep their quoted legacy names and columns so the
-- ESP32 payload, bridge.py and train.py keep working unchanged. Everything
-- added for the web app (accounts, farms, scans, model registry) is snake_case.
--
-- Access model
--   admin        : sees and manages everything
--   farmer       : sees only farms they are a member of, and the devices and
--                  telemetry on those farms. Read-only, except their own scans.
--   anon         : nothing. (The old app read and wrote with the anon key;
--                  that access is removed below.)
--   service_role : bridge.py and ml/service.py. Bypasses RLS.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin create type public.user_role as enum ('admin', 'farmer');
exception when duplicate_object then null; end $$;
do $$ begin create type public.scan_status as enum ('pending', 'done', 'failed');
exception when duplicate_object then null; end $$;
do $$ begin create type public.job_kind as enum ('train', 'monitor');
exception when duplicate_object then null; end $$;
do $$ begin create type public.job_status as enum ('queued', 'running', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.user_role not null default 'farmer',
  created_at  timestamptz not null default now()
);

-- Every new auth user gets a farmer profile. Promote the first admin by hand:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already existed before this migration.
insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Farms
-- ---------------------------------------------------------------------------

create table if not exists public.farms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  location_name  text,
  center_lat     double precision,
  center_lng     double precision,
  -- Optional GeoJSON Polygon of the farm boundary, drawn on the map.
  boundary       jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.farm_members (
  farm_id     uuid not null references public.farms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create or replace function public.is_farm_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.farm_members where farm_id = target and user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Devices and telemetry (legacy names kept)
-- ---------------------------------------------------------------------------

-- Fresh projects get the full legacy shape; existing ones keep theirs.
create table if not exists public."Devices" (
  "Device_id"   int primary key,
  "Device_name" text not null unique,
  "Status"      text,
  "Color_1"     text,
  "Color_2"     text,
  "IF_model"    text
);

alter table public."Devices"
  add column if not exists farm_id    uuid references public.farms (id) on delete set null,
  add column if not exists kind       text not null default 'tracker', -- livestock, bird, asset, ...
  add column if not exists notes      text;
alter table public."Devices" alter column "Status"  set default 'Active';
alter table public."Devices" alter column "Color_1" set default '#34b36b';
alter table public."Devices" alter column "Color_2" set default '#34b36b';

create table if not exists public."Data" (
  "Id"         bigint generated by default as identity primary key,
  "Device_id"  int references public."Devices" ("Device_id") on delete cascade,
  "Timestamp"  timestamptz not null,
  "Latitude"   double precision not null,
  "Longitude"  double precision not null,
  "Altitude"   double precision,
  "Anomaly"    int default 1  -- 1 normal, -1 anomaly
);

alter table public."Data"
  add column if not exists speed_m_s     double precision,
  add column if not exists delta_alt     double precision,
  add column if not exists dt            double precision,
  add column if not exists distance_m    double precision,
  add column if not exists bearing       double precision,
  add column if not exists acceleration  double precision,
  add column if not exists anomaly_score double precision, -- null until the ML service scores the row
  add column if not exists scored_at     timestamptz;
alter table public."Data" alter column "Anomaly" set default 1;

create index if not exists data_device_time_idx on public."Data" ("Device_id", "Timestamp" desc);
create index if not exists data_unscored_idx on public."Data" ("Device_id", "Id") where scored_at is null;

-- bigint so it fits both a fresh project (int ids) and the original one (bigint ids).
drop function if exists public.can_see_device(int) cascade;
create or replace function public.can_see_device(target bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public."Devices" d
    join public.farm_members m on m.farm_id = d.farm_id
    where d."Device_id" = target and m.user_id = auth.uid()
  );
$$;

-- Bulk write of model output: [{"Id": 1, "Anomaly": -1, "anomaly_score": -0.61}, ...].
-- An UPDATE, not an upsert, because partial upserts trip the NOT NULL columns.
create or replace function public.apply_anomaly_labels(labels jsonb)
returns int
language sql
as $$
  with l as (
    select * from jsonb_to_recordset(labels) as x("Id" bigint, "Anomaly" int, anomaly_score double precision)
  ), u as (
    update public."Data" d
    set "Anomaly" = l."Anomaly", anomaly_score = l.anomaly_score, scored_at = now()
    from l
    where d."Id" = l."Id"
    returning 1
  )
  select count(*)::int from u;
$$;
revoke execute on function public.apply_anomaly_labels(jsonb) from public, anon, authenticated;
grant execute on function public.apply_anomaly_labels(jsonb) to service_role;

-- Latest fix per device, for the map and device list.
create or replace view public.device_last_seen
with (security_invoker = true) as
select distinct on ("Device_id")
  "Device_id", "Timestamp", "Latitude", "Longitude", "Altitude", "Anomaly"
from public."Data"
order by "Device_id", "Timestamp" desc;

-- ---------------------------------------------------------------------------
-- Photo scans (farmer uploads a picture, a Hugging Face model reads it)
-- ---------------------------------------------------------------------------

create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  farm_id     uuid references public.farms (id) on delete set null,
  image_path  text not null,               -- object key in the "scans" bucket
  subject     text not null default 'crop', -- crop | livestock | soil | other
  note        text,                         -- what the farmer typed alongside the photo
  status      public.scan_status not null default 'pending',
  model       text,
  result      jsonb,                        -- structured insight, see web/src/lib/insights.ts
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists scans_user_idx on public.scans (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Anomaly model registry and job log (written by ml/service.py)
-- ---------------------------------------------------------------------------

create table if not exists public.ml_models (
  name         text primary key,
  algorithm    text not null default 'isolation_forest',
  device_ids   int[] not null default '{}',
  params       jsonb not null default '{}',
  metrics      jsonb not null default '{}',
  trained_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null
);

-- Models the old Streamlit app assigned to devices, so the registry isn't empty.
insert into public.ml_models (name, device_ids)
select "IF_model", array_agg("Device_id"::int)
from public."Devices"
where coalesce("IF_model", '') <> ''
group by "IF_model"
on conflict (name) do nothing;

create table if not exists public.ml_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          public.job_kind not null,
  status        public.job_status not null default 'queued',
  payload       jsonb not null default '{}',
  result        jsonb,
  error         text,
  requested_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.farms        enable row level security;
alter table public.farm_members enable row level security;
alter table public."Devices"    enable row level security;
alter table public."Data"       enable row level security;
alter table public.scans        enable row level security;
alter table public.ml_models    enable row level security;
alter table public.ml_jobs      enable row level security;

-- Start from a clean slate on every Watchbird table, including any open
-- "allow anon" policies the Streamlit-era project had on "Devices"/"Data".
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'farms', 'farm_members', 'Devices', 'Data', 'scans', 'ml_models', 'ml_jobs')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: read your own, admins read all. Users may only change their name;
-- role changes go through set_user_role() so nobody can promote themselves.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create or replace function public.set_user_role(target uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only admins can change roles';
  end if;
  if target = auth.uid() and new_role <> 'admin' then
    raise exception 'admins cannot demote themselves';
  end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

-- farms
create policy farms_select on public.farms
  for select to authenticated using (public.is_admin() or public.is_farm_member(id));
create policy farms_admin_write on public.farms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- farm_members
create policy farm_members_select on public.farm_members
  for select to authenticated using (public.is_admin() or user_id = auth.uid());
create policy farm_members_admin_write on public.farm_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Devices
create policy devices_select on public."Devices"
  for select to authenticated using (public.can_see_device("Device_id"));
create policy devices_admin_write on public."Devices"
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Data: read follows the device. Writes come from the service role only.
create policy data_select on public."Data"
  for select to authenticated using (public.can_see_device("Device_id"));

-- scans: your own, admins see all.
create policy scans_select on public.scans
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy scans_insert_own on public.scans
  for insert to authenticated with check (
    user_id = auth.uid() and (farm_id is null or public.is_admin() or public.is_farm_member(farm_id))
  );
create policy scans_delete_own on public.scans
  for delete to authenticated using (user_id = auth.uid());

-- ml_*: admin read; jobs may be queued by admins, everything else is service role.
create policy ml_models_admin_select on public.ml_models
  for select to authenticated using (public.is_admin());
create policy ml_jobs_admin_select on public.ml_jobs
  for select to authenticated using (public.is_admin());
create policy ml_jobs_admin_insert on public.ml_jobs
  for insert to authenticated with check (public.is_admin() and requested_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private "scans" bucket, one folder per user ({user_id}/{file})
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

-- Trained anomaly models (<name>.pkl, <name>_Scaler.pkl). No policies on
-- purpose: only the service role (ml/service.py) can read or write them.
insert into storage.buckets (id, name, public)
values ('models', 'models', false)
on conflict (id) do nothing;

drop policy if exists scans_bucket_read on storage.objects;
drop policy if exists scans_bucket_insert on storage.objects;
drop policy if exists scans_bucket_delete on storage.objects;
create policy scans_bucket_read on storage.objects
  for select to authenticated using (
    bucket_id = 'scans' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy scans_bucket_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy scans_bucket_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Live map updates
-- ---------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public."Data";
exception when duplicate_object then null; end $$;
