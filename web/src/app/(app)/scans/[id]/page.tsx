import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import InsightView from "@/components/InsightView";
import { getScan } from "@/lib/data";
import { cap, stamp } from "@/lib/format";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Scan" };

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const scan = await getScan(viewer, (await params).id);
  if (!scan) notFound();

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <Link href="/scans" className="textlink">Photo scans</Link>
            <b>{cap(scan.subject)}</b>
            <span>{stamp(scan.created_at)}</span>
          </span>
          <h1 className="display">{scan.result?.title ?? "Scan"}</h1>
        </div>
        <Link href="/scans" className="btn">New scan</Link>
      </header>

      <div className="scan-detail">
        <div style={{ display: "grid", gap: 12 }}>
          {scan.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="photo" src={scan.imageUrl} alt={scan.note ?? "Scanned photo"} />
          ) : (
            <div className="ph" data-label="Photo" />
          )}
          {scan.note ? (
            <dl className="spec">
              <div><dt>Farmer&apos;s note</dt><dd>{scan.note}</dd></div>
              <div><dt>Model</dt><dd className="num">{scan.model}</dd></div>
            </dl>
          ) : null}
        </div>
        <section className="panel">
          <div className="panel__body">
            {scan.status === "done" && scan.result ? (
              <InsightView insight={scan.result} compact />
            ) : scan.status === "failed" ? (
              <p className="notice notice--error">The model couldn&apos;t read this photo: {scan.error}</p>
            ) : (
              <p className="notice">Still reading the photo. Refresh in a few seconds.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
