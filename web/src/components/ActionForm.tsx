"use client";

import { useActionState } from "react";

export type ActionResult = { ok?: string; error?: string } | null;
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/** A form bound to a server action, with inline pending/success/error feedback. */
export default function ActionForm({
  action,
  submit,
  children,
  className,
  variant = "solid",
  confirm,
}: {
  action: Action;
  submit: string;
  children?: React.ReactNode;
  className?: string;
  variant?: "solid" | "plain" | "danger" | "small";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const btn =
    variant === "solid" ? "btn btn--solid" : variant === "danger" ? "btn btn--sm btn--danger" : variant === "small" ? "btn btn--sm" : "btn";

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button className={btn} disabled={pending}>
        {pending ? "Saving…" : submit}
      </button>
      {state?.error ? <span className="notice notice--error" role="alert" style={{ gridColumn: "1 / -1" }}>{state.error}</span> : null}
      {state?.ok ? <span className="label" role="status" style={{ color: "var(--leaf)" }}>{state.ok}</span> : null}
    </form>
  );
}
