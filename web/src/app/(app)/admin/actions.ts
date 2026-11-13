"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/ActionForm";
import { isDemo } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

// Every admin mutation runs as the signed-in admin; RLS checks is_admin() again.

const DEMO: ActionResult = { error: "Demo mode: connect Supabase to save changes." };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function guard() {
  await requireAdmin();
  return isDemo ? null : createSupabaseServer();
}

// ---- Devices ---------------------------------------------------------------

export async function saveDevice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const id = Number(str(f, "id"));
  const name = str(f, "name");
  if (!Number.isInteger(id) || id <= 0) return { error: "Device ID must be a positive whole number (it's flashed into the firmware)." };
  if (!name) return { error: "Give the device a name." };
  const color = str(f, "color") || "#34b36b";
  const { error } = await supabase.from("Devices").upsert({
    Device_id: id,
    Device_name: name,
    Status: str(f, "status") || "Active",
    Color_1: color,
    Color_2: color,
    IF_model: str(f, "model") || null,
    farm_id: str(f, "farm_id") || null,
    kind: str(f, "kind") || "tracker",
    notes: str(f, "notes") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}

export async function deleteDevice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const { error } = await supabase.from("Devices").delete().eq("Device_id", Number(str(f, "id")));
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Deleted" };
}

// ---- Farms -----------------------------------------------------------------

export async function saveFarm(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const name = str(f, "name");
  if (!name) return { error: "Give the farm a name." };

  let boundary: unknown = null;
  const raw = str(f, "boundary");
  if (raw) {
    try {
      boundary = JSON.parse(raw);
      if ((boundary as { type?: string }).type !== "Polygon") throw new Error();
    } catch {
      return { error: 'Boundary must be a GeoJSON Polygon, e.g. {"type":"Polygon","coordinates":[[[lng,lat],…]]}' };
    }
  }
  const row = {
    name,
    location_name: str(f, "location_name") || null,
    center_lat: numOrNull(str(f, "center_lat")),
    center_lng: numOrNull(str(f, "center_lng")),
    boundary,
  };
  const id = str(f, "id");
  const { error } = id ? await supabase.from("farms").update(row).eq("id", id) : await supabase.from("farms").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}

export async function deleteFarm(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const { error } = await supabase.from("farms").delete().eq("id", str(f, "id"));
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Deleted" };
}

// ---- People ----------------------------------------------------------------

export async function setRole(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const { error } = await supabase.rpc("set_user_role", { target: str(f, "user_id"), new_role: str(f, "role") });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: "Role updated" };
}

export async function setFarms(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await guard();
  if (!supabase) return DEMO;
  const userId = str(f, "user_id");
  const farmIds = f.getAll("farm_id").map(String);
  const del = await supabase.from("farm_members").delete().eq("user_id", userId);
  if (del.error) return { error: del.error.message };
  if (farmIds.length) {
    const ins = await supabase.from("farm_members").insert(farmIds.map((farm_id) => ({ farm_id, user_id: userId })));
    if (ins.error) return { error: ins.error.message };
  }
  revalidatePath("/admin/users");
  return { ok: "Farms updated" };
}

// ---- Models (delegated to ml/service.py) -----------------------------------

async function callMl(path: string, body: unknown) {
  const url = process.env.ML_SERVICE_URL;
  if (!url) throw new Error("ML_SERVICE_URL is not set. Start ml/service.py and add its URL to .env.local.");
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ML-Secret": process.env.ML_SERVICE_SECRET ?? "" },
    body: JSON.stringify(body),
    // A free Render instance takes ~30–60 s to wake from sleep before it answers.
    signal: AbortSignal.timeout(90_000),
  }).catch((e: Error) => {
    throw new Error(e.name === "TimeoutError" ? "ML service didn't wake up within 90 s. Try again in a minute." : e.message);
  });
  if (!res.ok) throw new Error(`ML service answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

async function queueJob(kind: "train" | "monitor", payload: Record<string, unknown>): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (isDemo) return DEMO;
  const supabase = await createSupabaseServer();
  const { data: job, error } = await supabase
    .from("ml_jobs")
    .insert({ kind, payload, requested_by: viewer.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  try {
    await callMl(`/jobs/${job.id}/run`, {});
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/admin/models");
  return { ok: kind === "train" ? "Training started" : "Detection started" };
}

export async function trainModel(_: ActionResult, f: FormData): Promise<ActionResult> {
  const name = str(f, "model_name");
  const deviceIds = f.getAll("device_id").map(Number).filter(Number.isInteger);
  if (!/^[a-z0-9_-]{2,40}$/i.test(name)) return { error: "Model name: 2–40 letters, digits, - or _." };
  if (!deviceIds.length) return { error: "Pick at least one device to learn from." };
  return queueJob("train", {
    model_name: name,
    device_ids: deviceIds,
    assign: f.get("assign") === "on",
    per_device: f.get("per_device") === "on",
  });
}

export async function runDetection(_: ActionResult, f: FormData): Promise<ActionResult> {
  const deviceIds = f.getAll("device_id").map(Number).filter(Number.isInteger);
  return queueJob("monitor", deviceIds.length ? { device_ids: deviceIds } : {});
}
