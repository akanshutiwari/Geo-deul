import type { GameAccount } from "../lib/geoClient";
import { PLAYER_COLORS } from "../lib/geo";
import { shortKey } from "../lib/wallet";

/** Roster with live lock-in badges — shows *who* locked in, never *where*. */
export default function PlayerList({
  game,
  myIndex,
  showLocks,
}: {
  game: GameAccount;
  myIndex: number;
  showLocks?: boolean;
}) {
  const empty = Math.max(0, game.maxPlayers - game.players.length);
  return (
    <ul className="players">
      {game.players.map((p, i) => (
        <li key={p.player.toBase58()} className={i === myIndex ? "me" : ""}>
          <span className="avatar" style={{ background: PLAYER_COLORS[i] }}>
            {i + 1}
          </span>
          <span className="mono">{shortKey(p.player)}</span>
          {i === 0 && <span className="tag">host</span>}
          {i === myIndex && <span className="tag tag-me">you</span>}
          {showLocks && (
            <span className={`lock ${p.locked ? "on" : ""}`}>{p.locked ? "🔒 locked in" : "thinking…"}</span>
          )}
        </li>
      ))}
      {!showLocks &&
        Array.from({ length: empty }).map((_, i) => (
          <li key={`e${i}`} className="empty">
            <span className="avatar">?</span>
            <span className="muted">open seat</span>
          </li>
        ))}
    </ul>
  );
}
