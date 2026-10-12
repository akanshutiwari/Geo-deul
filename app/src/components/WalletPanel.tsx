import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { GeoClient } from "../lib/geoClient";
import { BASE_ENDPOINT, IS_LOCAL, NETWORK_LABEL, WITHDRAW_RESERVE_SOL } from "../lib/config";
import { requestAirdrop, shortKey, transferSol } from "../lib/wallet";

/**
 * The burner that signs every move (so the rollup flow never pops a wallet),
 * plus ways to fund it: faucet airdrop, or a top-up / cash-out with a real wallet.
 */
export default function WalletPanel({
  client,
  balance,
  onChange,
  compact,
}: {
  client: GeoClient;
  balance: number | null;
  onChange: () => void;
  compact?: boolean;
}) {
  const { publicKey: ext, signTransaction, connected } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const [amount, setAmount] = useState(0.1);
  const conn = useMemo(() => new Connection(BASE_ENDPOINT, "confirmed"), []);
  const address = client.publicKey.toBase58();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact || !open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // the wallet-adapter modal renders outside this panel
      if (root.current?.contains(t) || t.closest(".wallet-adapter-modal")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [compact, open]);

  const act = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      setMsg(await fn());
      onChange();
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e);
      setMsg(/429|rate|limit|airdrop|internal error/i.test(t) ? "The devnet faucet is busy — try faucet.solana.com or top up from a wallet." : t.slice(0, 140));
    }
    setBusy(null);
  };

  const airdrop = () =>
    act("airdrop", async () => {
      await requestAirdrop(conn, client.publicKey, IS_LOCAL ? 2 : 0.5);
      return "Airdrop landed ✅";
    });

  const topUp = () =>
    act("topup", async () => {
      if (!ext || !signTransaction) throw new Error("Connect a wallet first");
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: ext, toPubkey: client.publicKey, lamports: Math.round(amount * LAMPORTS_PER_SOL) }),
      );
      tx.feePayer = ext;
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      // sign only and submit ourselves, so it always lands on this app's network
      const signed = await signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      return `Topped up ${amount} SOL ✅`;
    });

  const withdraw = () =>
    act("withdraw", async () => {
      if (!ext) throw new Error("Connect a wallet first");
      const max = Math.max(0, (balance ?? 0) - WITHDRAW_RESERVE_SOL);
      if (max <= 0) throw new Error("Nothing to withdraw");
      await transferSol(conn, client.keypair, new PublicKey(ext), max);
      return `Sent ${max.toFixed(4)} SOL to ${shortKey(ext)} ✅`;
    });

  return (
    <div ref={root} className={`wallet-panel${compact ? " compact" : ""}`}>
      <button className="wallet-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dot" />
        <span className="mono">{shortKey(address)}</span>
        <span className="bal mono">{balance === null ? "…" : `${balance.toFixed(3)} SOL`}</span>
      </button>
      {open && (
        <div className="wallet-body">
          <p className="muted small">
            Burner wallet on <strong>{NETWORK_LABEL}</strong> — it signs your moves instantly, no popups.{" "}
            <button className="link" onClick={() => navigator.clipboard?.writeText(address)}>
              Copy address
            </button>
          </p>
          <div className="row wrap">
            <button className="btn btn-sm" onClick={airdrop} disabled={!!busy}>
              {busy === "airdrop" ? "Requesting…" : `Airdrop ${IS_LOCAL ? 2 : 0.5} SOL`}
            </button>
            <WalletMultiButton />
          </div>
          {connected && (
            <div className="row wrap">
              <input
                className="input input-sm"
                type="number"
                min={0}
                step={0.05}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              />
              <button className="btn btn-sm" onClick={topUp} disabled={!!busy || amount <= 0}>
                {busy === "topup" ? "Sending…" : "Top up burner"}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={withdraw} disabled={!!busy}>
                {busy === "withdraw" ? "Sending…" : "Cash out"}
              </button>
            </div>
          )}
          {msg && <p className="small">{msg}</p>}
        </div>
      )}
    </div>
  );
}
