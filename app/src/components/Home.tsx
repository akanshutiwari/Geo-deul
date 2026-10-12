import { useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { GeoClient } from "../lib/geoClient";
import { DEFAULT_MAX_PLAYERS, PLAY_COST_SOL, STAKE_PRESETS_SOL, TIMER_PRESETS_S } from "../lib/config";
import { idFromCode, newGameId } from "../lib/geo";

const STEPS = [
  { icon: "🎲", title: "VRF drops you", body: "A verifiable random draw picks the spot — nobody, not even the host, can study the round in advance." },
  { icon: "🔒", title: "Sealed guesses", body: "Pins are locked inside a Private Ephemeral Rollup (TEE). Everyone sees who locked in, nobody sees where." },
  { icon: "⏱️", title: "Real-time round", body: "Timer and reveal run on the rollup at millisecond speed. The reveal fires the moment the last pin lands." },
  { icon: "💰", title: "Closest takes the pot", body: "Stakes sit in an on-chain escrow. The closest guess is paid automatically — ties split the pot." },
];

export default function Home({
  client,
  balance,
  onOpen,
}: {
  client: GeoClient;
  balance: number | null;
  onOpen: (gameId: BN) => void;
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
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e));
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
    <div className="home">
      <section className="hero">
        <p className="eyebrow">Built on MagicBlock Ephemeral Rollups</p>
        <h1>
          Dropped somewhere on Earth.
          <br />
          <span className="accent">Closest pin takes the pot.</span>
        </h1>
        <p className="lede">
          Geo Duels is GeoGuessr with skin in the game: you and your friends land on the same random satellite view,
          lock in sealed guesses against the clock, and the escrow pays whoever lands nearest.
        </p>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Start a duel</h2>
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
            {busy ? "Opening lobby…" : stake > 0 ? `Open lobby · stake ${stake} SOL` : "Open free lobby"}
          </button>
          {short && <p className="warn small">Needs ~{need.toFixed(3)} SOL — fund your burner above.</p>}
          <p className="muted small">Pot = stake × players. Max pot here: {(stake * maxPlayers).toFixed(2)} SOL.</p>
        </div>

        <div className="card">
          <h2>Join a duel</h2>
          <p className="muted">Paste a duel code or invite link.</p>
          <div className="row">
            <input
              className="input mono"
              placeholder="e.g. 1A2B3C4D5E"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code && join()}
            />
            <button className="btn" onClick={join} disabled={!code}>
              Go
            </button>
          </div>
          <div className="mini-globe" aria-hidden>
            <div className="globe" />
          </div>
          <p className="muted small">Your friends get the code (and a QR) as soon as you open a lobby.</p>
        </div>
      </section>
      {error && <p className="error">{error}</p>}

      <section className="steps">
        {STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="step-icon">{s.icon}</div>
            <div className="step-n mono">0{i + 1}</div>
            <h3>{s.title}</h3>
            <p className="muted">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
