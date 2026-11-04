import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/lib/env";
import { getViewer } from "@/lib/session";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase/server";

type Fix = { deviceId: number; t: string; lat: number; lng: number; alt: number | null; accuracy: number | null };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parse(raw: unknown): Fix | null {
  const f = raw as Partial<Fix>;
  if (!Number.isInteger(f.deviceId) || !finite(f.lat) || !finite(f.lng)) return null;
  if (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) return null;
  const t = typeof f.t === "string" && !Number.isNaN(Date.parse(f.t)) ? f.t : new Date().toISOString();
  // Reject clocks far in the future; queued fixes from a while ago are fine.
  if (Date.parse(t) > Date.now() + 5 * 60_000) return null;
  return {
    deviceId: f.deviceId!,
    t,
    lat: f.lat,
    lng: f.lng,
    alt: finite(f.alt) ? f.alt : null,
    accuracy: finite(f.accuracy) ? f.accuracy : null,
  };
}

// POST { fixes: Fix[] } from the phone tracker page. Stores them in "Data"
// exactly like bridge.py does for the ESP32 trackers. Admins only: writing
// telemetry is control, which farmers don't have.
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (viewer.role !== "admin") return NextResponse.json({ error: "Only admins can send tracker data." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { fixes?: unknown[] } | null;
  const fixes = (body?.fixes ?? []).slice(0, 200).map(parse);
  if (!fixes.length || fixes.some((f) => !f)) return NextResponse.json({ error: "Malformed fix." }, { status: 400 });
  const valid = fixes as Fix[];
  const deviceId = valid[0].deviceId;
  if (valid.some((f) => f.deviceId !== deviceId)) return NextResponse.json({ error: "One device per request." }, { status: 400 });

  if (isDemo) return NextResponse.json({ stored: valid.length, demo: true });

  // Check the device as the viewer (RLS), then write with the service role,
  // because "Data" has no insert policy for signed-in users.
  const supabase = await createSupabaseServer();
  const { data: device } = await supabase.from("Devices").select("Device_id").eq("Device_id", deviceId).maybeSingle();
  if (!device) return NextResponse.json({ error: `Device ${deviceId} is not registered.` }, { status: 404 });

  const { error } = await createSupabaseAdmin()
    .from("Data")
    .insert(
      valid.map((f) => ({
        Device_id: f.deviceId,
        Timestamp: f.t,
        Latitude: f.lat,
        Longitude: f.lng,
        Altitude: f.alt,
      })),
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stored: valid.length });
}
