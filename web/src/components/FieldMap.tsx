"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, RasterTileSource } from "maplibre-gl";
import { useResolvedTheme } from "./theme";
import { bounds } from "@/lib/geo";
import { coord, stamp } from "@/lib/format";
import type { DeviceTrack, Farm } from "@/lib/types";

type Basemap = "satellite" | "plain";

const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services";
const cartoTiles = (theme: "light" | "dark") =>
  ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}@2x.png`);

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function toGeo(tracks: DeviceTrack[], farms: Farm[]) {
  const lines: GeoJSON.Feature[] = [];
  const fixes: GeoJSON.Feature[] = [];
  const last: GeoJSON.Feature[] = [];
  for (const t of tracks) {
    if (!t.fixes.length) continue;
    lines.push({
      type: "Feature",
      properties: { id: t.id, color: t.color },
      geometry: { type: "LineString", coordinates: t.fixes.map((f) => [f.lng, f.lat]) },
    });
    for (const f of t.fixes) {
      fixes.push({
        type: "Feature",
        properties: { id: t.id, name: t.name, color: t.color, anomaly: f.anomaly, t: f.t, alt: f.alt ?? "" },
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
      });
    }
    const l = t.fixes[t.fixes.length - 1];
    last.push({
      type: "Feature",
      properties: { id: t.id, color: t.color },
      geometry: { type: "Point", coordinates: [l.lng, l.lat] },
    });
  }
  const outlines: GeoJSON.Feature[] = farms
    .filter((f) => f.boundary)
    .map((f) => ({ type: "Feature", properties: { name: f.name }, geometry: f.boundary! }));
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
  return { lines: fc(lines), fixes: fc(fixes), last: fc(last), farms: fc(outlines) };
}

export type MapFocus = { lat: number; lng: number; zoom?: number; key: string } | null;

export default function FieldMap({
  tracks,
  farms,
  selected,
  onSelect,
  focus,
  short,
}: {
  tracks: DeviceTrack[];
  farms: Farm[];
  selected?: number | null;
  onSelect?: (id: number | null) => void;
  focus?: MapFocus;
  short?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<{ remove(): void }[]>([]);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);
  const theme = useResolvedTheme();
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      // Bundlers break MapLibre's relative worker URL; postinstall copies the worker into public/.
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const all = tracks.flatMap((t) => t.fixes);
      const farm = farms.find((f) => f.center_lat != null);
      const m = new maplibregl.Map({
        container: el.current,
        attributionControl: { compact: true },
        center: [farm?.center_lng ?? 36.9616, farm?.center_lat ?? -0.3981],
        zoom: 14,
        maxZoom: 19,
        style: {
          version: 8,
          sources: {
            sat: { type: "raster", tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri" },
            satLabels: { type: "raster", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
            plain: { type: "raster", tiles: cartoTiles(theme), tileSize: 256, attribution: "© OpenStreetMap © CARTO" },
          },
          layers: [
            { id: "sat", type: "raster", source: "sat" },
            { id: "satLabels", type: "raster", source: "satLabels", paint: { "raster-opacity": 0.9 } },
            { id: "plain", type: "raster", source: "plain", layout: { visibility: "none" } },
          ],
        },
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

      m.on("load", () => {
        const rust = cssVar("--rust");
        const leaf = cssVar("--leaf");
        const geo = toGeo(tracks, farms);
        m.addSource("farms", { type: "geojson", data: geo.farms });
        m.addSource("lines", { type: "geojson", data: geo.lines });
        m.addSource("fixes", { type: "geojson", data: geo.fixes });
        m.addSource("last", { type: "geojson", data: geo.last });

        m.addLayer({ id: "farm-fill", type: "fill", source: "farms", paint: { "fill-color": leaf, "fill-opacity": 0.07 } });
        m.addLayer({ id: "farm-line", type: "line", source: "farms", paint: { "line-color": leaf, "line-width": 1.5, "line-dasharray": [3, 2] } });
        m.addLayer({
          id: "lines",
          type: "line",
          source: "lines",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 2.2, "line-opacity": 0.85 },
        });
        m.addLayer({
          id: "fixes",
          type: "circle",
          source: "fixes",
          filter: ["==", ["get", "anomaly"], 1],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 4],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.5,
          },
        });
        m.addLayer({
          id: "anomalies",
          type: "circle",
          source: "fixes",
          filter: ["==", ["get", "anomaly"], -1],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 17, 11],
            "circle-color": rust,
            "circle-opacity": 0.18,
            "circle-stroke-color": rust,
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "last",
          type: "circle",
          source: "last",
          paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
        });

        const b = bounds(all.length ? all : farms.filter((f) => f.center_lat != null).map((f) => ({ lat: f.center_lat!, lng: f.center_lng! })));
        if (b) m.fitBounds(b, { padding: 70, maxZoom: 16, duration: 0 });

        const popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: "260px" });
        for (const layer of ["fixes", "anomalies"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
          m.on("click", layer, (e) => {
            const f = e.features?.[0];
            if (!f || f.geometry.type !== "Point") return;
            const [lng, lat] = f.geometry.coordinates as [number, number];
            const p = f.properties as { id: number; name: string; t: string; alt: number | ""; anomaly: number };
            const node = document.createElement("div");
            node.className = "pop";
            node.innerHTML = `<b></b><span class="mono"></span><span class="mono"></span>${
              p.anomaly === -1 ? '<span class="tag tag--alert">Anomaly</span>' : ""
            }`;
            node.querySelector("b")!.textContent = `${p.name} · ${stamp(p.t)}`;
            const [c, a] = node.querySelectorAll(".mono");
            c.textContent = coord(lat, lng);
            a.textContent = p.alt === "" ? "" : `Alt ${Math.round(Number(p.alt))} m`;
            popup.setLngLat([lng, lat]).setDOMContent(node).addTo(m);
            selectRef.current?.(p.id);
          });
        }
        m.on("click", "last", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id != null) selectRef.current?.(Number(id));
        });
        m.on("mousemove", (e) => setCursor({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        m.on("mouseout", () => setCursor(null));
        setReady(true);
      });
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is created once; data updates are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data updates (realtime refreshes, farm filter changes).
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const geo = toGeo(tracks, farms);
    (m.getSource("lines") as GeoJSONSource).setData(geo.lines);
    (m.getSource("fixes") as GeoJSONSource).setData(geo.fixes);
    (m.getSource("last") as GeoJSONSource).setData(geo.last);
    (m.getSource("farms") as GeoJSONSource).setData(geo.farms);

    // Name tags on each device's last fix. HTML markers so they use the app fonts.
    let cancelled = false;
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = tracks
        .filter((t) => t.fixes.length)
        .map((t) => {
          const l = t.fixes[t.fixes.length - 1];
          const node = document.createElement("button");
          node.className = "tag tag--plain";
          node.style.cssText = `background:var(--surface);color:var(--fg);border-color:${t.color};transform:translateY(-18px)`;
          node.textContent = t.name;
          node.onclick = () => selectRef.current?.(t.id);
          return new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([l.lng, l.lat]).addTo(m);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, tracks, farms]);

  // Dim everything but the selected device.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const on = selected == null ? 0.85 : ["case", ["==", ["get", "id"], selected], 1, 0.2];
    m.setPaintProperty("lines", "line-opacity", on as never);
    m.setPaintProperty("fixes", "circle-opacity", (selected == null ? 1 : ["case", ["==", ["get", "id"], selected], 1, 0.25]) as never);
    if (selected != null) {
      const t = tracks.find((d) => d.id === selected);
      const b = t && bounds(t.fixes);
      if (b) m.fitBounds(b, { padding: 80, maxZoom: 17, duration: 700 });
    }
  }, [ready, selected, tracks]);

  useEffect(() => {
    if (ready && focus) map.current?.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 17, duration: 800 });
  }, [ready, focus]);

  // Basemap and theme.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const sat = basemap === "satellite";
    m.setLayoutProperty("sat", "visibility", sat ? "visible" : "none");
    m.setLayoutProperty("satLabels", "visibility", sat ? "visible" : "none");
    m.setLayoutProperty("plain", "visibility", sat ? "none" : "visible");
    (m.getSource("plain") as RasterTileSource).setTiles(cartoTiles(theme));
    const rust = cssVar("--rust");
    const leaf = cssVar("--leaf");
    m.setPaintProperty("anomalies", "circle-color", rust);
    m.setPaintProperty("anomalies", "circle-stroke-color", rust);
    m.setPaintProperty("farm-fill", "fill-color", leaf);
    m.setPaintProperty("farm-line", "line-color", sat ? "#ffffff" : leaf);
  }, [ready, basemap, theme]);

  const center = cursor ?? (map.current ? { lat: map.current.getCenter().lat, lng: map.current.getCenter().lng } : null);

  return (
    <div className={short ? "map map--short" : "map"}>
      <div ref={el} className="map__canvas" />
      <div className="map__bar">
        <div className="map__legend" aria-hidden="true">
          <span>
            <i className="swatch" /> Track
          </span>
          <span>
            <i className="ring" /> Anomaly
          </span>
          {farms.some((f) => f.boundary) ? <span>┄ Farm edge</span> : null}
        </div>
        <div className="seg" role="group" aria-label="Basemap">
          {(["satellite", "plain"] as const).map((b) => (
            <button key={b} type="button" aria-pressed={basemap === b} onClick={() => setBasemap(b)}>
              {b[0].toUpperCase() + b.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {center ? <div className="map__readout">{coord(center.lat, center.lng)}</div> : null}
    </div>
  );
}
