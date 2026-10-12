import { useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Duel } from "../hooks/useDuel";
import { fromMicro } from "../lib/geoClient";
import { GOOGLE_MAPS_KEY } from "../lib/config";
import { PLAYER_COLORS } from "../lib/geo";
import { GuessMap, SatelliteView } from "./maps";
import PlayerList from "./PlayerList";

export default function Round({ duel }: { duel: Duel }) {
  const game = duel.game!;
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(duel.myGuess);
  const [view, setView] = useState<"sat" | "street">("sat");
  const target = { lat: fromMicro(game.targetLat), lng: fromMicro(game.targetLng) };
  const locked = !!duel.myGuess || (duel.myIndex >= 0 && game.players[duel.myIndex].locked);
  const total = game.guessSecs + 6;
  const pct = Math.max(0, Math.min(1, duel.timeLeft / total));
  const urgent = duel.timeLeft <= 10;
  const pot = (game.stake.toNumber() / LAMPORTS_PER_SOL) * game.players.length;
  const lockedCount = game.players.filter((p) => p.locked).length;
  const timeUp = duel.timeLeft <= 0;

  return (
    <div className="round">
      <div className="round-bar">
        <div className={`timer${urgent ? " urgent" : ""}`} style={{ ["--p" as string]: pct }}>
          <span className="mono">{Math.ceil(duel.timeLeft)}</span>
        </div>
        <div className="round-meta">
          <div className="mono big">{pot.toFixed(3)} SOL pot</div>
          <div className="muted small">
            {lockedCount}/{game.players.length} locked in · guesses sealed in the TEE
          </div>
        </div>
        <PlayerList game={game} myIndex={duel.myIndex} showLocks />
      </div>

      <div className="round-maps">
        <div className="pane">
          <div className="pane-head">
            <span>Where are you?</span>
            {GOOGLE_MAPS_KEY && (
              <div className="seg seg-sm">
                <button className={view === "sat" ? "on" : ""} onClick={() => setView("sat")}>
                  Satellite
                </button>
                <button className={view === "street" ? "on" : ""} onClick={() => setView("street")}>
                  Street View
                </button>
              </div>
            )}
          </div>
          {view === "street" && GOOGLE_MAPS_KEY ? (
            <iframe
              className="map"
              title="Street View"
              src={`https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_MAPS_KEY}&location=${target.lat},${target.lng}&radius=5000&fov=90`}
              allowFullScreen
            />
          ) : (
            <SatelliteView lat={target.lat} lng={target.lng} />
          )}
        </div>

        <div className="pane">
          <div className="pane-head">
            <span>{locked ? "Your sealed guess" : duel.joined ? "Click the map to drop your pin" : "Spectating"}</span>
            {pick && <span className="mono small muted">{pick.lat.toFixed(3)}, {pick.lng.toFixed(3)}</span>}
          </div>
          <GuessMap
            value={pick}
            onPick={setPick}
            color={PLAYER_COLORS[Math.max(0, duel.myIndex)]}
            disabled={locked || !duel.joined || timeUp}
          />
          {duel.joined && (
            <button
              className="btn btn-primary btn-lg lock-btn"
              disabled={!pick || locked || !!duel.busy || timeUp}
              onClick={() => pick && duel.submitGuess(pick.lat, pick.lng)}
            >
              {locked
                ? "🔒 Locked in — waiting for the others"
                : duel.busy === "Locking in"
                  ? "Sealing…"
                  : timeUp
                    ? "Time's up"
                    : pick
                      ? "Lock in guess"
                      : "Drop a pin first"}
            </button>
          )}
        </div>
      </div>
      {(duel.allLocked || timeUp) && <div className="reveal-banner">Revealing sealed guesses…</div>}
    </div>
  );
}
