import type { Metadata } from "next";
import Link from "next/link";
import ScanUploader from "@/components/ScanUploader";
import { getFarms, getScans } from "@/lib/data";
import { ago, cap } from "@/lib/format";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Photo scans" };

const URGENCY = { low: "tag--ok", medium: "tag--warn", high: "tag--alert" } as const;

export default async function ScansPage() {
  const viewer = await requireViewer();
  const [farms, scans] = await Promise.all([getFarms(viewer), getScans(viewer)]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>02</b> Photo scans
            <span>Crops · livestock · soil</span>
          </span>
          <h1 className="display">Ask the field</h1>
        </div>
      </header>

      <div className="grid-map">
        <section className="panel" aria-labelledby="history-h">
          <div className="panel__head">
            <h2 id="history-h"><span>01</span>{viewer.role === "admin" ? "All scans" : "Your scans"}</h2>
            <span className="label">{scans.length} total</span>
          </div>
          {scans.length ? (
            <div className="panel__body scan-grid">
              {scans.map((s) => (
                <Link key={s.id} href={`/scans/${s.id}`} className="scan-card">
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="scan-card__img" src={s.imageUrl} alt="" />
                  ) : (
                    <div className="ph" data-label={cap(s.subject)} />
                  )}
                  <div className="scan-card__body">
                    <div className="insight__head">
                      {s.status === "done" && s.result ? (
                        <span className={`tag ${URGENCY[s.result.urgency]}`}>{cap(s.result.urgency)}</span>
                      ) : s.status === "failed" ? (
                        <span className="tag tag--alert">Failed</span>
                      ) : (
                        <span className="tag">Reading…</span>
                      )}
                      <span className="tag tag--plain">{cap(s.subject)}</span>
                    </div>
                    <h3>{s.result?.title ?? s.note ?? "Untitled scan"}</h3>
                    <span className="label">{ago(s.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="panel__empty">No scans yet. Your first one will show up here.</p>
          )}
        </section>

        <section className="panel" aria-labelledby="new-h">
          <div className="panel__head">
            <h2 id="new-h"><span>02</span>New scan</h2>
          </div>
          <div className="panel__body">
            <ScanUploader farms={farms} />
          </div>
        </section>
      </div>
    </div>
  );
}
