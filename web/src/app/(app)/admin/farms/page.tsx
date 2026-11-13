import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { getDevices, getFarms, getMembers } from "@/lib/data";
import { coord } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import type { Farm } from "@/lib/types";
import { deleteFarm, saveFarm } from "../actions";

export const metadata: Metadata = { title: "Farms" };

function FarmFields({ farm }: { farm?: Farm }) {
  return (
    <>
      {farm ? <input type="hidden" name="id" value={farm.id} /> : null}
      <label className="field">
        <span className="label">Name</span>
        <input className="input" name="name" defaultValue={farm?.name} placeholder="Kiganjo Block A" required />
      </label>
      <label className="field">
        <span className="label">Location</span>
        <input className="input" name="location_name" defaultValue={farm?.location_name ?? ""} placeholder="Nyeri, KE" />
      </label>
      <label className="field">
        <span className="label">Centre latitude</span>
        <input className="input num" name="center_lat" inputMode="decimal" defaultValue={farm?.center_lat ?? ""} placeholder="-0.3981" />
      </label>
      <label className="field">
        <span className="label">Centre longitude</span>
        <input className="input num" name="center_lng" inputMode="decimal" defaultValue={farm?.center_lng ?? ""} placeholder="36.9616" />
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="label">Boundary · GeoJSON Polygon (optional, draw one at geojson.io)</span>
        <textarea className="textarea num" name="boundary" defaultValue={farm?.boundary ? JSON.stringify(farm.boundary) : ""} />
      </label>
    </>
  );
}

export default async function FarmsAdmin() {
  const viewer = await requireAdmin();
  const [farms, devices, members] = await Promise.all([getFarms(viewer), getDevices(viewer), getMembers()]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>A2</b> Manage <span>{farms.length} farms</span>
          </span>
          <h1 className="display">Farms</h1>
        </div>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>01</span>Farms
          </h2>
          <span className="label">Click a row to edit</span>
        </div>
        <div className="rows" style={{ "--cols": "1.3fr 1fr 1.4fr 0.6fr 0.6fr" } as React.CSSProperties}>
          <div className="rows__head">
            <span>Farm</span>
            <span>Location</span>
            <span className="hide-sm">Centre</span>
            <span>Devices</span>
            <span className="hide-sm">People</span>
          </div>
          {farms.map((f) => (
            <details key={f.id}>
              <summary>
                <span className="name">{f.name}</span>
                <span className="muted">{f.location_name ?? "—"}</span>
                <span className="num muted hide-sm">
                  {f.center_lat != null && f.center_lng != null ? coord(f.center_lat, f.center_lng) : "—"}
                </span>
                <span className="num">{devices.filter((d) => d.farmId === f.id).length}</span>
                <span className="num hide-sm">{members.filter((m) => m.farmIds.includes(f.id)).length}</span>
              </summary>
              <div className="rows__edit">
                <ActionForm action={saveFarm} submit="Save farm" className="form-grid">
                  <FarmFields farm={f} />
                </ActionForm>
                <ActionForm action={deleteFarm} submit="Delete farm" variant="danger" confirm={`Delete ${f.name}? Its devices become unassigned.`}>
                  <input type="hidden" name="id" value={f.id} />
                </ActionForm>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>02</span>Add a farm
          </h2>
        </div>
        <div className="panel__body">
          <ActionForm action={saveFarm} submit="Add farm" className="form-grid">
            <FarmFields />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
