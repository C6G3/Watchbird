"use server";

import type { ActionResult } from "@/components/ActionForm";
import { isDemo } from "@/lib/env";
import { requireViewer } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

// Self-service account changes. Any signed-in user, acting only on their own account.

export async function changePassword(_: ActionResult, f: FormData): Promise<ActionResult> {
  await requireViewer();
  if (isDemo) return { error: "Demo mode: there are no passwords to change." };
  const password = String(f.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for the password." };
  if (password !== String(f.get("confirm") ?? "")) return { error: "The two passwords don't match." };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  // Sign out every other browser and phone, in case the old password was known to someone else.
  await supabase.auth.signOut({ scope: "others" });
  return { ok: "Password changed. Other devices have been signed out." };
}
