import type { Metadata } from "next";
import Link from "next/link";
import FieldView from "@/components/FieldView";
import { getFarms, getTracksCached } from "@/lib/data";
import { anomalyEvents, distanceSince } from "@/lib/geo";
import { ago, clock, metres } from "@/lib/format";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ farm?: string }> }) {
  const viewer = await requireViewer();
  const { farm: farmParam } = await searchParams;
  const farms = await getFarms(viewer);
  const farm = farms.find((f) => f.id === farmParam);
  const tracks = await getTracksCached(viewer, farm?.id, 400);
  const now = Date.now();

  const events = tracks
    .flatMap(anomalyEvents)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const recent = events.filter((e) => Date.parse(e.end) >= now - 24 * 3600_000);
  const live = tracks.filter((t) => {
    const last = t.fixes[t.fixes.length - 1];
    return last && now - Date.parse(last.t) < 3600_000;
  });
  const distance = tracks.reduce((sum, t) => sum + distanceSince(t.fixes, 24, now), 0);
  const lastFix = tracks
    .map((t) => t.fixes[t.fixes.length - 1]?.t)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!farms.length) {
    return (
      <div className="page">
        <header className="page-head">
          <div className="page-head__title">
            <span className="eyebrow">
              <b>01</b> Overview
            </span>
            <h1 className="display">Welcome, {viewer.name.split(" ")[0]}</h1>
          </div>
        </header>
        <p className="notice">
          You&apos;re not linked to a farm yet. Ask your Watchbird admin to add you, then your trackers will appear here.
          In the meantime you can still <Link className="textlink" href="/scans">scan a photo</Link> of a crop or animal.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>01</b> Overview
            <span>{farm ? farm.name : farms.length === 1 ? farms[0].name : `${farms.length} farms`}</span>
            <span>Updated {clock(new Date(now).toISOString())} EAT</span>
          </span>
          <h1 className="display">Field overview</h1>
        </div>
        <div className="page-head__actions">
          {farms.length > 1 ? (
            <nav className="seg" aria-label="Farm">
              <Link href="/dashboard" aria-current={!farm ? "true" : undefined}>All</Link>
              {farms.map((f) => (
                <Link key={f.id} href={`/dashboard?farm=${f.id}`} aria-current={farm?.id === f.id ? "true" : undefined}>
                  {f.name}
                </Link>
              ))}
            </nav>
          ) : null}
          <Link href="/scans" className="btn btn--solid">New photo scan</Link>
        </div>
      </header>

      <section className="stats" aria-label="Today at a glance">
        <div className="stat">
          <span className="label">Reporting</span>
          <span className="stat__value">
            {live.length}
            <small>/ {tracks.length}</small>
          </span>
          <span className="stat__foot">Fix received in the last hour</span>
        </div>
        <div className="stat">
          <span className="label">Anomalies · 24 h</span>
          <span className={recent.length ? "stat__value stat__value--alert" : "stat__value"}>{recent.length}</span>
          <span className="stat__foot">{recent.length ? `Latest ${ago(recent[0].start, now)}` : "All movement normal"}</span>
        </div>
        <div className="stat">
          <span className="label">Distance · 24 h</span>
          <span className="stat__value">{metres(distance).split(" ")[0]}<small>{metres(distance).split(" ")[1]}</small></span>
          <span className="stat__foot">All trackers combined</span>
        </div>
        <div className="stat">
          <span className="label">Last fix</span>
          <span className="stat__value">{lastFix ? clock(lastFix) : "—"}</span>
          <span className="stat__foot">{lastFix ? ago(lastFix, now) : "Waiting for the first fix"}</span>
        </div>
      </section>

      <FieldView tracks={tracks} farms={farm ? [farm] : farms} events={events} now={now} />
    </div>
  );
}
