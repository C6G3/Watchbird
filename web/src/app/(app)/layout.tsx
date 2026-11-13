import AppShell from "@/components/AppShell";
import LiveRefresh from "@/components/LiveRefresh";
import { getAlertCountCached } from "@/lib/data";
import { isDemo, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { requireViewer } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const alerts = await getAlertCountCached(viewer);

  return (
    <AppShell viewer={viewer} alerts={alerts} demo={isDemo}>
      {isDemo ? null : <LiveRefresh url={supabaseUrl} anonKey={supabaseAnonKey} />}
      {children}
    </AppShell>
  );
}
