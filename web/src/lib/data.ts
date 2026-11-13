import "server-only";
import { cache } from "react";
import { isDemo } from "./env";
import { createSupabaseServer } from "./supabase/server";
import { demoFarms, demoJobs, demoMembers, demoModels, demoScans, demoTracks } from "./demo";
import { anomalyEvents, EVENT_GAP_S, MIN_EVENT_SIZE } from "./geo";
import type { Device, DeviceTrack, Farm, Fix, Member, MlJob, MlModel, Scan, Viewer } from "./types";

// All reads go through here. With Supabase, RLS decides what the viewer can
// see; in demo mode the same rules are applied by hand.

type DeviceRow = {
  Device_id: number;
  Device_name: string;
  Status: string;
  Color_1: string | null;
  IF_model: string | null;
  farm_id: string | null;
  kind: string;
  notes: string | null;
};

type DataRow = {
  Id: number;
  Device_id: number;
  Timestamp: string;
  Latitude: number;
  Longitude: number;
  Altitude: number | null;
  Anomaly: number;
};

const toDevice = (r: DeviceRow): Device => ({
  id: r.Device_id,
  name: r.Device_name,
  status: r.Status?.trim() || "Inactive",
  color: r.Color_1 || "#34b36b",
  model: r.IF_model || null,
  farmId: r.farm_id,
  kind: r.kind,
  notes: r.notes,
});

const toFix = (r: DataRow): Fix => ({
  id: r.Id,
  deviceId: r.Device_id,
  t: r.Timestamp,
  lat: r.Latitude,
  lng: r.Longitude,
  alt: r.Altitude,
  anomaly: r.Anomaly === -1 ? -1 : 1,
});

function demoFarmIds(viewer: Viewer) {
  if (viewer.role === "admin") return null;
  return demoMembers.find((m) => m.id === viewer.id)?.farmIds ?? [];
}

export async function getFarms(viewer: Viewer): Promise<Farm[]> {
  if (isDemo) {
    const ids = demoFarmIds(viewer);
    return ids ? demoFarms.filter((f) => ids.includes(f.id)) : demoFarms;
  }
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from("farms").select("*").order("name");
  if (error) throw error;
  return data as Farm[];
}

export async function getDevices(viewer: Viewer): Promise<Device[]> {
  if (isDemo) {
    const ids = demoFarmIds(viewer);
    return demoTracks()
      .filter((d) => !ids || (d.farmId && ids.includes(d.farmId)))
      .map(({ fixes: _f, ...d }) => d);
  }
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from("Devices").select("*").order("Device_id");
  if (error) throw error;
  return (data as DeviceRow[]).map(toDevice);
}

/** Devices with their most recent `limit` fixes, oldest first. */
export async function getTracks(viewer: Viewer, opts: { farmId?: string; limit?: number } = {}): Promise<DeviceTrack[]> {
  const limit = opts.limit ?? 400;
  if (isDemo) {
    const ids = demoFarmIds(viewer);
    return demoTracks()
      .filter((d) => !ids || (d.farmId && ids.includes(d.farmId)))
      .filter((d) => !opts.farmId || d.farmId === opts.farmId)
      .map((d) => ({ ...d, fixes: d.fixes.slice(-limit) }));
  }

  const devices = (await getDevices(viewer)).filter((d) => !opts.farmId || d.farmId === opts.farmId);
  const supabase = await createSupabaseServer();
  return Promise.all(
    devices.map(async (device) => {
      const { data } = await supabase
        .from("Data")
        .select("Id, Device_id, Timestamp, Latitude, Longitude, Altitude, Anomaly")
        .eq("Device_id", device.id)
        .order("Timestamp", { ascending: false })
        .limit(limit);
      return { ...device, fixes: ((data ?? []) as DataRow[]).map(toFix).reverse() };
    }),
  );
}

/** getTracks memoised per request, so multiple callers on the same page share one fetch. */
export const getTracksCached = cache((viewer: Viewer, farmId: string | undefined, limit: number) =>
  getTracks(viewer, { farmId, limit }),
);

