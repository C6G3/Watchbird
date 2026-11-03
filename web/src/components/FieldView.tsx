"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import FieldMap, { type MapFocus } from "./FieldMap";
import { ago, clock, describeEvent } from "@/lib/format";
import type { AnomalyEvent, DeviceTrack, Farm } from "@/lib/types";

export default function FieldView({
  tracks,
  farms,
  events,
  now,
}: {
  tracks: DeviceTrack[];
  farms: Farm[];
  events: AnomalyEvent[];
  now: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const eventsByDevice = useMemo(() => {
    const m = new Map<number, number>();
    events.forEach((e) => m.set(e.deviceId, (m.get(e.deviceId) ?? 0) + 1));
    return m;
  }, [events]);

  const toggle = (id: number | null) => setSelected((cur) => (cur === id ? null : id));

  return (
    <>
      <div className="grid-map">
        <FieldMap tracks={tracks} farms={farms} selected={selected} onSelect={toggle} focus={focus} />

        <section className="panel" aria-labelledby="trackers-h">
          <div className="panel__head">
            <h2 id="trackers-h">
              <span>02</span>Trackers
            </h2>
            {selected != null ? (
              <button className="btn btn--sm" onClick={() => setSelected(null)}>
                Show all
              </button>
            ) : (
              <span className="label">{tracks.length} on map</span>
            )}
          </div>
          {tracks.length ? (
            <ul className="devlist">
              {tracks.map((t) => {
                const last = t.fixes[t.fixes.length - 1];
                const stale = !last || now - Date.parse(last.t) > 3600_000;
                const n = eventsByDevice.get(t.id) ?? 0;
                return (
                  <li key={t.id}>
                    <button className="devrow" aria-pressed={selected === t.id} onClick={() => toggle(t.id)}>
                      <i className="swatch" style={{ "--c": t.color } as React.CSSProperties} />
                      <span className="devrow__name">{t.name}</span>
                      {n ? (
                        <span className="tag tag--alert">{n} event{n > 1 ? "s" : ""}</span>
                      ) : stale ? (
                        <span className="tag tag--warn">No signal</span>
                      ) : (
                        <span className="tag tag--ok">Normal</span>
                      )}
                      <span className="devrow__meta">
                        <span>{t.kind}</span>
                        <span className="num">{last ? `seen ${ago(last.t, now)}` : "no fixes yet"}</span>
                        <Link href={`/devices/${t.id}`} className="textlink" onClick={(e) => e.stopPropagation()}>
                          Details
                        </Link>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="panel__empty">No trackers are assigned to this farm yet.</p>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="notes-h">
        <div className="panel__head">
          <h2 id="notes-h">
            <span>03</span>Field notes
          </h2>
          <span className="label">Movement anomalies · newest first</span>
        </div>
        {events.length ? (
          <ol className="notes">
            {events.map((e) => (
              <li key={`${e.deviceId}-${e.start}`}>
                <span className="when">{clock(e.start)}</span>
                <p>{describeEvent(e)}</p>
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    setSelected(null);
                    setFocus({ lat: e.lat, lng: e.lng, key: `${e.deviceId}-${e.start}` });
                  }}
                >
                  Show on map
                </button>
                <span className="sub num">
                  {ago(e.start, now)} · {e.points} fixes flagged by the model
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="panel__empty">Nothing unusual. Every tracker moved within its normal pattern.</p>
        )}
      </section>
    </>
  );
}
