import { ReactNode, useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_KEY } from "../lib/config";
import { PlacePhoto, placePhotos } from "../lib/imagery";
import { Clues, cluesFor } from "../lib/clues";
import { huntMusic, musicMuted, setMusicMuted } from "../lib/music";
import CluePanel from "./CluePanel";
import { DropView, GuessMap } from "./maps";
import PhotoView from "./PhotoView";

type View = "satellite" | "streets" | "photos" | "street-view";

export interface StageProps {
  target: { lat: number; lng: number };
  pin: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number }) => void;
  pinColor: string;
  /** can the player place / move a pin right now */
  canPin: boolean;
  lockLabel: string;
  canLock: boolean;
  onLock: () => void;
  /** overlays (timer, players…) drawn on top of the stage */
  hud?: ReactNode;
  /** tutorial spotlight */
  spot?: "views" | "map" | "lock" | "clues" | null;
  /** words that would name the place — filtered out of every clue */
  hide: string[];
  driveLeft: boolean;
  /** for the music's tension */
  timeLeft?: number;
  totalTime?: number;
}

/**
 * GeoGuessr-style round: the place fills the screen, and a small map in the
 * corner grows when you hover or tap it so you can drop your pin.
 */
export default function GuessStage(p: StageProps) {
  const [view, setView] = useState<View>("satellite");
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [big, setBig] = useState(false);
  const [stick, setStick] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout>>();
  const [clues, setClues] = useState<Clues | null>(null);
  const [cluesLoading, setCluesLoading] = useState(true);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [muted, setMuted] = useState(musicMuted);

  useEffect(() => {
    setCluesLoading(true);
    setFound(new Set());
    cluesFor(p.target.lat, p.target.lng, p.hide).then((c) => {
      setClues(c);
      setCluesLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.target.lat, p.target.lng]);

  useEffect(() => {
    if (muted) huntMusic.stop();
    else huntMusic.start();
    return () => huntMusic.stop();
  }, [muted]);

  useEffect(() => {
    if (p.timeLeft === undefined || !p.totalTime) return;
    // calm while exploring, urgent in the last ~15 seconds
    huntMusic.setIntensity(p.timeLeft < 15 ? 1 - p.timeLeft / 15 + 0.4 : 0);
  }, [p.timeLeft, p.totalTime]);

  const find = (id: number) => setFound((f) => (f.has(id) ? f : new Set(f).add(id)));

  useEffect(() => {
    setPhotosLoading(true);
    placePhotos(p.target.lat, p.target.lng).then((ph) => {
      setPhotos(ph);
      setPhotosLoading(false);
    });
  }, [p.target.lat, p.target.lng]);

  const expanded = big || stick || p.spot === "map";
  const tabs: { id: View; label: string }[] = [
    { id: "satellite", label: "🛰 Satellite" },
    { id: "streets", label: "🛣 Streets" },
    { id: "photos", label: `📷 Photos${photosLoading ? "" : ` (${photos.length})`}` },
    ...(GOOGLE_MAPS_KEY ? [{ id: "street-view" as View, label: "🚶 Street View" }] : []),
  ];

  return (
    <div className="stage">
      <div className="stage-view">
        {view === "satellite" && (
          <DropView lat={p.target.lat} lng={p.target.lng} className="stage-map" signs={clues?.signs} found={found} onFind={find} />
        )}
        {view === "streets" && (
          <DropView
            lat={p.target.lat}
            lng={p.target.lng}
            mode="streets"
            className="stage-map streets"
            signs={clues?.signs}
            found={found}
            onFind={find}
          />
        )}
        {view === "photos" && <PhotoView photos={photos} loading={photosLoading} />}
        {view === "street-view" && GOOGLE_MAPS_KEY && (
          <iframe
            className="stage-map"
            title="Street View"
            src={`https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_MAPS_KEY}&location=${p.target.lat},${p.target.lng}&radius=5000&fov=90`}
            allowFullScreen
          />
        )}
      </div>

      <div className={`view-tabs ${p.spot === "views" ? "spot" : ""}`}>
        {tabs.map((t) => (
          <button key={t.id} className={view === t.id ? "on" : ""} onClick={() => setView(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={p.spot === "clues" ? "spot-wrap" : ""}>
        <CluePanel
          clues={clues}
          loading={cluesLoading}
          found={found}
          driveLeft={p.driveLeft}
          onShowSign={() => setView((v) => (v === "photos" ? "satellite" : v))}
        />
      </div>

      <button
        className="music-btn"
        onClick={() => {
          setMusicMuted(!muted);
          setMuted(!muted);
        }}
        title={muted ? "Play music" : "Mute music"}
      >
        {muted ? "🔇" : "🎵"}
      </button>

      {p.hud}

      <div
        className={`minimap ${expanded ? "big" : ""} ${p.spot === "map" ? "spot" : ""}`}
        onMouseEnter={() => {
          clearTimeout(leave.current);
          setBig(true);
        }}
        onMouseLeave={() => {
          leave.current = setTimeout(() => setBig(false), 700);
        }}
      >
        <div className="minimap-bar">
          <span>{p.pin ? "Your pin" : expanded ? "Click to drop your pin" : "Guess map"}</span>
          <button
            className={`pin-toggle ${stick ? "on" : ""}`}
            onClick={() => setStick((s) => !s)}
            title={stick ? "Let the map shrink" : "Keep the map big"}
          >
            {stick ? "⤡" : "⤢"}
          </button>
        </div>
        <div className="minimap-map" onClickCapture={() => !expanded && setBig(true)}>
          <GuessMap
            value={p.pin}
            onPick={p.onPick}
            color={p.pinColor}
            disabled={!p.canPin || !expanded}
            className="mini-leaflet"
          />
        </div>
        <button className={`btn btn-primary guess-btn ${p.spot === "lock" ? "spot" : ""}`} disabled={!p.canLock} onClick={p.onLock}>
          {p.lockLabel}
        </button>
      </div>
    </div>
  );
}
