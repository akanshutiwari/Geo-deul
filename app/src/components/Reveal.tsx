import { useEffect, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Duel } from "../hooks/useDuel";
import { fromMicro, isWinner } from "../lib/geoClient";
import { LOCATIONS } from "../lib/locations";
import { PLAYER_COLORS, formatDistance, points } from "../lib/geo";
import { playerAvatar, playerName } from "../lib/identity";
import { explorerTx } from "../lib/config";
import { ResultMap, ResultPin } from "./maps";

function Confetti() {
  const bits = Array.from({ length: 60 });
  return (
    <div className="confetti" aria-hidden>
      {bits.map((_, i) => (
        <i
          key={i}
          style={{
            left: `${Math.random() * 100}%`,
            background: PLAYER_COLORS[i % PLAYER_COLORS.length],
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${2.2 + Math.random() * 1.6}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function Reveal({ duel, onRematch }: { duel: Duel; onRematch: () => void }) {
  const game = duel.game!;
  const loc = LOCATIONS[game.locationIndex];
  const target = { lat: fromMicro(game.targetLat), lng: fromMicro(game.targetLng) };
  const stake = game.stake.toNumber() / LAMPORTS_PER_SOL;
  const pot = stake * game.players.length;
  const winners = game.players.map((_, i) => i).filter((i) => isWinner(game, i));
  const iWon = duel.myIndex >= 0 && isWinner(game, duel.myIndex);
  const share = winners.length ? pot / winners.length : 0;
  const [showConfetti, setShowConfetti] = useState(iWon);
  useEffect(() => {
    if (!iWon) return;
    setShowConfetti(true);
    const t = setTimeout(() => setShowConfetti(false), 4500);
    return () => clearTimeout(t);
  }, [iWon]);

  const ranked = game.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.guessed ? a.p.distanceM : Infinity) - (b.p.guessed ? b.p.distanceM : Infinity));

  // reveal farthest first so the winner's line lands last
  const pins: ResultPin[] = [...ranked]
    .reverse()
    .filter(({ p }) => p.guessed)
    .map(({ p, i }) => ({
      lat: fromMicro(p.lat),
      lng: fromMicro(p.lng),
      color: PLAYER_COLORS[i],
      label: String(i + 1),
      winner: isWinner(game, i),
    }));

  const paid = game.paid || duel.phase === "settled";

  return (
    <div className="reveal">
      {showConfetti && <Confetti />}
      <div className="reveal-head">
        <p className="eyebrow">You were dropped near</p>
        <h2>
          {loc.name}, <span className="accent">{loc.country}</span>
        </h2>
        <p className="mono muted small">
          {target.lat.toFixed(4)}, {target.lng.toFixed(4)}
        </p>
      </div>

      <div className="grid-reveal">
        <div className="pane tall">
          <ResultMap target={target} pins={pins} />
        </div>
        <div className="card">
          <h3>{winners.length === 0 ? "Nobody guessed — stakes refunded" : iWon ? "🏆 You win!" : winners.length > 1 ? "Split pot!" : "Results"}</h3>
          <ol className="leaderboard">
            {ranked.map(({ p, i }, rank) => (
              <li key={p.player.toBase58()} className={`${isWinner(game, i) ? "win" : ""} ${i === duel.myIndex ? "me" : ""}`}>
                <span className="rank mono">{rank + 1}</span>
                <span className="avatar" style={{ background: PLAYER_COLORS[i] }}>
                  {playerAvatar(p.player)}
                </span>
                <span className="who">
                  <span className="pname">{playerName(p.player)}</span>
                  {i === duel.myIndex && <span className="tag tag-me">you</span>}
                </span>
                <span className="dist mono">{p.guessed ? formatDistance(p.distanceM) : "no guess"}</span>
                <span className="pts mono muted">{p.guessed ? `${points(p.distanceM)} pts` : ""}</span>
                {isWinner(game, i) && stake > 0 && <span className="prize mono">+{share.toFixed(3)}</span>}
              </li>
            ))}
          </ol>

          <div className={`payout ${paid ? "done" : ""}`}>
            {stake === 0 ? (
              <span>Free duel — bragging rights only.</span>
            ) : paid ? (
              <span>
                ✅ Pot of {pot.toFixed(3)} SOL paid from escrow
                {duel.payoutSig && (
                  <>
                    {" · "}
                    <a href={explorerTx(duel.payoutSig)} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  </>
                )}
              </span>
            ) : duel.delegated ? (
              <span className="pulse">Committing results back to Solana…</span>
            ) : (
              <span className="pulse">Paying the winner from escrow…</span>
            )}
          </div>
          <button className="btn btn-primary" onClick={onRematch}>
            New duel
          </button>
        </div>
      </div>
    </div>
  );
}
