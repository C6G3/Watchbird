import AppShell from "@/components/AppShell";
import LiveRefresh from "@/components/LiveRefresh";
import { getTracksCached } from "@/lib/data";
import { isDemo, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { anomalyEvents } from "@/lib/geo";
import { requireViewer } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const tracks = await getTracksCached(viewer, undefined, 400);
  const since = Date.now() - 24 * 3600_000;
  const alerts = tracks.flatMap(anomalyEvents).filter((e) => Date.parse(e.end) >= since).length;

  return (
    <AppShell viewer={viewer} alerts={alerts} demo={isDemo}>
      {isDemo ? null : <LiveRefresh url={supabaseUrl} anonKey={supabaseAnonKey} />}
      {children}
    </AppShell>
  );
}
