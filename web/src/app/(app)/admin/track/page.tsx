import type { Metadata } from "next";
import Link from "next/link";
import PhoneTracker from "@/components/PhoneTracker";
import { getDevices } from "@/lib/data";
import { isDemo } from "@/lib/env";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Phone tracker" };

export default async function TrackPage() {
  const viewer = await requireAdmin();
  const devices = (await getDevices(viewer)).filter((d) => d.status === "Active");

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>A5</b> Manage <span>Use this phone as a GPS tracker</span>
          </span>
          <h1 className="display">Phone tracker</h1>
        </div>
      </header>
      {devices.length ? null : (
        <p className="notice">
          No active devices yet. <Link className="textlink" href="/admin/devices">Register one</Link> (e.g. wb_phone,
          attached to &quot;Phone&quot;), then come back.
        </p>
      )}
      <PhoneTracker devices={devices} demo={isDemo} />
    </div>
  );
}
