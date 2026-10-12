import { useCallback, useEffect, useRef, useState } from "react";
import { Viewer, type PanoData } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import { StreetPic, preloadImage, streetPic, streetPicsAround, streetPicsNear } from "../lib/streetview";

const DEG = Math.PI / 180;
const norm = (a: number) => ((a % 360) + 360) % 360;
/** signed smallest difference a - b in degrees, in (-180, 180] */
const diff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

const metresBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (bLng - aLng) * 111_320 * Math.cos(aLat * DEG);
  const dy = (bLat - aLat) * 110_540;
  return Math.hypot(dx, dy);
};
/** compass bearing from a to b, degrees */
const bearingTo = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (bLng - aLng) * Math.cos(aLat * DEG);
  const dy = bLat - aLat;
  return norm(Math.atan2(dx, dy) / DEG);
};

interface Exit {
  pic: StreetPic;
  bearing: number;
  dist: number;
}

/** One exit per direction: the nearest picture in each ~40° sector, 4–140 m away. */
const exitsFrom = (cur: StreetPic, around: StreetPic[], linked: StreetPic[]): Exit[] => {
  const seen = new Set<string>([cur.id]);
  const all: Exit[] = [];
  for (const p of [...linked, ...around]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const dist = metresBetween(cur.lat, cur.lng, p.lat, p.lng);
    if (dist < 4 || dist > 140) continue;
    all.push({ pic: p, dist, bearing: bearingTo(cur.lat, cur.lng, p.lat, p.lng) });
  }
  // sequence neighbours (same street capture) win their sector
  const linkedIds = new Set(linked.map((p) => p.id));
  all.sort((a, b) => Number(linkedIds.has(b.pic.id)) - Number(linkedIds.has(a.pic.id)) || a.dist - b.dist);
  const exits: Exit[] = [];
  for (const e of all) {
    if (exits.some((x) => Math.abs(diff(x.bearing, e.bearing)) < 40)) continue;
    exits.push(e);
    if (exits.length >= 8) break;
  }
  return exits;
};

/**
 * Walkable street level (Panoramax imagery in Photo Sphere Viewer).
 *  • chevrons on the road for every direction you can go — click to walk
 *  • double-click the road to walk towards that spot
 *  • W/↑ forward · S/↓ back · A/D or ←/→ turn
 * Neighbouring pictures are preloaded while you look around, so steps are
 * instant; a light image shows first and sharpens to HD when you stop.
 */
