import { useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Duel } from "../hooks/useDuel";
import { fromMicro } from "../lib/geoClient";
import { PLAYER_COLORS } from "../lib/geo";
import { playerAvatar, playerName } from "../lib/identity";
import GuessStage from "./GuessStage";

export default function Round({ duel }: { duel: Duel }) {
  const game = duel.game!;
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(duel.myGuess);
  const target = { lat: fromMicro(game.targetLat), lng: fromMicro(game.targetLng) };
  const locked = !!duel.myGuess || (duel.myIndex >= 0 && game.players[duel.myIndex].locked);
  const total = game.guessSecs + 6;
  const pct = Math.max(0, Math.min(1, duel.timeLeft / total));
  const urgent = duel.timeLeft <= 10;
  const pot = (game.stake.toNumber() / LAMPORTS_PER_SOL) * game.players.length;
  const lockedCount = game.players.filter((p) => p.locked).length;
  const timeUp = duel.timeLeft <= 0;

  const lockLabel = !duel.joined
    ? "Spectating"
    : locked
      ? "🔒 Locked in — waiting for others"
      : duel.busy === "Locking in"
        ? "Confirm in your wallet…"
        : timeUp
          ? "Time's up"
          : pick
            ? "Lock in guess"
            : "Place your pin on the map";

  const hud = (
    <>
      <div className="hud-top">
        <div className={`timer timer-sm${urgent ? " urgent" : ""}`} style={{ ["--p" as string]: pct }}>
          <span className="mono">{Math.ceil(duel.timeLeft)}</span>
        </div>
        <div>
          <div className="mono hud-pot">{pot.toFixed(3)} SOL pot</div>
          <div className="hud-sub">
            {lockedCount}/{game.players.length} locked in · sealed in the TEE
          </div>
        </div>
      </div>
      <ul className="hud-players">
        {game.players.map((pl, i) => (
          <li key={pl.player.toBase58()} className={pl.locked ? "locked" : ""}>
            <span className="avatar" style={{ background: PLAYER_COLORS[i] }}>
              {playerAvatar(pl.player)}
            </span>
            <span className="pname">
              {playerName(pl.player)}
              {i === duel.myIndex && " (you)"}
            </span>
            <span className="lock-ico">{pl.locked ? "🔒" : "…"}</span>
          </li>
        ))}
      </ul>
      {(duel.allLocked || timeUp) && <div className="reveal-banner">Revealing sealed guesses…</div>}
      {duel.error && (
        <div className="toast" onClick={duel.clearError}>
          {duel.error}
        </div>
      )}
    </>
  );

  return (
    <GuessStage
      target={target}
      pin={pick}
      onPick={setPick}
      pinColor={PLAYER_COLORS[Math.max(0, duel.myIndex)]}
      canPin={duel.joined && !locked && !timeUp}
      lockLabel={lockLabel}
      canLock={duel.joined && !!pick && !locked && !duel.busy && !timeUp}
      onLock={() => pick && duel.submitGuess(pick.lat, pick.lng)}
      hud={hud}
    />
  );
}
