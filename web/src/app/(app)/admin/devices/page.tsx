import type { Metadata } from "next";
import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import { getFarms, getModels, getTracksCached } from "@/lib/data";
import { ago } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import type { Device, Farm, MlModel } from "@/lib/types";
import { deleteDevice, saveDevice } from "../actions";

export const metadata: Metadata = { title: "Devices" };

function DeviceFields({ device, farms, models }: { device?: Device; farms: Farm[]; models: MlModel[] }) {
  return (
    <>
      <label className="field">
        <span className="label">Device ID</span>
        <input className="input num" name="id" type="number" min={1} defaultValue={device?.id} readOnly={!!device} required />
      </label>
      <label className="field">
        <span className="label">Name</span>
        <input className="input" name="name" defaultValue={device?.name} placeholder="wb_5" required />
      </label>
      <label className="field">
        <span className="label">Attached to</span>
        <input className="input" name="kind" defaultValue={device?.kind} placeholder="Livestock · lead cow" />
      </label>
      <label className="field">
        <span className="label">Farm</span>
        <select className="select" name="farm_id" defaultValue={device?.farmId ?? ""}>
          <option value="">Unassigned</option>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">Anomaly model</span>
        <select className="select" name="model" defaultValue={device?.model ?? ""}>
          <option value="">None</option>
          {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">Status</span>
        <select className="select" name="status" defaultValue={device?.status ?? "Active"}>
          <option>Active</option>
          <option>Inactive</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Track colour</span>
        <input className="input input--color" name="color" type="color" defaultValue={device?.color ?? "#34b36b"} />
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="label">Notes</span>
        <input className="input" name="notes" defaultValue={device?.notes ?? ""} />
      </label>
    </>
  );
}

export default async function DevicesAdmin() {
  const viewer = await requireAdmin();
  const [tracks, farms, models] = await Promise.all([getTracksCached(viewer, undefined, 400), getFarms(viewer), getModels()]);
  const farmName = (id: string | null) => farms.find((f) => f.id === id)?.name ?? "—";

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow"><b>A1</b> Manage <span>{tracks.length} devices</span></span>
          <h1 className="display">Devices</h1>
        </div>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2><span>01</span>Fleet</h2>
          <span className="label">Click a row to edit</span>
        </div>
        <div className="rows" style={{ "--cols": "1.1fr 0.4fr 1fr 1.3fr 0.8fr 0.8fr 0.8fr" } as React.CSSProperties}>
          <div className="rows__head">
            <span>Device</span><span>ID</span><span className="hide-sm">Farm</span><span className="hide-sm">Attached to</span>
            <span className="hide-sm">Model</span><span>Status</span><span className="r hide-sm">Last fix</span>
          </div>
          {tracks.map((d) => {
            const last = d.fixes[d.fixes.length - 1];
            return (
              <details key={d.id}>
                <summary>
                  <span className="name"><i className="swatch" style={{ "--c": d.color } as React.CSSProperties} />{d.name}</span>
                  <span className="num">{d.id}</span>
                  <span className="hide-sm">{farmName(d.farmId)}</span>
                  <span className="muted hide-sm">{d.kind}</span>
                  <span className="num hide-sm">{d.model ?? <span className="muted">none</span>}</span>
                  <span>{d.status === "Active" ? <span className="tag tag--ok">Active</span> : <span className="tag tag--warn">{d.status}</span>}</span>
                  <span className="r num muted hide-sm">{last ? ago(last.t) : "never"}</span>
                </summary>
                <div className="rows__edit">
                  <ActionForm action={saveDevice} submit="Save device" className="form-grid">
                    <DeviceFields device={d} farms={farms} models={models} />
                  </ActionForm>
                  <div className="inline-form">
                    <Link className="btn btn--sm" href={`/devices/${d.id}`}>Open tracker</Link>
                    <ActionForm action={deleteDevice} submit="Delete device" variant="danger" confirm={`Delete ${d.name} and all its telemetry?`}>
                      <input type="hidden" name="id" value={d.id} />
                    </ActionForm>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2><span>02</span>Register a device</h2>
          <span className="label">ID must match Device_id in the firmware</span>
        </div>
        <div className="panel__body">
          <ActionForm action={saveDevice} submit="Add device" className="form-grid">
            <DeviceFields farms={farms} models={models} />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
