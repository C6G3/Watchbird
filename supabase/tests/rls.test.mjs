// Applies the migration to a fresh in-memory Postgres (PGlite) with Supabase's
// auth/storage stubbed, then checks who can read and write what.
// Run: npm --prefix supabase/tests test
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const migration = readFileSync(process.argv[2] ?? new URL("../migrations/20261103000000_init.sql", import.meta.url), "utf8");

// Minimal stand-ins for what Supabase provides.
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  grant usage on schema storage to authenticated;
  grant all on storage.objects to authenticated; grant usage on all sequences in schema storage to authenticated;
  create publication supabase_realtime;
`);
await db.exec(migration);
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;
  revoke update on public.profiles from authenticated; grant update (full_name) on public.profiles to authenticated;`);
console.log("migration applied");

const A = "00000000-0000-0000-0000-00000000000a";
const F1 = "00000000-0000-0000-0000-0000000000f1";
const F2 = "00000000-0000-0000-0000-0000000000f2";
await db.exec(`
  insert into auth.users values ('${A}','admin@x.io','{"full_name":"Ada"}'), ('${F1}','f1@x.io','{}'), ('${F2}','f2@x.io','{}');
  update public.profiles set role = 'admin' where id = '${A}';
  insert into public.farms (id, name) values ('11111111-1111-1111-1111-111111111111','North'), ('22222222-2222-2222-2222-222222222222','South');
  insert into public.farm_members values ('11111111-1111-1111-1111-111111111111','${F1}');
  insert into public."Devices" ("Device_id","Device_name",farm_id) values (1,'wb_1','11111111-1111-1111-1111-111111111111'), (2,'wb_2','22222222-2222-2222-2222-222222222222');
  insert into public."Data" ("Device_id","Timestamp","Latitude","Longitude") values (1, now(), -0.4, 36.9), (2, now(), -0.3, 36.8);
`);

const as = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query(sql)).rows;
  } catch (e) {
    return `ERROR: ${e.message}`;
  } finally {
    await db.exec("reset role;");
  }
};
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

check("profile trigger copied full_name", (await db.query(`select full_name from profiles where id='${A}'`)).rows, [{ full_name: "Ada" }]);
check("farmer1 sees only own farm's device", await as(F1, `select "Device_id" from "Devices" order by 1`), [{ Device_id: 1 }]);
check("farmer1 sees only own farm's data", await as(F1, `select "Device_id" from "Data"`), [{ Device_id: 1 }]);
check("farmer2 (no farm) sees no devices", await as(F2, `select "Device_id" from "Devices"`), []);
check("admin sees all devices", await as(A, `select "Device_id" from "Devices" order by 1`), [{ Device_id: 1 }, { Device_id: 2 }]);
check("last_seen view respects RLS", await as(F1, `select "Device_id" from device_last_seen`), [{ Device_id: 1 }]);
check("farmer cannot edit devices", await as(F1, `update "Devices" set "Device_name"='x' returning 1`), []);
check("farmer cannot insert telemetry", typeof (await as(F1, `insert into "Data" ("Device_id","Timestamp","Latitude","Longitude") values (1, now(), 0, 0)`)) === "string", true);
check("farmer cannot self-promote (column grant)", String(await as(F1, `update profiles set role='admin' where id='${F1}'`)).startsWith("ERROR"), true);
check("farmer cannot call set_user_role", String(await as(F1, `select set_user_role('${F1}','admin')`)).includes("only admins"), true);
check("farmer can rename self", await as(F1, `update profiles set full_name='Wanjiru' where id='${F1}' returning full_name`), [{ full_name: "Wanjiru" }]);
check("admin can promote", await as(A, `select set_user_role('${F2}','admin')::text as r`), [{ r: "" }]);
check("farmer can insert own scan", (await as(F1, `insert into scans (user_id, image_path, farm_id) values ('${F1}','${F1}/a.jpg','11111111-1111-1111-1111-111111111111') returning subject`)), [{ subject: "crop" }]);
check("farmer cannot scan into other farm", String(await as(F1, `insert into scans (user_id, image_path, farm_id) values ('${F1}','${F1}/b.jpg','22222222-2222-2222-2222-222222222222')`)).startsWith("ERROR"), true);
check("storage: own folder upload ok", await as(F1, `insert into storage.objects (bucket_id, name) values ('scans','${F1}/a.jpg') returning name`), [{ name: `${F1}/a.jpg` }]);
check("storage: other folder upload blocked", String(await as(F1, `insert into storage.objects (bucket_id, name) values ('scans','${A}/a.jpg')`)).includes("row-level security"), true);
check("anomaly RPC blocked for users", String(await as(F1, `select apply_anomaly_labels('[]')`)).startsWith("ERROR"), true);
await db.exec("reset role; set role service_role;");
check("service role applies labels", (await db.query(`select apply_anomaly_labels('[{"Id":1,"Anomaly":-1,"anomaly_score":-0.6}]') as n`)).rows, [{ n: 1 }]);
await db.exec("reset role;");
check("label written", (await db.query(`select "Anomaly", scored_at is not null as s from "Data" where "Id"=1`)).rows, [{ Anomaly: -1, s: true }]);
