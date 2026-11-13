"use client";

import Link from "next/link";
import { useActionState } from "react";
import { keepValuesOnSubmit } from "@/components/ActionForm";
import PasswordInput from "@/components/PasswordInput";
import { requestReset, signIn, signUp, type AuthState } from "./actions";

export type AuthMode = "signin" | "signup" | "forgot";

const COPY: Record<AuthMode, { idx: string; eyebrow: string; title: string; submit: string }> = {
  signin: { idx: "01", eyebrow: "Sign in", title: "Back to the field", submit: "Sign in" },
  signup: { idx: "02", eyebrow: "Create account", title: "Join your farm", submit: "Create account" },
  forgot: { idx: "03", eyebrow: "Reset password", title: "Forgot your password?", submit: "Send reset link" },
};
const ACTIONS = { signin: signIn, signup: signUp, forgot: requestReset };

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(ACTIONS[mode], {});
  const copy = COPY[mode];

  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="auth__form" noValidate>
      <span className="eyebrow">
        <b>{copy.idx}</b>
        {copy.eyebrow}
      </span>
      <h2 className="display">{copy.title}</h2>
      {mode === "forgot" ? (
        <p className="muted">Enter your email and we&apos;ll send a link to choose a new password.</p>
      ) : null}

      {mode === "signup" ? (
        <label className="field">
          <span className="label">Full name</span>
          <input className="input" name="name" autoComplete="name" required />
        </label>
      ) : null}
      <label className="field">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      {mode !== "forgot" ? (
        <label className="field">
          <span className="label">Password</span>
          <PasswordInput name="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </label>
      ) : null}
      {mode === "signup" ? (
        <label className="field">
          <span className="label">Confirm password</span>
          <PasswordInput name="confirm" autoComplete="new-password" />
        </label>
      ) : null}

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="notice notice--ok" role="status">{state.message}</p> : null}

      <button className="btn btn--solid btn--block" disabled={pending}>
        {pending ? "One moment…" : copy.submit}
      </button>

      <p className="auth__switch">
        {mode === "signin" ? (
          <>
            <Link href="/login?mode=forgot">Forgot your password?</Link>
            <br />
            New here? <Link href="/login?mode=signup">Create an account</Link>
          </>
        ) : mode === "signup" ? (
          <>Already have an account? <Link href="/login">Sign in</Link></>
        ) : (
          <>Remembered it? <Link href="/login">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
