"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";

export type ActionResult = { ok?: string; error?: string } | null;
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/**
 * onSubmit handler that sends the form to `dispatch` (from useActionState) without
 * React's automatic form reset, so what the user typed survives an error.
 */
export function keepValuesOnSubmit(dispatch: (data: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(data));
  };
}

/** A form bound to a server action, with inline pending/success/error feedback. Clears only on success. */
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
  const form = useRef<HTMLFormElement>(null);
  const send = keepValuesOnSubmit(formAction);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const btn =
    variant === "solid" ? "btn btn--solid" : variant === "danger" ? "btn btn--sm btn--danger" : variant === "small" ? "btn btn--sm" : "btn";

  return (
    <form
      ref={form}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) return e.preventDefault();
        send(e);
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
