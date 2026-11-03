import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Contours from "@/components/Contours";
import Mark from "@/components/Mark";
import { ThemeToggle } from "@/components/theme";
import { isDemo } from "@/lib/env";
import { getViewer } from "@/lib/session";
import AuthForm from "./AuthForm";
import { enterDemo } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  if (await getViewer()) redirect("/dashboard");
  const { mode, error } = await searchParams;

  return (
    <div className="auth">
      <section className="auth__art">
        <Contours />
        <div className="auth__art-top">
          <span className="wordmark display">
            <Mark />
            Watchbird
          </span>
          <span className="label">0.398° S · 36.962° E</span>
        </div>
        <div className="auth__art-copy">
          <span className="eyebrow">
            <b>Field telemetry</b> GPS trackers · movement anomalies · photo diagnostics
          </span>
          <h1 className="display">Know your field.</h1>
          <p>
            Every tracker on your farm on one map, with a model that flags unusual movement and a camera that reads
            your crops and animals.
          </p>
        </div>
      </section>

      <section className="auth__panel">
        {isDemo ? (
          <div className="auth__form">
            <span className="eyebrow">
              <b>Demo</b> Supabase not configured
            </span>
            <h2 className="display">Look around</h2>
            <p className="muted">
              No backend is connected yet, so the app is running on a synthetic farm near DeKUT. Pick a role to see what
              it shows.
            </p>
            <form action={enterDemo.bind(null, "farmer")}>
              <button className="btn btn--solid btn--block">Enter as farmer</button>
            </form>
            <form action={enterDemo.bind(null, "admin")}>
              <button className="btn btn--block">Enter as admin</button>
            </form>
          </div>
        ) : (
          <>
            {error ? <p className="notice notice--error auth__form">That sign-in link has expired. Try again.</p> : null}
            <AuthForm mode={mode === "signup" ? "signup" : "signin"} />
          </>
        )}
        <div className="auth__form" style={{ marginTop: 40 }}>
          <ThemeToggle />
        </div>
      </section>
    </div>
  );
}
