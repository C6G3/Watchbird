"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Mark from "./Mark";
import { ThemeToggle } from "./theme";
import type { Viewer } from "@/lib/types";

type NavItem = { href: string; label: string; idx: string; count?: number };

export default function AppShell({
  viewer,
  alerts,
  demo,
  children,
}: {
  viewer: Viewer;
  alerts: number;
  demo: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const field: NavItem[] = [
    { href: "/dashboard", label: "Overview", idx: "01", count: alerts || undefined },
    { href: "/scans", label: "Photo scans", idx: "02" },
  ];
  const admin: NavItem[] = [
    { href: "/admin/devices", label: "Devices", idx: "A1" },
    { href: "/admin/farms", label: "Farms", idx: "A2" },
    { href: "/admin/users", label: "People", idx: "A3" },
    { href: "/admin/models", label: "Models", idx: "A4" },
    { href: "/admin/track", label: "Phone tracker", idx: "A5" },
  ];

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const link = (item: NavItem) => (
    <Link key={item.href} href={item.href} className="navlink" aria-current={isCurrent(item.href) ? "page" : undefined}>
      <span className="idx">{item.idx}</span>
      <span>{item.label}</span>
      {item.count ? <span className="count" title="Anomaly events in the last 24 h">{item.count}</span> : null}
    </Link>
  );

  return (
    <div className="shell" data-open={open}>
      <header className="topbar">
        <Link href="/dashboard" className="wordmark display">
          <Mark />
          Watchbird
        </Link>
        <button className="iconbtn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
      </header>
      {open ? <div className="scrim" onClick={() => setOpen(false)} /> : null}

      <aside className="rail">
        <div className="rail__brand">
          <Link href="/dashboard" className="wordmark display">
            <Mark />
            Watchbird
          </Link>
          <span className="label">Field telemetry · {viewer.role === "admin" ? "Admin" : "Farm"} view</span>
        </div>

        <nav className="rail__nav" aria-label="Main">
          <div className="rail__group">
            <span className="label">Field</span>
            {field.map(link)}
          </div>
          {viewer.role === "admin" ? (
            <div className="rail__group">
              <span className="label">Manage</span>
              {admin.map(link)}
            </div>
          ) : null}
        </nav>

        <div className="rail__foot">
          <div className="who-row">
            <div className="who">
              <strong>{viewer.name}</strong>
              <span className="label">{viewer.role === "admin" ? "Admin" : "Farmer"}</span>
            </div>
            <form action="/auth/signout" method="post">
              <button className="iconbtn" aria-label="Sign out" title="Sign out">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M6 2.5H3v11h3M10.5 5 13.5 8l-3 3M13.5 8H6" />
                </svg>
              </button>
            </form>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <main className="main" id="main">
        {demo ? (
          <div className="demo-banner">
            <b>DEMO</b>Synthetic data. Add your Supabase keys to <code>web/.env.local</code> to go live. Changes aren&apos;t saved.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
