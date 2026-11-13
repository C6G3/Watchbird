import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/lib/env";
import { analysePhoto, visionModel } from "@/lib/insights";
import { getViewer } from "@/lib/session";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase/server";
import type { ScanSubject } from "@/lib/types";

const SUBJECTS: ScanSubject[] = ["crop", "livestock", "soil", "other"];
const MAX_BYTES = 6 * 1024 * 1024;

// POST multipart: image, subject, note, farm_id?
// Stores the photo, runs the Hugging Face models, saves the insight.
// In demo mode nothing is stored; the insight is returned directly.
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await request.formData();
  const image = form.get("image");
  const subject = SUBJECTS.includes(form.get("subject") as ScanSubject) ? (form.get("subject") as ScanSubject) : "crop";
  const note = String(form.get("note") ?? "").slice(0, 500);
  const farmId = String(form.get("farm_id") ?? "") || null;

  if (!(image instanceof File) || !image.type.startsWith("image/")) {
    return NextResponse.json({ error: "Attach a photo (JPG, PNG or WebP)." }, { status: 400 });
  }
  if (image.size > MAX_BYTES) return NextResponse.json({ error: "Photo is over 6 MB. Try a smaller one." }, { status: 413 });
  const bytes = await image.arrayBuffer();

  if (isDemo) {
    try {
      const result = await analysePhoto(bytes, image.type, subject, note);
      return NextResponse.json({ demo: true, result, model: visionModel() });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  // Upload and insert as the user, so storage and table RLS both apply.
  const supabase = await createSupabaseServer();
  const ext = image.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `${viewer.id}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from("scans").upload(path, bytes, { contentType: image.type });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });

  const { data: scan, error } = await supabase
    .from("scans")
    .insert({ user_id: viewer.id, farm_id: farmId, image_path: path, subject, note: note || null, model: visionModel() })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Farmers can't update scans (no RLS update policy), so results are written with the service role.
  const admin = createSupabaseAdmin();
  try {
    const result = await analysePhoto(bytes, image.type, subject, note);
    await admin.from("scans").update({ status: "done", result }).eq("id", scan.id);
  } catch (e) {
    await admin.from("scans").update({ status: "failed", error: (e as Error).message }).eq("id", scan.id);
  }
  return NextResponse.json({ id: scan.id });
}
