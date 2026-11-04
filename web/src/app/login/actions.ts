"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, isDemo } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message === "Invalid login credentials" ? "That email and password don't match." : error.message };
  redirect("/dashboard");
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!name || !email) return { error: "Enter your name and email." };
  if (password.length < 8) return { error: "Use at least 8 characters for the password." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/dashboard");
  return { message: `Check ${email} for a confirmation link. Your admin will then add you to your farm.` };
}

export async function requestReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email you signed up with." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/account?reset=1")}`,
  });
  if (error?.status === 429) return { error: "Too many requests. Wait a minute and try again." };
  // Same answer whether or not the account exists, so the form can't be used to find accounts.
  return { message: `If ${email} has an account, a reset link is on its way. Open it in this browser.` };
}

export async function enterDemo(role: "admin" | "farmer") {
  if (!isDemo) return;
  (await cookies()).set(DEMO_COOKIE, role, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
  redirect("/dashboard");
}
