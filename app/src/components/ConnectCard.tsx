import { useState } from "react";
import { NETWORK_LABEL } from "../lib/config";
import WalletPicker from "./WalletPicker";

/** "Sign up to play", Web3 edition: one button, then pick a wallet. */
export default function ConnectCard({ title, subtitle }: { title: string; subtitle?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="connect-card">
      <h2>{title}</h2>
      {subtitle && <p className="connect-sub">{subtitle}</p>}
      <button className="btn btn-primary btn-lg connect-btn" onClick={() => setOpen(true)}>
        Connect wallet
      </button>
      <p className="connect-foot">
        Plays on Solana <strong>{NETWORK_LABEL}</strong>. Your stake leaves your wallet only when you join a duel.
      </p>
      {open && <WalletPicker onClose={() => setOpen(false)} />}
    </div>
  );
}
