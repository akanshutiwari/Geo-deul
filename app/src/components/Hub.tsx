import { useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { GeoClient } from "../lib/geoClient";
import { DEFAULT_MAX_PLAYERS, PLAY_COST_SOL, STAKE_PRESETS_SOL, TIMER_PRESETS_S } from "../lib/config";
import { idFromCode, newGameId } from "../lib/geo";
import { playerAvatar, playerName } from "../lib/identity";
import Flyover from "./Flyover";

const friendly = (e: unknown) => {
  const t = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(t)) return "You declined the transaction in your wallet.";
  if (/insufficient|0x1\b|debit/i.test(t)) return "Not enough SOL in your wallet for this stake.";
  return t.slice(0, 180);
};

/** Signed-in home: open a duel, join one by code, or practice. */
export default function Hub({
  client,
  balance,
  onOpen,
  onPractice,
}: {
  client: GeoClient;
  balance: number | null;
  onOpen: (gameId: BN) => void;
  onPractice: () => void;
}) {
  const [stake, setStake] = useState(0.01);
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_MAX_PLAYERS);
  const [timer, setTimer] = useState(60);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const need = stake + PLAY_COST_SOL;
  const short = balance !== null && balance < need;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = newGameId();
      await client.createGame(id, new BN(Math.round(stake * LAMPORTS_PER_SOL)), maxPlayers, timer);
      onOpen(id);
    } catch (e) {
      setError(friendly(e));
    }
    setBusy(false);
  };

  const join = () => {
    try {
      const raw = code.includes("duel=") ? new URL(code).searchParams.get("duel") || "" : code;
      onOpen(idFromCode(raw));
    } catch {
      setError("That doesn't look like a duel code");
    }
  };

  return (
    <div className="hub">
      <Flyover />
      <div className="hub-inner">
        <div className="hub-hello">
          <span className="hello-avatar">{playerAvatar(client.publicKey)}</span>
          <div>
            <div className="muted small">Welcome back, explorer</div>
            <div className="hello-name">{playerName(client.publicKey)}</div>
          </div>
        </div>

        <div className="hub-grid">
          <div className="card hub-card">
            <h2 className="card-title">Create a duel</h2>
            <label className="field">
              <span>Stake per player</span>
              <div className="seg">
                {STAKE_PRESETS_SOL.map((s) => (
                  <button key={s} className={stake === s ? "on" : ""} onClick={() => setStake(s)}>
                    {s === 0 ? "Free" : `${s} SOL`}
                  </button>
                ))}
              </div>
            </label>
            <label className="field">
              <span>
                Players <strong className="mono">up to {maxPlayers}</strong>
              </span>
              <input type="range" min={2} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Guess timer</span>
              <div className="seg">
                {TIMER_PRESETS_S.map((t) => (
                  <button key={t} className={timer === t ? "on" : ""} onClick={() => setTimer(t)}>
                    {t}s
                  </button>
                ))}
              </div>
            </label>
            <button className="btn btn-primary btn-lg" onClick={create} disabled={busy || short}>
              {busy ? "Confirm in your wallet…" : stake > 0 ? `Create duel · stake ${stake} SOL` : "Create free duel"}
            </button>
            {short ? (
              <p className="warn small">Your wallet needs ~{need.toFixed(3)} SOL for this.</p>
            ) : (
              <p className="muted small">Winner takes up to {(stake * maxPlayers).toFixed(2)} SOL.</p>
            )}
          </div>

          <div className="hub-side">
            <div className="card hub-card">
              <h2 className="card-title">Join with code</h2>
              <div className="row">
                <input
                  className="input mono code-input"
                  placeholder="DUEL CODE"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && code && join()}
                />
                <button className="btn btn-primary" onClick={join} disabled={!code}>
                  Join
                </button>
              </div>
            </div>
            <button className="card hub-card practice" onClick={onPractice}>
              <span className="practice-icon">🧭</span>
              <span>
                <span className="card-title">Practice round</span>
                <span className="muted small block">Free, solo, with tips from Atlas.</span>
              </span>
            </button>
          </div>
        </div>
        {error && <p className="toast" onClick={() => setError(null)}>{error}</p>}
      </div>
    </div>
  );
}
