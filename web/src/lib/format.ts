import type { AnomalyEvent } from "./types";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(iso: string, now = Date.now()) {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Nairobi" });

export const clock = (iso: string) => timeFmt.format(new Date(iso));
export const stamp = (iso: string) => `${dayFmt.format(new Date(iso))} ${timeFmt.format(new Date(iso))}`;

export function metres(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

export function minutes(fromIso: string, toIso: string) {
  const m = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Survey-style coordinate: 0.39810° S, 36.96160° E */
export function coord(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lng).toFixed(5)}° ${lng < 0 ? "W" : "E"}`;
}

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Plain-language line for an anomaly event. */
export function describeEvent(e: AnomalyEvent) {
  const span = minutes(e.start, e.end);
  return e.maxOffsetM > 150
    ? `${e.deviceName} left its usual range for ${span}, up to ${metres(e.maxOffsetM)} out.`
    : `${e.deviceName} moved unusually for ${span} without leaving its range.`;
}

/** "diseased" → "Diseased", for enum values shown as labels. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
