import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { GeoClient } from "../lib/geoClient";
import { NETWORK_LABEL } from "../lib/config";
import { playerAvatar, playerName } from "../lib/identity";
import { shortKey } from "../lib/wallet";
import WalletPicker from "./WalletPicker";

export default function TopBar({
  client,
  balance,
  onHome,
  onHowTo,
  guest,
}: {
  client: GeoClient | null;
  balance: number | null;
  onHome: () => void;
  onHowTo: () => void;
  guest?: boolean;
}) {
  const { disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [gas, setGas] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    client?.base.getBalance(client.session.publicKey).then((l) => setGas(l / LAMPORTS_PER_SOL), () => {});
    return () => document.removeEventListener("mousedown", close);
  }, [open, client]);

  const returnGas = async () => {
    if (!client) return;
    setMsg("Returning…");
    try {
      await client.returnSessionFunds();
      setGas(0);
      setMsg("Returned to your wallet ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 100) : String(e));
    }
  };

  return (
    <header className="topbar">
      <button className="brand" onClick={onHome}>
        GEO<span className="logo-pin">◉</span>DUELS
      </button>
      <span className="net">{NETWORK_LABEL}</span>
      <div className="spacer" />
      <button className="nav-link" onClick={onHowTo}>
        How to play
      </button>
      {!client && (
        <button className="btn btn-primary btn-sm" onClick={() => setPicker(true)}>
          Connect wallet
        </button>
      )}
      {picker && <WalletPicker onClose={() => setPicker(false)} />}
      {client && (
        <div className="wallet-menu" ref={root}>
          <button className="wallet-chip" onClick={() => setOpen((o) => !o)}>
            <span className="chip-avatar">{playerAvatar(client.publicKey)}</span>
            <span className="chip-name">{playerName(client.publicKey)}</span>
            <span className="bal mono">{balance === null ? "…" : `${balance.toFixed(3)} SOL`}</span>
          </button>
          {open && (
            <div className="wallet-body">
              <div className="mono small muted">{shortKey(client.publicKey, 6)}</div>
              <div className="gas-row">
                <div>
                  <div className="small">Game gas</div>
                  <div className="muted small">
                    Pays for reveals & payouts so you don't get a popup for each step. Topped up automatically when you
                    join.
                  </div>
                </div>
                <span className="mono">{gas === null ? "…" : gas.toFixed(4)}</span>
              </div>
              <div className="row wrap">
                <button className="btn btn-sm" onClick={returnGas} disabled={!gas || gas < 0.0001}>
                  Return gas to wallet
                </button>
                {guest && (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      client.base
                        .requestAirdrop(client.publicKey, LAMPORTS_PER_SOL)
                        .then((sig) => client.base.confirmTransaction(sig, "confirmed"))
                        .then(() => setMsg("Airdropped 1 SOL (dev)"), (e) => setMsg(String(e).slice(0, 100)))
                    }
                  >
                    Dev airdrop
                  </button>
                )}
                {!guest && (
                  <button className="btn btn-sm btn-ghost" onClick={() => disconnect()}>
                    Disconnect
                  </button>
                )}
              </div>
              {msg && <p className="small">{msg}</p>}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
