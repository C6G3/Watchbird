import type { Metadata, Viewport } from "next";
import { Figtree, Geist_Mono, Outfit } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// Outfit for headings and figures, Figtree for reading, Geist Mono only for data.
const display = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const sans = Figtree({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Watchbird", template: "%s · Watchbird" },
  description: "Field telemetry for farms: GPS trackers, movement anomalies and photo diagnostics.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f4e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1912" },
  ],
};

// Applies the saved theme before first paint so there's no flash.
const themeScript = `try{var t=localStorage.getItem("wb-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
