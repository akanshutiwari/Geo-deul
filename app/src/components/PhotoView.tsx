import { useEffect, useState } from "react";
import { PlacePhoto } from "../lib/imagery";

/** Full-bleed carousel of photos taken near the drop. */
export default function PhotoView({ photos, loading }: { photos: PlacePhoto[]; loading: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [photos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length]);

  if (loading) return <div className="photo-empty">Finding photos taken around here…</div>;
  if (!photos.length)
    return <div className="photo-empty">No photos were taken near this spot. Use the satellite and street views.</div>;

  const p = photos[i];
  return (
    <div className="photo-view">
      <img key={p.src} className="photo-main" src={p.src} alt="A photo taken near the drop" />
      <button className="photo-nav prev" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Previous photo">
        ‹
      </button>
      <button
        className="photo-nav next"
        onClick={() => setI(Math.min(photos.length - 1, i + 1))}
        disabled={i === photos.length - 1}
        aria-label="Next photo"
      >
        ›
      </button>
      <div className="photo-strip">
        {photos.map((ph, k) => (
          <button key={ph.src} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Photo ${k + 1}`}>
            <img src={ph.thumb} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <a className="photo-credit" href={p.page} target="_blank" rel="noreferrer">
        📷 {p.author}
        {p.license ? ` · ${p.license}` : ""} · Wikimedia Commons
      </a>
    </div>
  );
}
