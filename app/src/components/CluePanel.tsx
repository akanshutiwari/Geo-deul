import { useState } from "react";
import { Clues, scriptOf } from "../lib/clues";

/** GeoGuessr-style clue cards. Sign clues unlock as you find 🔍 markers. */
export default function CluePanel({
  clues,
  loading,
  found,
  driveLeft,
  onShowSign,
}: {
  clues: Clues | null;
  loading: boolean;
  found: Set<number>;
  driveLeft: boolean;
  onShowSign: () => void;
}) {
  const [open, setOpen] = useState(true);
  const signs = clues?.signs ?? [];
  const foundSigns = signs.filter((s) => found.has(s.id));
  const scripts = [...new Set(foundSigns.map((s) => scriptOf(s.text)))];
  const worship = Object.entries(clues?.worship ?? {});

  return (
    <div className={`clue-panel ${open ? "" : "closed"}`}>
      <button className="clue-head" onClick={() => setOpen((o) => !o)}>
        <span>🔎 Clues</span>
        <span className="clue-count">
          {foundSigns.length}/{signs.length || "…"} signs
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="clue-body">
          {loading && <div className="clue-card muted">Scouting the area for clues…</div>}
          {clues?.localTime && (
            <div className="clue-card">
              <div className="clue-label">🕒 Local time right now</div>
              <div className="clue-value">
                {clues.localTime} {clues.daylight ? "☀️ day" : "🌙 night"}{" "}
                <span className="muted small">({clues.utcOffset})</span>
              </div>
            </div>
          )}
          {clues?.weather && (
            <div className="clue-card">
              <div className="clue-label">🌡️ Weather there</div>
              <div className="clue-value">
                {clues.tempC}°C · {clues.weather}
              </div>
            </div>
          )}
          <div className="clue-card">
            <div className="clue-label">🚗 Traffic</div>
            <div className="clue-value">Drives on the {driveLeft ? "LEFT" : "RIGHT"}</div>
          </div>
          <div className="clue-card">
            <div className="clue-label">🔤 Writing on the signs</div>
            <div className="clue-value">
              {scripts.length ? scripts.join(", ") : <span className="muted">Find a 🔍 sign to reveal</span>}
            </div>
          </div>
          {worship.length > 0 && (
            <div className="clue-card">
              <div className="clue-label">Nearby</div>
              {worship.map(([k, v]) => (
                <div key={k} className="clue-value small">
                  {k}: {v}
                </div>
              ))}
            </div>
          )}
          <div className="clue-card">
            <div className="clue-label">🪧 Signs you found</div>
            {foundSigns.length === 0 ? (
              <div className="muted small">
                {signs.length
                  ? "Pan around the Satellite or Streets view and click the 🔍 markers."
                  : loading
                    ? "…"
                    : "No signs around here — read the land and the photos."}
              </div>
            ) : (
              <ul className="found-signs">
                {foundSigns.map((s) => (
                  <li key={s.id}>
                    <span>{s.icon}</span>
                    <span className="found-text">{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {signs.length > foundSigns.length && foundSigns.length > 0 && (
              <button className="link small" onClick={onShowSign}>
                {signs.length - foundSigns.length} more hidden nearby — keep exploring
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
