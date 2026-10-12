import { useEffect, useRef } from "react";
import L from "leaflet";
import { LOCATIONS } from "../lib/locations";

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const pick = () => LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];

/**
 * Background "video": slow drifts over places from the drop pool, with a
 * cross-fade cut to a new place every few seconds.
 */
export default function Flyover() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const start = pick();
    const m = L.map(el.current, {
      center: [start.lat, start.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomSnap: 0,
    });
    const layer = L.tileLayer(SATELLITE, { maxNativeZoom: 17, maxZoom: 18 }).addTo(m);
    const node = el.current;

    // slow drift over the current place
    let raf = 0;
    const drift = () => {
      m.panBy([0.3, 0.1], { animate: false });
      raf = requestAnimationFrame(drift);
    };
    raf = requestAnimationFrame(drift);

    // "cut" to the next place: fade out, jump, wait for imagery, fade in
    let fadeTimer: ReturnType<typeof setTimeout>;
    const hop = () => {
      node.classList.add("faded");
      fadeTimer = setTimeout(() => {
        const next = pick();
        m.setView([next.lat, next.lng], 14.5 + Math.random() * 1.5, { animate: false });
        const reveal = () => node.classList.remove("faded");
        layer.once("load", reveal);
        setTimeout(reveal, 4000); // never stay dark if a tile stalls
      }, 1200);
    };
    const t = setInterval(hop, 11000);
    return () => {
      clearInterval(t);
      clearTimeout(fadeTimer);
      cancelAnimationFrame(raf);
      m.remove();
    };
  }, []);

  return (
    <div className="flyover" aria-hidden>
      <div ref={el} className="flyover-map" />
      <div className="flyover-shade" />
    </div>
  );
}
