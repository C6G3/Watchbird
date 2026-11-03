"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export default function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signin" ? signIn : signUp, {});

  return (
    <form action={action} className="auth__form" noValidate>
      <span className="eyebrow">
        <b>{mode === "signin" ? "01" : "02"}</b>
        {mode === "signin" ? "Sign in" : "Create account"}
      </span>
      <h2 className="display">{mode === "signin" ? "Back to the field" : "Join your farm"}</h2>

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
      <label className="field">
        <span className="label">Password</span>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </label>

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="notice notice--ok" role="status">{state.message}</p> : null}

      <button className="btn btn--solid btn--block" disabled={pending}>
        {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <p className="auth__switch">
        {mode === "signin" ? (
          <>New here? <Link href="/login?mode=signup">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href="/login">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
