"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Choice = "light" | "dark" | "auto";

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

function resolved(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme actually on screen, following the toggle and the OS setting. */
export function useResolvedTheme() {
  return useSyncExternalStore(subscribe, resolved, () => "light" as const);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("auto");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setChoice(t === "light" || t === "dark" ? t : "auto");
  }, []);

  const apply = (next: Choice) => {
    setChoice(next);
    try {
      if (next === "auto") localStorage.removeItem("wb-theme");
      else localStorage.setItem("wb-theme", next);
    } catch {}
    if (next === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };

  return (
    <div className="seg seg--full" role="group" aria-label="Colour theme">
      {(["light", "dark", "auto"] as const).map((c) => (
        <button key={c} type="button" aria-pressed={choice === c} onClick={() => apply(c)}>
          {c[0].toUpperCase() + c.slice(1)}
        </button>
      ))}
    </div>
  );
}
