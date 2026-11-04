"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, isDemo } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

// Supabase error codes -> plain language. Anything unknown falls back to Supabase's own text.
const FRIENDLY: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  email_not_confirmed: "Confirm your email first: open the link we sent you, then sign in.",
  over_email_send_rate_limit:
    "We've sent too many emails in the last hour. Try again later, or ask your admin to set up the email service.",
  email_address_not_authorized:
    "This address can't receive email from Watchbird yet. Ask your admin to set up the email service.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  user_already_exists: "There's already an account with that email. Sign in instead.",
  email_exists: "There's already an account with that email. Sign in instead.",
  weak_password: "That password is too easy to guess. Try a longer one.",
};
const friendly = (error: { code?: string; message: string }) => FRIENDLY[error.code ?? ""] ?? error.message;

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error) };
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
  if (error) return { error: friendly(error) };
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
  // Only limits are reported; other errors would reveal whether the account exists.
  if (error?.status === 429) return { error: friendly(error) };
  // Same answer whether or not the account exists, so the form can't be used to find accounts.
  return { message: `If ${email} has an account, a reset link is on its way. Open it in this browser.` };
}

export async function enterDemo(role: "admin" | "farmer") {
  if (!isDemo) return;
  (await cookies()).set(DEMO_COOKIE, role, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
  redirect("/dashboard");
}
