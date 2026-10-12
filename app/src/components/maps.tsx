import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { imageryMaxZoom } from "../lib/imagery";

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const BASEMAP =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const BASEMAP_ATTR = "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

export const pinIcon = (color: string, label = "", big = false) =>
  L.divIcon({
    className: "pin-wrap",
    html: `<div class="pin${big ? " pin-big" : ""}" style="--c:${color}"><span>${label}</span></div>`,
    iconSize: big ? [34, 34] : [26, 26],
    iconAnchor: big ? [17, 17] : [13, 13],
  });

export const targetIcon = () =>
  L.divIcon({
    className: "pin-wrap",
    html: `<div class="target-pin"><div class="target-ring"></div>🚩</div>`,
    iconSize: [40, 40],
    iconAnchor: [12, 34],
  });

const STREETS_NO_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

/**
 * The "drop": label-free imagery around the VRF-picked spot — satellite, or
 * the bare street grid. Zoom adapts to how deep real imagery goes at this spot
 * (no grey "data not available" tiles), and panning is clamped to a box so
 * you can't just zoom out to the coastline.
 */
export function DropView({
  lat,
  lng,
  mode = "satellite",
  className = "map",
}: {
  lat: number;
  lng: number;
  mode?: "satellite" | "streets";
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const home = useRef<{ zoom: number }>({ zoom: 16 });

  useEffect(() => {
    if (!el.current) return;
    let cancelled = false;
    let m: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    const node = el.current;
    (async () => {
      const maxZ = mode === "streets" ? 16 : await imageryMaxZoom(lat, lng);
      if (cancelled) return;
      const zoom = Math.min(16, maxZ);
      // shallower imagery ⇒ show a wider box so there's still something to read
      const box = Math.min(0.6, 0.05 * 2 ** (16 - zoom));
      home.current.zoom = zoom;
      m = L.map(node, {
        center: [lat, lng],
        zoom,
        minZoom: zoom - 2,
        maxZoom: Math.min(19, maxZ + 1),
        zoomControl: true,
        maxBounds: L.latLngBounds([lat - box, lng - box], [lat + box, lng + box]),
        maxBoundsViscosity: 1,
      });
      L.tileLayer(mode === "streets" ? STREETS_NO_LABELS : SATELLITE, {
        maxNativeZoom: maxZ,
        maxZoom: 19,
        attribution: mode === "streets" ? "Tiles &copy; Esri" : "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      }).addTo(m);
      map.current = m;
      ro = new ResizeObserver(() => m?.invalidateSize());
      ro.observe(node);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      m?.remove();
      map.current = null;
    };
  }, [lat, lng, mode]);

  return (
    <div className="map-shell">
      <div ref={el} className={className} />
      <button
        className="map-recenter"
        onClick={() => map.current?.setView([lat, lng], home.current.zoom)}
        title="Back to the drop point"
      >
        ⌖ Recenter
      </button>
    </div>
  );
}

/** Back-compat name used by older screens. */
export const SatelliteView = DropView;

/** World map to drop your pin on. */
export function GuessMap({
  value,
  onPick,
  color,
  disabled,
  className = "map guess-map",
}: {
  value: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number }) => void;
  color: string;
  disabled?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      worldCopyJump: true,
    });
    L.tileLayer(BASEMAP, { attribution: BASEMAP_ATTR, maxZoom: 19 }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      pickRef.current({ lat: e.latlng.lat, lng: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) });
    });
    map.current = m;
    // the container is often laid out after mount (grid/flex) — re-measure
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) marker.current = L.marker([value.lat, value.lng], { icon: pinIcon(color, "", true) }).addTo(m);
    else marker.current.setLatLng([value.lat, value.lng]);
  }, [value, color]);

  return (
    // the locked state lives on the wrapper: Leaflet owns the map div's classes
    <div className={`map-shell${disabled ? " is-locked" : ""}`}>
      <div ref={el} className={className} />
    </div>
  );
}

export interface ResultPin {
  lat: number;
  lng: number;
  color: string;
  label: string;
  winner: boolean;
}

/** Reveal map: target flag, every guess, and the line from each guess home. */
export function ResultMap({ target, pins }: { target: { lat: number; lng: number }; pins: ResultPin[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: [target.lat, target.lng], zoom: 3, worldCopyJump: true });
    L.tileLayer(BASEMAP, { attribution: BASEMAP_ATTR, maxZoom: 19 }).addTo(m);
    const bounds = L.latLngBounds([[target.lat, target.lng]]);
    const layers: L.Layer[] = [];
    pins.forEach((p, i) => {
      // draw the shorter way around the antimeridian
      let lng = p.lng;
      if (lng - target.lng > 180) lng -= 360;
      if (lng - target.lng < -180) lng += 360;
      const line = L.polyline(
        [
          [p.lat, lng],
          [target.lat, target.lng],
        ],
        { color: p.color, weight: p.winner ? 4 : 2.5, dashArray: p.winner ? undefined : "6 8", opacity: 0 },
      ).addTo(m);
      const mk = L.marker([p.lat, lng], { icon: pinIcon(p.color, p.label, p.winner), opacity: 0 }).addTo(m);
      layers.push(line, mk);
      bounds.extend([p.lat, lng]);
      // stagger the reveal, farthest first is set by caller order
      setTimeout(() => {
        line.setStyle({ opacity: 0.9 });
        mk.setOpacity(1);
      }, 500 + i * 450);
    });
    L.marker([target.lat, target.lng], { icon: targetIcon(), zIndexOffset: 1000 }).addTo(m);
    const fit = () => m.fitBounds(bounds.pad(0.25), { maxZoom: 8, animate: false });
    fit();
    // the panel often settles its size after mount — re-measure and re-fit
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      fit();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.lat, target.lng, JSON.stringify(pins)]);

  return (
    <div className="map-shell">
      <div ref={el} className="map" />
    </div>
  );
}
