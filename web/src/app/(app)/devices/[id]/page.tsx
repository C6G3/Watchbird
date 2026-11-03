import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import FieldMap from "@/components/FieldMap";
import Sparkline from "@/components/Sparkline";
import { getFarms, getTrack } from "@/lib/data";
import { anomalyEvents, distanceSince, homePosition, speedSeries } from "@/lib/geo";
import { ago, clock, coord, describeEvent, metres, stamp } from "@/lib/format";
import { requireViewer } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Tracker ${(await params).id}` };
}

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const id = Number((await params).id);
  const track = Number.isFinite(id) ? await getTrack(viewer, id, 1500) : null;
  if (!track) notFound();

  const farms = await getFarms(viewer);
  const farm = farms.find((f) => f.id === track.farmId);
  const now = Date.now();
  const fixes = track.fixes;
  const last = fixes[fixes.length - 1];
  const events = anomalyEvents(track).reverse();
  const home = homePosition(fixes);
  const speeds = speedSeries(fixes);
  const flagged = fixes.slice(1).map((f) => f.anomaly === -1);
  const anomalyShare = fixes.length ? fixes.filter((f) => f.anomaly === -1).length / fixes.length : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <Link href="/dashboard" className="textlink">Overview</Link>
            <b>Tracker #{track.id}</b>
            <span>{farm?.name ?? "No farm"}</span>
          </span>
          <h1 className="display" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <i className="swatch" style={{ "--c": track.color, width: 18, height: 18 } as React.CSSProperties} />
            {track.name}
          </h1>
        </div>
        <div className="page-head__actions">
          {track.status === "Active" ? <span className="tag tag--ok">Active</span> : <span className="tag tag--warn">{track.status}</span>}
          {viewer.role === "admin" ? <Link className="btn" href="/admin/devices">Manage</Link> : null}
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="label">Last fix</span>
          <span className="stat__value">{last ? clock(last.t) : "—"}</span>
          <span className="stat__foot">{last ? ago(last.t, now) : "No data yet"}</span>
        </div>
        <div className="stat">
          <span className="label">Distance · 24 h</span>
          <span className="stat__value">{metres(distanceSince(fixes, 24, now))}</span>
          <span className="stat__foot">From {fixes.length} stored fixes</span>
        </div>
        <div className="stat">
          <span className="label">Anomaly events</span>
          <span className={events.length ? "stat__value stat__value--alert" : "stat__value"}>{events.length}</span>
          <span className="stat__foot">{(anomalyShare * 100).toFixed(1)}% of fixes flagged</span>
        </div>
        <div className="stat">
          <span className="label">Model</span>
          <span className="stat__value" style={{ fontSize: "1.9rem" }}>{track.model ?? "None"}</span>
          <span className="stat__foot">{track.model ? "Isolation Forest" : "Not scored yet"}</span>
        </div>
      </section>

      <FieldMap tracks={[track]} farms={farm ? [farm] : []} short />

      <div className="grid-2">
        <section className="panel">
          <div className="panel__head">
            <h2><span>01</span>Speed</h2>
            <span className="label">m/s · rust ticks are flagged fixes</span>
          </div>
          <div className="panel__body">
            <Sparkline values={speeds} flagged={flagged} label={`Speed of ${track.name} over time`} />
            <div className="chart-cap label">
              <span>{fixes[0] ? stamp(fixes[0].t) : ""}</span>
              <span>max {Math.max(0, ...speeds).toFixed(1)} m/s</span>
              <span>{last ? stamp(last.t) : ""}</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel__head">
            <h2><span>02</span>Altitude</h2>
            <span className="label">metres above sea level</span>
          </div>
          <div className="panel__body">
            <Sparkline values={fixes.map((f) => f.alt ?? 0)} label={`Altitude of ${track.name} over time`} />
            <div className="chart-cap label">
              <span>min {Math.round(Math.min(...fixes.map((f) => f.alt ?? 0)))} m</span>
              <span>max {Math.round(Math.max(...fixes.map((f) => f.alt ?? 0)))} m</span>
            </div>
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel__head">
            <h2><span>03</span>Anomaly events</h2>
            <span className="label">{events.length} total</span>
          </div>
          {events.length ? (
            <ol className="notes">
              {events.map((e) => (
                <li key={e.start}>
                  <span className="when">{clock(e.start)}</span>
                  <p>{describeEvent(e)}</p>
                  <span />
                  <span className="sub num">{stamp(e.start)} · {coord(e.lat, e.lng)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="panel__empty">No anomalous movement on record.</p>
          )}
        </section>
        <section className="panel">
          <div className="panel__head">
            <h2><span>04</span>Datasheet</h2>
          </div>
          <dl className="spec panel__body">
            <div><dt>Attached to</dt><dd>{track.kind}</dd></div>
            <div><dt>Usual position</dt><dd className="num">{coord(home.lat, home.lng)}</dd></div>
            <div><dt>Last position</dt><dd className="num">{last ? coord(last.lat, last.lng) : "—"}</dd></div>
            <div><dt>Last altitude</dt><dd className="num">{last?.alt != null ? `${Math.round(last.alt)} m` : "—"}</dd></div>
            <div><dt>Device ID</dt><dd className="num">{track.id}</dd></div>
            {track.notes ? <div><dt>Notes</dt><dd>{track.notes}</dd></div> : null}
          </dl>
        </section>
      </div>
    </div>
  );
}
