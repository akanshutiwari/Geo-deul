import { useEffect, useState } from "react";
import type { LogEntry } from "../hooks/useDuel";
import type { GeoClient } from "../lib/geoClient";
import { erExplorerTx, explorerTx } from "../lib/config";

/**
 * Every transaction of the round: base layer (Solana) and MagicBlock
 * ephemeral rollup (TEE). Rollup transactions that touch a sealed guess are
 * redacted by the TEE for outsiders — the player can unlock their own with
 * one wallet signature.
 */
export default function ActivityLog({ log, client, open }: { log: LogEntry[]; client: GeoClient; open?: boolean }) {
  const [erRpc, setErRpc] = useState<string | null>(null);
  const [mine, setMine] = useState(() => client.hasWalletTeeToken());
  const [unlocking, setUnlocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasEr = log.some((e) => e.layer === "er");

  useEffect(() => {
    if (!hasEr) return;
    client.erExplorerRpc(mine ? "wallet" : "session").then(setErRpc, () => {});
  }, [hasEr, mine, client]);

  const unlock = async () => {
    setUnlocking(true);
    setErr(null);
    try {
      setErRpc(await client.erExplorerRpc("wallet"));
      setMine(true);
    } catch (e) {
      setErr(/reject|denied|cancel/i.test(String(e)) ? "Signature declined." : "This wallet can't sign messages.");
    }
    setUnlocking(false);
  };

  if (!log.length) return null;
  return (
    <details className="activity" open={open}>
      <summary>
        On-chain activity ({log.length}) · <span className="accent">Solana devnet + MagicBlock Ephemeral Rollup</span>
      </summary>
      <ul>
        {log.map((e) => {
          const er = e.layer === "er";
          const href = !e.sig ? null : er ? (erRpc ? erExplorerTx(e.sig, erRpc) : null) : explorerTx(e.sig);
          return (
            <li key={e.at + e.text} className={e.proof ? "proof" : ""}>
              <span className={`layer ${e.layer}`}>{er ? "MagicBlock ER" : e.proof ? "Solana · proof" : "Solana"}</span>
              <span>{e.text}</span>
              {e.sig &&
                (href ? (
                  <a
                    className="mono small"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={er ? "Opens on Solscan, reading from the MagicBlock TEE rollup" : "Opens on Solana Explorer (devnet)"}
                  >
                    {e.sig.slice(0, 8)}… ↗
                  </a>
                ) : (
                  <span className="mono small muted">{e.sig.slice(0, 8)}…</span>
                ))}
            </li>
          );
        })}
      </ul>
      {hasEr && (
        <div className="activity-note">
          <p className="muted small">
            <strong>MagicBlock ER</strong> rows ran inside MagicBlock&apos;s Private Ephemeral Rollup (TEE,{" "}
            <span className="mono">devnet-tee.magicblock.app</span>). Transactions that touch a sealed guess are private by
            design: other viewers only see that they succeeded.{" "}
            {mine ? (
              <span className="accent">Unlocked: links show your own transactions in full.</span>
            ) : (
              <button className="link" onClick={unlock} disabled={unlocking}>
                {unlocking ? "Waiting for signature…" : "🔓 Unlock full details of your transactions (one wallet signature)"}
              </button>
            )}
          </p>
          {err && <p className="small error">{err}</p>}
          <p className="muted small">
            <strong>Solana · proof</strong> rows are public base-layer transactions signed by MagicBlock (the ER validator
            committing results, the VRF oracle) — anyone can verify them on Solana Explorer.
          </p>
        </div>
      )}
    </details>
  );
}
