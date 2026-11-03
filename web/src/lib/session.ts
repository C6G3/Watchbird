import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, isDemo } from "./env";
import { createSupabaseServer } from "./supabase/server";
import { demoMembers } from "./demo";
import type { Viewer } from "./types";

/** The signed-in user and their role, or null. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (isDemo) {
    const role = (await cookies()).get(DEMO_COOKIE)?.value;
    const member = demoMembers.find((m) => m.role === role);
    if (!member) return null;
    return { id: member.id, email: member.email, name: member.full_name ?? member.email, role: member.role, demo: true };
  }

  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role")
    .eq("id", data.user.id)
    .single();

  return {
    id: data.user.id,
    email: profile?.email ?? data.user.email ?? "",
    name: profile?.full_name || profile?.email || data.user.email || "",
    role: profile?.role ?? "farmer",
    demo: false,
  };
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export async function requireAdmin() {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") redirect("/dashboard");
  return viewer;
}