/** Total anomaly events across all visible devices in the last 24 h (used for the nav badge). */
export async function getAlertCount(viewer: Viewer): Promise<number> {
  const since = Date.now() - 24 * 3600_000;
  if (isDemo) {
    const ids = demoFarmIds(viewer);
    const tracks = demoTracks().filter((d) => !ids || (d.farmId && ids.includes(d.farmId)));
    return tracks.flatMap(anomalyEvents).filter((e) => Date.parse(e.end) >= since).length;
  }

  const supabase = await createSupabaseServer();
  const sinceIso = new Date(since).toISOString();
  const { data, error } = await supabase
    .from("Data")
    .select("Device_id, Timestamp")
    .eq("Anomaly", -1)
    .gte("Timestamp", sinceIso)
    .order("Timestamp", { ascending: true });

  if (error || !data || !data.length) return 0;

  const byDevice = new Map<number, number[]>();
  for (const row of data as { Device_id: number; Timestamp: string }[]) {
    const list = byDevice.get(row.Device_id) ?? [];
    list.push(Date.parse(row.Timestamp));
    byDevice.set(row.Device_id, list);
  }

  let count = 0;
  for (const timestamps of byDevice.values()) {
    let run = 0;
    let lastT = 0;
    for (const t of timestamps) {
      if (lastT && (t - lastT) / 1000 > EVENT_GAP_S) {
        if (run >= MIN_EVENT_SIZE) count++;
        run = 0;
      }
      run++;
      lastT = t;
    }
    if (run >= MIN_EVENT_SIZE) count++;
  }
  return count;
}

export const getAlertCountCached = cache((viewer: Viewer) => getAlertCount(viewer));

export async function getTrack(viewer: Viewer, deviceId: number, limit = 2000): Promise<DeviceTrack | null> {
  if (isDemo) return (await getTracks(viewer, { limit })).find((d) => d.id === deviceId) ?? null;
  const supabase = await createSupabaseServer();
  const { data: row } = await supabase.from("Devices").select("*").eq("Device_id", deviceId).maybeSingle();
  if (!row) return null;
  const { data } = await supabase
    .from("Data")
    .select("Id, Device_id, Timestamp, Latitude, Longitude, Altitude, Anomaly")
    .eq("Device_id", deviceId)
    .order("Timestamp", { ascending: false })
    .limit(limit);
  return { ...toDevice(row as DeviceRow), fixes: ((data ?? []) as DataRow[]).map(toFix).reverse() };
}

export async function getScans(viewer: Viewer): Promise<Scan[]> {
  if (isDemo) return demoScans.filter((s) => viewer.role === "admin" || s.user_id === viewer.id);
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("scans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return withImageUrls(data as (Omit<Scan, "imageUrl"> & { image_path: string })[]);
}

export async function getScan(viewer: Viewer, id: string): Promise<Scan | null> {
  if (isDemo) return (await getScans(viewer)).find((s) => s.id === id) ?? null;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("scans").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return (await withImageUrls([data]))[0];
}

async function withImageUrls(rows: (Omit<Scan, "imageUrl"> & { image_path: string })[]): Promise<Scan[]> {
  if (!rows.length) return [];
  const supabase = await createSupabaseServer();
  const { data } = await supabase.storage.from("scans").createSignedUrls(rows.map((r) => r.image_path), 3600);
  return rows.map(({ image_path, ...r }, i) => ({ ...r, imageUrl: data?.[i]?.signedUrl ?? null }));
}

// ---- Admin -----------------------------------------------------------------

export async function getMembers(): Promise<Member[]> {
  if (isDemo) return demoMembers;
  const supabase = await createSupabaseServer();
  const [{ data: profiles, error }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, created_at").order("created_at"),
    supabase.from("farm_members").select("farm_id, user_id"),
  ]);
  if (error) throw error;
  return (profiles ?? []).map((p) => ({
    ...(p as Omit<Member, "farmIds">),
    farmIds: (links ?? []).filter((l) => l.user_id === p.id).map((l) => l.farm_id as string),
  }));
}

export async function getModels(): Promise<MlModel[]> {
  if (isDemo) return demoModels;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("ml_models").select("*").order("trained_at", { ascending: false });
  return (data ?? []) as MlModel[];
}

export async function getJobs(): Promise<MlJob[]> {
  if (isDemo) return demoJobs;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("ml_jobs").select("*").order("created_at", { ascending: false }).limit(20);
  return (data ?? []) as MlJob[];
}
