"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ago, coord } from "@/lib/format";
import type { Device } from "@/lib/types";

type QueuedFix = { deviceId: number; t: string; lat: number; lng: number; alt: number | null; accuracy: number | null };
type Status = "idle" | "locating" | "live" | "error";

const INTERVALS = [5, 15, 30] as const;
const STORE = "wb-phone-tracker";

/**
 * Turns this phone into a Watchbird tracker: reads GPS with the browser's
 * Geolocation API and posts a fix every N seconds to /api/track, which stores
 * it in "Data" like bridge.py does for the ESP32 units. Fixes are queued while
 * offline. The screen is kept awake because browsers pause GPS when it locks.
 */
export default function PhoneTracker({ devices, demo }: { devices: Device[]; demo: boolean }) {
  const [deviceId, setDeviceId] = useState<number | null>(devices[0]?.id ?? null);
  const [every, setEvery] = useState<(typeof INTERVALS)[number]>(15);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(0);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [awake, setAwake] = useState<boolean | null>(null);
  const [, tick] = useState(0);

  const latest = useRef<GeolocationPosition | null>(null);
  const lastQueuedAt = useRef(0);
  const queue = useRef<QueuedFix[]>([]);
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const flushing = useRef(false);

  // Remember the last device and interval on this phone.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (devices.some((d) => d.id === saved.deviceId)) setDeviceId(saved.deviceId);
      if (INTERVALS.includes(saved.every)) setEvery(saved.every);
    } catch {}
  }, [devices]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ deviceId, every }));
    } catch {}
  }, [deviceId, every]);

  // Re-render once a second so "sent 12 s ago" stays current.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !queue.current.length) return;
    flushing.current = true;
    const batch = queue.current.slice(0, 200);
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixes: batch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A rejected fix will never succeed; drop it rather than retry forever.
        if (res.status === 400) queue.current = queue.current.slice(batch.length);
        throw new Error(json.error ?? `Server answered ${res.status}`);
      }
      queue.current = queue.current.slice(batch.length);
      setSent((n) => n + (json.stored ?? batch.length));
      setLastSent(new Date().toISOString());
      setMessage(json.demo ? "Demo mode: fixes are accepted but not saved." : null);
    } catch (e) {
      // fetch() rejects with a TypeError when the network is gone, even if navigator.onLine says otherwise.
      const offline = !navigator.onLine || e instanceof TypeError;
      setMessage(offline ? "No connection. Fixes are queued and will send automatically." : (e as Error).message);
    } finally {
      setQueued(queue.current.length);
      flushing.current = false;
    }
  }, []);

  const enqueue = useCallback(() => {
    const p = latest.current;
    if (!p || deviceId == null || p.timestamp === lastQueuedAt.current) return;
    lastQueuedAt.current = p.timestamp;
    queue.current.push({
      deviceId,
      t: new Date(p.timestamp).toISOString(),
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      alt: p.coords.altitude,
      accuracy: p.coords.accuracy,
    });
    queue.current = queue.current.slice(-500);
    setQueued(queue.current.length);
    void flush();
  }, [deviceId, flush]);

  const keepAwake = useCallback(async () => {
    if (!("wakeLock" in navigator)) return setAwake(false);
    try {
      lock.current = await navigator.wakeLock.request("screen");
      setAwake(true);
      lock.current.addEventListener("release", () => setAwake(false));
    } catch {
      setAwake(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    if (timer.current) clearInterval(timer.current);
    watchId.current = null;
    timer.current = null;
    void lock.current?.release().catch(() => {});
    lock.current = null;
    setStatus("idle");
    void flush();
  }, [flush]);

  const start = () => {
    if (deviceId == null) return setMessage("Register a device first, then pick it here.");
    if (!window.isSecureContext) return setMessage("Location needs HTTPS. Open this page on the deployed (https://) site.");
    if (!("geolocation" in navigator)) return setMessage("This browser has no GPS access.");
    setMessage(null);
    setStatus("locating");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const first = !latest.current;
        latest.current = p;
        setPos(p);
        setStatus("live");
        if (first) enqueue();
      },
      (err) => {
        setStatus("error");
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it for this site in the browser settings."
            : `GPS error: ${err.message}`,
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
    );
    timer.current = setInterval(enqueue, every * 1000);
    void keepAwake();
  };

  // Restart the send timer when the interval or device changes mid-run.
  useEffect(() => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = setInterval(enqueue, every * 1000);
  }, [every, enqueue]);

  // The wake lock is dropped whenever the tab is hidden; take it back on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && watchId.current != null) void keepAwake();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [keepAwake, flush]);

  useEffect(() => stop, [stop]);

  const running = status === "locating" || status === "live";
  const device = devices.find((d) => d.id === deviceId);

  return (
    <div className="tracker">
      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>01</span>Live fix
          </h2>
          <span className={`tag ${status === "live" ? "tag--ok" : status === "error" ? "tag--alert" : status === "locating" ? "tag--warn" : ""}`}>
            {status === "live" ? "Sending" : status === "locating" ? "Finding GPS…" : status === "error" ? "Problem" : "Stopped"}
          </span>
        </div>
        <div className="panel__body tracker__fix">
          <span className={`live-dot${status === "live" ? " live-dot--on" : ""}`} aria-hidden="true" />
          <p className="tracker__coord num">{pos ? coord(pos.coords.latitude, pos.coords.longitude) : "No fix yet"}</p>
          <dl className="tracker__meta">
            <div>
              <dt className="label">Accuracy</dt>
              <dd className="num">{pos ? `± ${Math.round(pos.coords.accuracy)} m` : "—"}</dd>
            </div>
            <div>
              <dt className="label">Altitude</dt>
              <dd className="num">{pos?.coords.altitude != null ? `${Math.round(pos.coords.altitude)} m` : "—"}</dd>
            </div>
            <div>
              <dt className="label">Fixes sent</dt>
              <dd className="num">{sent}</dd>
            </div>
            <div>
              <dt className="label">Last sent</dt>
              <dd className="num">{lastSent ? ago(lastSent) : "—"}</dd>
            </div>
          </dl>
          {queued > 1 ? <p className="notice">{queued} fixes queued, will send when the connection is back.</p> : null}
          {message ? <p className={`notice ${status === "error" ? "notice--error" : ""}`}>{message}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>02</span>Setup
          </h2>
          {awake != null && running ? <span className="label">{awake ? "Screen kept awake" : "Keep the screen on"}</span> : null}
        </div>
        <div className="panel__body scan-form">
          <label className="field">
            <span className="label">Report as device</span>
            <select
              className="select"
              value={deviceId ?? ""}
              disabled={running}
              onChange={(e) => setDeviceId(Number(e.target.value))}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · #{d.id} · {d.kind}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="label">Send a fix every</span>
            <div className="seg seg--full" role="group" aria-label="Send interval">
              {INTERVALS.map((s) => (
                <button key={s} type="button" aria-pressed={every === s} onClick={() => setEvery(s)}>
                  {s} s
                </button>
              ))}
            </div>
          </div>
          {running ? (
            <button className="btn btn--block" onClick={stop}>
              Stop tracking
            </button>
          ) : (
            <button className="btn btn--solid btn--block" onClick={start} disabled={!devices.length}>
              Start tracking
            </button>
          )}
          {device ? (
            <Link className="textlink" href={`/devices/${device.id}`}>
              Watch {device.name} on the map
            </Link>
          ) : null}
          {demo ? <p className="notice">Demo mode: the page works, but fixes aren&apos;t saved.</p> : null}
          <ul className="bullets">
            <li>Keep this page open with the screen on. Browsers pause GPS when the phone locks.</li>
            <li>Walk outside for a good fix; indoors accuracy is often worse than ± 50 m.</li>
            <li>Stray well away from your usual path to trigger an anomaly event.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
