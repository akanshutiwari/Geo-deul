import BN from "bn.js";
import type { GeoClient } from "../lib/geoClient";
import { useDuel } from "../hooks/useDuel";
import { codeFromId } from "../lib/geo";
import Lobby from "./Lobby";
import Round from "./Round";
import Reveal from "./Reveal";
import ActivityLog from "./ActivityLog";

export default function DuelPage({
  client,
  gameId,
  balance,
  onHome,
}: {
  client: GeoClient;
  gameId: BN;
  balance: number | null;
  onHome: () => void;
}) {
  const duel = useDuel(client, gameId);
  const code = codeFromId(gameId);

  let body;
  if (!duel.loaded) body = <div className="center muted">Loading duel…</div>;
  else if (!duel.game)
    body = (
      <div className="center card narrow">
        <h2>Duel not found</h2>
        <p className="muted">
          No duel with code <span className="mono">{code}</span> on this network.
        </p>
        <button className="btn" onClick={onHome}>
          Back
        </button>
      </div>
    );
  else if (duel.phase === "lobby" || duel.phase === "locating") body = <Lobby duel={duel} code={code} balance={balance} />;
  // the round takes over the whole screen
  else if (duel.phase === "guessing") return <Round duel={duel} />;
  else if (duel.phase === "cancelled")
    body = (
      <div className="center card narrow">
        <h2>Duel cancelled</h2>
        <p className="muted">Every stake was refunded from escrow.</p>
        <button className="btn" onClick={onHome}>
          Back home
        </button>
      </div>
    );
  else body = <Reveal duel={duel} onRematch={onHome} />;

  return (
    <div className="duel">
      {body}
      {duel.error && (
        <div className="toast" onClick={duel.clearError}>
          {duel.error}
        </div>
      )}
      <ActivityLog log={duel.log} client={client} open={duel.phase === "revealed" || duel.phase === "settled"} />
    </div>
  );
}
