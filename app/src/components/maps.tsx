import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const BASEMAP = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const BASEMAP_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

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

/**
 * The "drop": label-free satellite imagery around the VRF-picked spot. Zoom
 * and panning are clamped to a small box so the coastline-from-space trick
 * doesn't give the answer away.
 */
export function SatelliteView({ lat, lng }: { lat: number; lng: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const box = 0.06;
    const m = L.map(el.current, {
      center: [lat, lng],
      zoom: 16,
      minZoom: 14,
      maxZoom: 19,
      zoomControl: true,
      attributionControl: true,
      maxBounds: L.latLngBounds([lat - box, lng - box], [lat + box, lng + box]),
      maxBoundsViscosity: 1,
    });
    L.tileLayer(SATELLITE, {
      maxNativeZoom: 18,
      maxZoom: 19,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [lat, lng]);

  return (
    <div className="map-shell">
      <div ref={el} className="map" />
      <button
        className="map-recenter"
        onClick={() => map.current?.setView([lat, lng], 16)}
        title="Back to the drop point"
      >
        ⌖ Recenter
      </button>
    </div>
  );
}

/** World map to drop your pin on. */
export function GuessMap({
  value,
  onPick,
  color,
  disabled,
}: {
  value: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number }) => void;
  color: string;
  disabled?: boolean;
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
    L.tileLayer(BASEMAP, { attribution: BASEMAP_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(m);
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
    <div className="map-shell">
      <div ref={el} className={`map guess-map${disabled ? " is-locked" : ""}`} />
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
    L.tileLayer(BASEMAP, { attribution: BASEMAP_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(m);
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
    m.fitBounds(bounds.pad(0.25), { maxZoom: 8 });
    const ro = new ResizeObserver(() => m.invalidateSize());
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
