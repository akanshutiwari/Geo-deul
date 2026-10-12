import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Duel } from "../hooks/useDuel";
import PlayerList from "./PlayerList";

export default function Lobby({ duel, code, balance }: { duel: Duel; code: string; balance: number | null }) {
  const game = duel.game!;
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?duel=${code}`;
  const stake = game.stake.toNumber() / LAMPORTS_PER_SOL;
  const pot = stake * game.players.length;
  const full = game.players.length >= game.maxPlayers;
  const locating = duel.phase === "locating";

  const copy = () => {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="lobby grid-2">
      <div className="card">
        <div className="row between">
          <h2>{locating ? "Dropping you somewhere…" : "Lobby"}</h2>
          <span className="pot mono">
            Pot <strong>{pot.toFixed(3)}</strong> SOL
          </span>
        </div>
        <p className="muted small">
          {stake > 0 ? `${stake} SOL per player` : "Free duel"} · {game.guessSecs}s to guess · {game.players.length}/{game.maxPlayers} players
        </p>
        <PlayerList game={game} myIndex={duel.myIndex} />

        {locating ? (
          <div className="locating">
            <div className="globe spin" />
            <p>
              The VRF oracle is picking the spot. <span className="muted">Nobody knows it yet — not even the host.</span>
            </p>
            {duel.isHost && (
              <button className="btn btn-ghost btn-sm" onClick={duel.cancel} disabled={!!duel.busy}>
                Oracle stuck? Cancel & refund everyone
              </button>
            )}
          </div>
        ) : duel.isHost ? (
          <div className="actions">
            <button className="btn btn-primary btn-lg" onClick={duel.start} disabled={!!duel.busy}>
              {duel.busy === "Starting" ? "Confirm in your wallet…" : game.players.length < 2 ? "Start solo practice" : `Drop ${game.players.length} players 🌍`}
            </button>
            <button className="btn btn-ghost" onClick={duel.cancel} disabled={!!duel.busy}>
              Cancel & refund
            </button>
          </div>
        ) : duel.joined ? (
          <p className="waiting">Waiting for the host to start the drop…</p>
        ) : full ? (
          <p className="warn">This lobby is full.</p>
        ) : (
          <div className="actions">
            <button className="btn btn-primary btn-lg" onClick={duel.join} disabled={!!duel.busy || (balance !== null && balance < stake + 0.01)}>
              {duel.busy === "Joining" ? "Confirm in your wallet…" : stake > 0 ? `Join · stake ${stake} SOL` : "Join free duel"}
            </button>
            {balance !== null && balance < stake + 0.01 && <p className="warn small">Your wallet needs at least {(stake + 0.01).toFixed(3)} SOL to join.</p>}
          </div>
        )}
      </div>

      <div className="card share">
        <h3>Invite friends</h3>
        <p className="muted small">Anyone with the link can join until the host drops the lobby.</p>
        <div className="code mono" onClick={copy} title="Copy invite link">
          {code}
        </div>
        <div className="qr">
          <QRCodeSVG value={link} size={168} bgColor="transparent" fgColor="currentColor" />
        </div>
        <button className="btn btn-sm" onClick={copy}>
          {copied ? "Copied ✓" : "Copy invite link"}
        </button>
      </div>
    </div>
  );
}
