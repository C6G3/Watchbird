"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Re-renders the page when new telemetry or anomaly labels land in "Data".
 * Throttled: a tracker publishes every 15 s and the model rescans in batches,
 * so one refresh every 10 s is plenty.
 */
export default function LiveRefresh({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createBrowserClient(url, anonKey);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("data-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "Data" }, () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          router.refresh();
        }, 10_000);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [url, anonKey, router]);
  return null;
}