export default function StreetView({ lat, lng }: { lat: number; lng: number }) {
  const el = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [pics, setPics] = useState<StreetPic[] | null>(null);
  const [pic, setPic] = useState<StreetPic | null>(null);
  const [exits, setExits] = useState<Exit[]>([]);
  const [loading, setLoading] = useState(true);
  const [heading, setHeading] = useState(0);
  const [steps, setSteps] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const picRef = useRef<StreetPic | null>(null);
  picRef.current = pic;
  const exitsRef = useRef<Exit[]>([]);
  exitsRef.current = exits;
  const headingRef = useRef(0);
  headingRef.current = heading;
  /** heading to face after arriving (keep looking the way you walked) */
  const faceRef = useRef<number | null>(null);
  const hdTimer = useRef<ReturnType<typeof setTimeout>>();

  const go = useCallback(async (e: Exit) => {
    faceRef.current = e.bearing;
    setLoading(true);
    // search results lack prev/next links — get the full item (cached/fast)
    const full = await streetPic(e.pic.collection, e.pic.id);
    setPic(full ?? e.pic);
    setSteps((s) => s + 1);
  }, []);
  const goRef = useRef(go);
  goRef.current = go;

  // find imagery around the drop and start on the best picture
  useEffect(() => {
    let alive = true;
    setPics(null);
    streetPicsNear(lat, lng).then(async (list) => {
      if (!alive) return;
      setPics(list);
      if (!list[0]) return setLoading(false);
      const full = await streetPic(list[0].collection, list[0].id);
      if (alive) setPic(full ?? list[0]);
    });
    return () => {
      alive = false;
    };
  }, [lat, lng]);

  // one viewer for the whole round
  useEffect(() => {
    if (!el.current || !pics?.length) return;
    const v = new Viewer({
      container: el.current,
      navbar: false,
      defaultZoomLvl: 0,
      minFov: 30,
      maxFov: 90,
      loadingTxt: "",
      touchmoveTwoFingers: false,
      moveInertia: true,
    });
    viewer.current = v;
    v.addEventListener("panorama-loaded", () => setLoading(false));
    v.addEventListener("position-updated", ({ position }) => {
      const p = picRef.current;
      if (p) setHeading(norm((p.heading ?? 0) + position.yaw / DEG));
      if (!p || p.fov >= 360) return;
      // flat photos: stay inside what the camera actually saw
      const half = (p.fov / 2) * DEG;
      const maxYaw = Math.max(0, half - (v.state.hFov / 2) * DEG);
      const yaw = position.yaw > Math.PI ? position.yaw - 2 * Math.PI : position.yaw;
      const maxPitch = Math.max(0, (p.fov / 4) * DEG - (v.state.vFov / 2) * DEG);
      const cy = Math.max(-maxYaw, Math.min(maxYaw, yaw));
      const cp = Math.max(-maxPitch, Math.min(maxPitch, position.pitch));
      if (cy !== yaw || cp !== position.pitch) v.rotate({ yaw: cy, pitch: cp });
    });
    // double-click the road → walk toward that direction
    v.addEventListener("dblclick", ({ data }) => {
      const p = picRef.current;
      if (!p) return;
      const want = norm((p.heading ?? 0) + data.yaw / DEG);
      const best = [...exitsRef.current].sort(
        (a, b) => Math.abs(diff(a.bearing, want)) - Math.abs(diff(b.bearing, want)),
      )[0];
      if (best && Math.abs(diff(best.bearing, want)) < 60) goRef.current(best);
    });
    return () => {
      v.destroy();
      viewer.current = null;
    };
  }, [pics]);

  // show the current picture (fast image first, HD a moment later)
  useEffect(() => {
    const v = viewer.current;
    if (!v || !pic) return;
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
    if (flat) {
      // PSV zoom limits are vertical FOV: keep the photo filling the screen width
      const aspect = (el.current?.clientWidth || 16) / (el.current?.clientHeight || 9);
      const vMax = (2 * Math.atan(Math.tan(((pic.fov - 2) / 2) * DEG) / aspect)) / DEG;
      v.setOptions({ maxFov: Math.max(10, vMax), minFov: Math.max(6, Math.min(30, vMax * 0.45)) });
    } else {
      v.setOptions({ maxFov: 90, minFov: 30 });
    }
    const face = faceRef.current;
    const yaw = face === null || flat ? 0 : diff(face, pic.heading ?? 0) * DEG;
    faceRef.current = null;
    clearTimeout(hdTimer.current);
    const opts = { panoData, position: { yaw, pitch: 0 }, transition: false as const, showLoader: false };
    v.setPanorama(pic.src, opts)
      .then(
        (done) => {
          // sharpen to HD once the light image is up and the player lingers
          if (!done || pic.hd === pic.src) return;
          hdTimer.current = setTimeout(() => {
            if (picRef.current?.id !== pic.id) return;
            v.setPanorama(pic.hd, { ...opts, position: v.getPosition() }).catch(() => {});
          }, 900);
        },
        // light image failed (some hosts only serve HD) — go straight to HD
        () => (picRef.current?.id === pic.id && pic.hd !== pic.src ? v.setPanorama(pic.hd, opts).catch(() => {}) : null),
      )
      .finally(() => setLoading(false));

    // work out where you can go from here, and preload those steps
    let alive = true;
    (async () => {
      const [around, prev, next] = await Promise.all([
        streetPicsAround(pic.lat, pic.lng),
        pic.prev ? streetPic(pic.collection, pic.prev) : null,
        pic.next ? streetPic(pic.collection, pic.next) : null,
      ]);
      if (!alive) return;
      const ex = exitsFrom(pic, around, [next, prev].filter(Boolean) as StreetPic[]);
      setExits(ex);
      for (const e of ex) {
        preloadImage(e.pic.src);
        streetPic(e.pic.collection, e.pic.id); // warm the item (links) too
      }
    })();
    return () => {
      alive = false;
    };
  }, [pic]);

  /** walk in roughly this compass direction, if there's a way */
  const walkToward = useCallback(
    (want: number) => {
      const best = [...exitsRef.current].sort(
        (a, b) => Math.abs(diff(a.bearing, want)) - Math.abs(diff(b.bearing, want)),
      )[0];
      if (best && Math.abs(diff(best.bearing, want)) < 70) return go(best);
      setBlocked(true);
      setTimeout(() => setBlocked(false), 1200);
    },
    [go],
  );

  const turn = (deg: number) => {
    const v = viewer.current;
    if (!v) return;
    const pos = v.getPosition();
    v.animate({ yaw: pos.yaw + deg * DEG, pitch: pos.pitch, speed: "8rpm" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "arrowup" || k === "w") walkToward(headingRef.current);
      else if (k === "arrowdown" || k === "s") walkToward(norm(headingRef.current + 180));
      else if (k === "arrowleft" || k === "a") turn(-45);
      else if (k === "arrowright" || k === "d") turn(45);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walkToward]);

  const jump = async () => {
    if (!pics?.length) return;
    const others = pics.filter((p) => p.collection !== pic?.collection);
    const pool = others.length ? others : pics;
    const p = pool[Math.floor(Math.random() * pool.length)];
    setLoading(true);
    setPic((await streetPic(p.collection, p.id)) ?? p);
  };

  if (pics && pics.length === 0)
    return (
      <div className="photo-empty">
        No street imagery around this drop. Explore the Satellite and Streets views and hunt for 🔍 signs instead.
      </div>
    );

  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return (
    <div className="street-view">
      <div ref={el} className="street-canvas" />

      <div className="compass" aria-label={`Facing ${Math.round(heading)}°`}>
        <div className="compass-strip" style={{ transform: `translateX(${150 - (8 * 90 + 45) - heading * 2}px)` }}>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} className={i % 2 === 0 ? "major" : ""}>
              {dirs[i % 8]}
            </span>
          ))}
        </div>
        <div className="compass-needle" />
      </div>

      {/* chevrons painted on the road, one per way you can walk */}
      <div className="ground">
        <div className="ground-ring">
          {exits.map((e) => {
            const rel = diff(e.bearing, heading);
            return (
              <button
                key={e.pic.id}
                className={`chevron ${Math.abs(rel) < 25 ? "ahead" : ""}`}
                style={{ transform: `rotate(${rel}deg) translateY(-104px)` }}
                onClick={() => go(e)}
                title={`Walk ${Math.round(e.dist)} m`}
                aria-label={`Walk ${rel > 25 ? "right" : rel < -25 ? "left" : "forward"}`}
              >
                <svg viewBox="0 0 64 64" aria-hidden>
                  <path d="M6 44 L32 16 L58 44 L48 52 L32 34 L16 52 Z" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      <div className="turn-pad">
        <button className="walk-btn sm" onClick={() => turn(-45)} title="Turn left (A / ←)">
          ⟲
        </button>
        <button className="walk-btn sm" onClick={() => turn(45)} title="Turn right (D / →)">
          ⟳
        </button>
      </div>
      <button className="street-jump" onClick={jump} disabled={!pics || pics.length < 2}>
        🎲 Another street
      </button>
      <div className="street-meta">
        {exits.length
          ? `${exits.length} way${exits.length > 1 ? "s" : ""} to go · click an arrow or double-click the road · W A S D`
          : pic
            ? "Dead end here — turn around or try another street"
            : ""}
        {steps > 0 && ` · ${steps} steps`}
      </div>
      {loading && <div className="street-loading sm">…</div>}
      {blocked && !loading && <div className="street-loading">No road that way</div>}
      <a className="street-credit" href="https://panoramax.fr" target="_blank" rel="noreferrer">
        Imagery: Panoramax contributors
      </a>
    </div>
  );
}
