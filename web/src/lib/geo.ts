import type { AnomalyEvent, DeviceTrack, Fix } from "./types";

// Same post-processing as train.Config: anomalous fixes closer than 15 min
// belong to one event, and single isolated fixes are ignored.
export const EVENT_GAP_S = 900;
export const MIN_EVENT_SIZE = 2;

export function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** The device's usual position: median of its normal fixes. */
export function homePosition(fixes: Fix[]) {
  const normal = fixes.filter((f) => f.anomaly === 1);
  const src = normal.length ? normal : fixes;
  return { lat: median(src.map((f) => f.lat)), lng: median(src.map((f) => f.lng)) };
}

export function anomalyEvents(track: DeviceTrack): AnomalyEvent[] {
  const home = homePosition(track.fixes);
  const events: AnomalyEvent[] = [];
  let run: Fix[] = [];

  const flush = () => {
    if (run.length >= MIN_EVENT_SIZE) {
      let far = run[0];
      let maxOffsetM = 0;
      for (const f of run) {
        const d = haversine(home.lat, home.lng, f.lat, f.lng);
        if (d >= maxOffsetM) {
          maxOffsetM = d;
          far = f;
        }
      }
      events.push({
        deviceId: track.id,
        deviceName: track.name,
        start: run[0].t,
        end: run[run.length - 1].t,
        points: run.length,
        maxOffsetM,
        lat: far.lat,
        lng: far.lng,
      });
    }
    run = [];
  };

  for (const f of track.fixes) {
    if (f.anomaly !== -1) continue;
    const prev = run[run.length - 1];
    if (prev && (Date.parse(f.t) - Date.parse(prev.t)) / 1000 > EVENT_GAP_S) flush();
    run.push(f);
  }
  flush();
  return events;
}

/** Metres travelled across the fixes that fall inside the last `hours`. */
export function distanceSince(fixes: Fix[], hours: number, now = Date.now()) {
  const from = now - hours * 3600_000;
  let total = 0;
  for (let i = 1; i < fixes.length; i++) {
    if (Date.parse(fixes[i].t) < from) continue;
    const a = fixes[i - 1];
    const b = fixes[i];
    total += haversine(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

export function speedSeries(fixes: Fix[]) {
  const out: number[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const dt = (Date.parse(b.t) - Date.parse(a.t)) / 1000;
    out.push(dt > 0 ? haversine(a.lat, a.lng, b.lat, b.lng) / dt : 0);
  }
  return out;
}

export function bounds(points: { lat: number; lng: number }[]) {
  if (!points.length) return null;
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return [[minLng, minLat], [maxLng, maxLat]] as [[number, number], [number, number]];
}
