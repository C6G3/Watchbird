"use client";

import { useState } from "react";

/** Password field with an eye button that shows or hides what was typed. */
export default function PasswordInput({
  name,
  autoComplete,
}: {
  name: string;
  autoComplete: "current-password" | "new-password";
}) {
  const [shown, setShown] = useState(false);

  return (
    <span className="pw">
      <input
        className="input"
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        minLength={8}
        required
      />
      <button
        type="button"
        className="pw__eye"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        onClick={() => setShown((s) => !s)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="2" />
          {shown ? null : <path d="M2.5 13.5 13.5 2.5" />}
        </svg>
      </button>
    </span>
  );
}
