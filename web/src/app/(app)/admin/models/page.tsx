import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { getDevices, getJobs, getModels } from "@/lib/data";
import { ago, cap, stamp } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { runDetection, trainModel } from "../actions";

export const metadata: Metadata = { title: "Models" };

const JOB = { queued: "", running: "tag--warn", done: "tag--ok", failed: "tag--alert" } as const;

async function mlStatus() {
  const url = process.env.ML_SERVICE_URL;
  if (!url) return "unset";
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  }
}

export default async function ModelsAdmin() {
  const viewer = await requireAdmin();
  const [models, jobs, devices, status] = await Promise.all([getModels(), getJobs(), getDevices(viewer), mlStatus()]);
  const deviceName = (id: number) => devices.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>A4</b> Manage <span>Isolation Forest · one model per herd or species</span>
          </span>
          <h1 className="display">Models</h1>
        </div>
        <div className="page-head__actions">
          <span className={`tag ${status === "up" ? "tag--ok" : "tag--warn"}`}>
            {status === "up" ? "ML service up" : status === "unset" ? "ML service not configured" : "ML service asleep or down"}
          </span>
        </div>
      </header>

      <div className="grid-2">
        <section className="panel">
          <div className="panel__head">
            <h2>
              <span>01</span>Train a model
            </h2>
          </div>
          <div className="panel__body">
            <ActionForm action={trainModel} submit="Train" className="scan-form">
              <label className="field">
                <span className="label">Model name</span>
                <input className="input" name="model_name" placeholder="cattle_kiganjo_v2" required />
              </label>
              <div className="field">
                <span className="label">Learn normal movement from</span>
                <div className="checks">
                  {devices.map((d) => (
                    <label key={d.id}>
                      <input type="checkbox" name="device_id" value={d.id} /> {d.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="checks">
                <label>
                  <input type="checkbox" name="assign" defaultChecked /> Assign to these devices when done
                </label>
              </div>
            </ActionForm>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>
              <span>02</span>Run detection
            </h2>
          </div>
          <div className="panel__body" style={{ display: "grid", gap: 14 }}>
            <p className="muted">
              Scores every fix that hasn&apos;t been scored yet with its device&apos;s model and writes the labels back.
              Leave everything unticked to run on every device that has a model.
            </p>
            <ActionForm action={runDetection} submit="Run now" variant="plain" className="scan-form">
              <div className="checks">
                {devices
                  .filter((d) => d.model)
                  .map((d) => (
                    <label key={d.id}>
                      <input type="checkbox" name="device_id" value={d.id} /> {d.name}{" "}
                      <span className="muted num">({d.model})</span>
                    </label>
                  ))}
              </div>
            </ActionForm>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>03</span>Registry
          </h2>
          <span className="label">{models.length} models</span>
        </div>
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>Model</th>
                <th>Trained on</th>
                <th>Used by</th>
                <th className="r">Samples</th>
                <th className="r">Anomaly rate</th>
                <th className="r">Trained</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.name}>
                  <td className="num">{m.name}</td>
                  <td>{m.device_ids.map(deviceName).join(", ")}</td>
                  <td>
                    {devices
                      .filter((d) => d.model === m.name)
                      .map((d) => d.name)
                      .join(", ") || <span className="muted">nobody</span>}
                  </td>
                  <td className="r num">{m.metrics.samples ?? "—"}</td>
                  <td className="r num">
                    {typeof m.metrics.anomaly_rate === "number" ? `${(m.metrics.anomaly_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="r num muted">{stamp(m.trained_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.length ? null : <p className="panel__empty">No models yet. Train one above.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>04</span>Job log
          </h2>
        </div>
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Details</th>
                <th className="r">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{cap(j.kind)}</td>
                  <td>
                    <span className={`tag ${JOB[j.status]}`}>{cap(j.status)}</span>
                  </td>
                  <td className="num muted">{j.error ?? JSON.stringify(j.result ?? j.payload)}</td>
                  <td className="r num muted">{ago(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length ? null : <p className="panel__empty">No jobs yet.</p>}
        </div>
      </section>
    </div>
  );
}
