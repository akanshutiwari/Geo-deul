import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

/** Popup listing the wallets injected in this browser; pick one to connect. */
export default function WalletPicker({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect, connecting, connected, wallet } = useWallet();
  const [picked, setPicked] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const installed = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  useEffect(() => {
    if (connected) onClose();
  }, [connected, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // connect once the adapter for the picked wallet is selected
  useEffect(() => {
    if (!picked || wallet?.adapter.name !== picked || connected || connecting) return;
    connect().catch((e) => {
      setPicked(null);
      setError(/reject|denied|cancel/i.test(String(e?.message ?? e)) ? "Connection request was declined." : String(e?.message ?? e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, wallet, connect, connected]);

  const choose = (name: WalletName) => {
    setError(null);
    setPicked(name);
    select(name);
  };

  return createPortal(
    <div className="picker-backdrop" onMouseDown={onClose}>
      <div className="picker" role="dialog" aria-modal="true" aria-label="Connect a wallet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>Connect a wallet</h2>
          <button className="picker-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {installed.length ? (
          <>
            <p className="picker-sub">Wallets detected in this browser</p>
            <ul className="picker-list">
              {installed.map((w) => {
                const busy = connecting && picked === w.adapter.name;
                return (
                  <li key={w.adapter.name}>
                    <button className="picker-item" onClick={() => choose(w.adapter.name)} disabled={connecting}>
                      <img src={w.adapter.icon} alt="" />
                      <span className="picker-name">{w.adapter.name}</span>
                      <span className="picker-tag">{busy ? "Connecting…" : "Detected"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="picker-empty">
            <p>No Solana wallet found in this browser.</p>
            <div className="row wrap">
              <a className="btn btn-primary" href="https://phantom.app/download" target="_blank" rel="noreferrer">
                Get Phantom
              </a>
              <a className="btn" href="https://solflare.com/download" target="_blank" rel="noreferrer">
                Get Solflare
              </a>
            </div>
          </div>
        )}
        {error && <p className="picker-error">{error}</p>}
        <p className="picker-foot">Approve the connection in your wallet. Your stake only leaves it when you join a duel.</p>
      </div>
    </div>,
    document.body,
  );
}
