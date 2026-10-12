import { ReactNode, useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_KEY } from "../lib/config";
import { PlacePhoto, placePhotos } from "../lib/imagery";
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
  spot?: "views" | "map" | "lock" | null;
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
        {view === "satellite" && <DropView lat={p.target.lat} lng={p.target.lng} className="stage-map" />}
        {view === "streets" && <DropView lat={p.target.lat} lng={p.target.lng} mode="streets" className="stage-map streets" />}
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
