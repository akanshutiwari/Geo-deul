import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { NETWORK_LABEL } from "../lib/config";

/** "Sign up to play", Web3 edition: pick a wallet and you're in. */
export default function ConnectCard({ title, subtitle }: { title: string; subtitle?: string }) {
  const { wallets, select, connect, connecting, wallet } = useWallet();
  const detected = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  const choose = async (name: (typeof wallets)[number]["adapter"]["name"]) => {
    select(name);
    // selecting triggers autoConnect; connect() again is a no-op if already connecting
    setTimeout(() => connect().catch(() => {}), 50);
  };

  return (
    <div className="connect-card">
      <h2>{title}</h2>
      {subtitle && <p className="connect-sub">{subtitle}</p>}
      <div className="wallet-list">
        {detected.map((w) => (
          <button
            key={w.adapter.name}
            className="wallet-option"
            onClick={() => choose(w.adapter.name)}
            disabled={connecting}
          >
            <img src={w.adapter.icon} alt="" />
            <span>
              {connecting && wallet?.adapter.name === w.adapter.name ? "Connecting…" : `Continue with ${w.adapter.name}`}
            </span>
          </button>
        ))}
        {detected.length === 0 && (
          <>
            <p className="connect-sub">No Solana wallet found in this browser.</p>
            <a className="wallet-option" href="https://phantom.app/download" target="_blank" rel="noreferrer">
              <span>Get Phantom</span>
            </a>
            <a className="wallet-option" href="https://solflare.com/download" target="_blank" rel="noreferrer">
              <span>Get Solflare</span>
            </a>
          </>
        )}
      </div>
      <p className="connect-foot">
        Plays on Solana <strong>{NETWORK_LABEL}</strong>. Your stake leaves your wallet only when you join a duel.
      </p>
    </div>
  );
}
