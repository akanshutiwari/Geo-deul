import { useCallback, useEffect, useRef, useState } from "react";
import { Viewer, type PanoData } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import { StreetPic, streetPic, streetPicsNear } from "../lib/streetview";

const DEG = Math.PI / 180;

const metresBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (bLng - aLng) * 111_320 * Math.cos(aLat * DEG);
  const dy = (bLat - aLat) * 110_540;
  return Math.hypot(dx, dy);
};
/** compass bearing from a to b, degrees */
const bearing = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (bLng - aLng) * Math.cos(aLat * DEG);
  const dy = bLat - aLat;
  return ((Math.atan2(dx, dy) / DEG) + 360) % 360;
};

/**
 * Walkable street-level view (Panoramax imagery in Photo Sphere Viewer).
 * Drag to look around, ▲/▼ (or W/S, ↑/↓) to walk along the street, 🎲 to
 * jump to another street nearby. Flat camera photos are shown as a partial
 * panorama, clamped to what the camera actually saw.
 */
export default function StreetView({
  lat,
  lng,
  onAvailability,
}: {
  lat: number;
  lng: number;
  onAvailability?: (count: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [pics, setPics] = useState<StreetPic[] | null>(null);
  const [pic, setPic] = useState<StreetPic | null>(null);
  const [loading, setLoading] = useState(true);
  const [heading, setHeading] = useState(0);
  const [steps, setSteps] = useState(0);
  const availRef = useRef(onAvailability);
  availRef.current = onAvailability;
  const picRef = useRef<StreetPic | null>(null);
  picRef.current = pic;

  // search results lack prev/next links — load the full item to be able to walk
  const show = useCallback(async (p: StreetPic) => {
    setLoading(true);
    const full = await streetPic(p.collection, p.id);
    setPic(full ?? p);
  }, []);

  // find imagery around the drop
  useEffect(() => {
    let alive = true;
    setPics(null);
    streetPicsNear(lat, lng).then((list) => {
      if (!alive) return;
      setPics(list);
      availRef.current?.(list.length);
      if (list[0]) show(list[0]);
      else setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [lat, lng, show]);

  // one viewer for the whole session
  useEffect(() => {
    if (!el.current || !pics?.length) return;
    const v = new Viewer({
      container: el.current,
      navbar: false,
      defaultZoomLvl: 0,
      minFov: 30,
      maxFov: 90,
      mousewheelCtrlKey: false,
      loadingTxt: "",
      touchmoveTwoFingers: false,
    });
    viewer.current = v;
    // clear "Walking…" as soon as the image is in, not when the fade ends
    v.addEventListener("panorama-loaded", () => setLoading(false));

    // flat photos: keep the camera inside what was actually photographed
    v.addEventListener("position-updated", ({ position }) => {
      const p = picRef.current;
      if (p) setHeading(((p.heading ?? 0) + position.yaw / DEG + 360) % 360);
      if (!p || p.fov >= 360) return;
      const half = (p.fov / 2) * DEG;
      const view = (v.state.hFov / 2) * DEG;
      const maxYaw = Math.max(0, half - view);
      let yaw = position.yaw > Math.PI ? position.yaw - 2 * Math.PI : position.yaw;
      const maxPitch = Math.max(0, (p.fov / 4) * DEG - (v.state.vFov / 2) * DEG);
      const pitch = Math.max(-maxPitch, Math.min(maxPitch, position.pitch));
      const clamped = Math.max(-maxYaw, Math.min(maxYaw, yaw));
      if (clamped !== yaw || pitch !== position.pitch) {
        yaw = clamped;
        v.rotate({ yaw, pitch });
      }
    });
    return () => {
      v.destroy();
      viewer.current = null;
    };
  }, [pics]);

  // show the current picture
  useEffect(() => {
    const v = viewer.current;
    if (!v || !pic) return;
    setLoading(true);
    const flat = pic.fov < 360;
    const panoData = flat
      ? (img: HTMLImageElement): PanoData => {
          const fullWidth = Math.round((img.width * 360) / pic.fov);
          const fullHeight = Math.round(fullWidth / 2);
          return {
            isEquirectangular: true,
            fullWidth,
            fullHeight,
            croppedWidth: img.width,
            croppedHeight: img.height,
            croppedX: Math.round((fullWidth - img.width) / 2),
            croppedY: Math.round((fullHeight - img.height) / 2),
            poseHeading: 0,
            posePitch: 0,
            poseRoll: 0,
          };
        }
      : undefined;
    // PSV zoom limits are *vertical* FOV: for a flat photo pick the widest
    // vertical FOV whose horizontal span still fits inside the photo
    if (flat) {
      const aspect = (el.current?.clientWidth || 16) / (el.current?.clientHeight || 9);
      const vMax = (2 * Math.atan(Math.tan(((pic.fov - 2) / 2) * DEG) / aspect)) / DEG;
      v.setOptions({ maxFov: Math.max(10, vMax), minFov: Math.max(6, Math.min(30, vMax * 0.45)) });
    } else {
      v.setOptions({ maxFov: 90, minFov: 30 });
    }
    v.setPanorama(pic.src, {
      panoData,
      position: { yaw: 0, pitch: 0 },
      zoom: 0,
      transition: false, // instant step — fades can stall in background tabs
      showLoader: true,
    })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pic]);

  const [blocked, setBlocked] = useState<"next" | "prev" | null>(null);
  const headingRef = useRef(0);
  headingRef.current = heading;

  /**
   * Walk forward/back. Follows the capture sequence when the picture has one;
   * otherwise steps to the nearest picture in the direction you're looking
   * (▲) or behind you (▼), like the arrows in Street View.
   */
  const walk = useCallback(async (dir: "next" | "prev") => {
    const cur = picRef.current;
    if (!cur) return;
    setLoading(true);
    let nxt: StreetPic | null = null;
    const linked = cur[dir];
    if (linked) nxt = await streetPic(cur.collection, linked);
    if (!nxt) {
      const around = await streetPicsNear(cur.lat, cur.lng);
      const want = (headingRef.current + (dir === "prev" ? 180 : 0)) % 360;
      const scored = around
        .filter((p) => p.id !== cur.id)
        .map((p) => {
          const d = metresBetween(cur.lat, cur.lng, p.lat, p.lng);
          const off = Math.abs(((bearing(cur.lat, cur.lng, p.lat, p.lng) - want + 540) % 360) - 180);
          return { p, d, off };
        })
        .filter((x) => x.d > 6 && x.d < 600);
      const pick =
        scored.filter((x) => x.off < 40).sort((a, b) => a.d - b.d)[0] ??
        scored.filter((x) => x.off < 80).sort((a, b) => a.d - b.d)[0];
      if (pick) nxt = (await streetPic(pick.p.collection, pick.p.id)) ?? pick.p;
    }
    if (nxt) {
      setPic(nxt);
      setSteps((st) => st + 1);
    } else {
      setLoading(false);
      setBlocked(dir);
      setTimeout(() => setBlocked(null), 1400);
    }
  }, []);

  const jump = () => {
    if (!pics?.length) return;
    // prefer a different capture sequence = a different street
    const others = pics.filter((p) => p.collection !== pic?.collection);
    const pool = others.length ? others : pics;
    show(pool[Math.floor(Math.random() * pool.length)]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") walk("next");
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") walk("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walk]);

  if (pics && pics.length === 0)
    return (
      <div className="photo-empty">
        No street imagery has been captured around this drop. Explore the Satellite and Streets views and hunt for 🔍
        signs instead.
      </div>
    );

  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return (
    <div className="street-view">
      <div ref={el} className="street-canvas" />
      {pic?.heading !== null && pic && (
        <div className="compass" aria-label={`Facing ${Math.round(heading)}°`}>
          {/* 2px per degree, labels every 45°; centre the middle copy on the heading */}
          <div className="compass-strip" style={{ transform: `translateX(${150 - (8 * 90 + 45) - heading * 2}px)` }}>
            {Array.from({ length: 3 * 8 }, (_, i) => (
              <span key={i} className={i % 2 === 0 ? "major" : ""}>
                {dirs[i % 8]}
              </span>
            ))}
          </div>
          <div className="compass-needle" />
        </div>
      )}
      <div className="walk-pad">
        <button className="walk-btn" onClick={() => walk("next")} disabled={!pic || loading} title="Walk forward (W / ↑)">
          ▲
        </button>
        <button className="walk-btn" onClick={() => walk("prev")} disabled={!pic || loading} title="Walk back (S / ↓)">
          ▼
        </button>
      </div>
      <button className="street-jump" onClick={jump} disabled={!pics || pics.length < 2}>
        🎲 Another street
      </button>
      <div className="street-meta">
        {pic && pic.fov < 360 ? "📷 Street photo · drag to look around" : "🌐 360° panorama · drag to look around"}
        {steps > 0 && ` · ${steps} steps walked`}
      </div>
      {loading && <div className="street-loading">Walking…</div>}
      {blocked && !loading && (
        <div className="street-loading">No path that way — turn around or try another street</div>
      )}
      <a className="street-credit" href="https://panoramax.fr" target="_blank" rel="noreferrer">
        Imagery: Panoramax contributors
      </a>
    </div>
  );
}
