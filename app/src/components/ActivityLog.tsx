import { useEffect, useState } from "react";
import type { LogEntry } from "../hooks/useDuel";
import type { GeoClient } from "../lib/geoClient";
import { erExplorerTx, explorerTx } from "../lib/config";

/** Every transaction of the round, base layer (L1) and rollup (ER), with explorer links. */
export default function ActivityLog({ log, client }: { log: LogEntry[]; client: GeoClient }) {
  const [erRpc, setErRpc] = useState<string | null>(null);
  const hasEr = log.some((e) => e.layer === "er");

  useEffect(() => {
    if (!hasEr || erRpc) return;
    client.erExplorerRpc().then(setErRpc, () => {});
  }, [hasEr, erRpc, client]);

  if (!log.length) return null;
  return (
    <details className="activity">
      <summary>On-chain activity ({log.length})</summary>
      <ul>
        {log.map((e) => {
          const href = !e.sig ? null : e.layer === "er" ? (erRpc ? erExplorerTx(e.sig, erRpc) : null) : explorerTx(e.sig);
          return (
            <li key={e.at + e.text}>
              <span className={`layer ${e.layer}`}>{e.layer === "er" ? "ER" : "L1"}</span>
              <span>{e.text}</span>
              {e.sig &&
                (href ? (
                  <a
                    className="mono small"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={e.layer === "er" ? "Opens on the MagicBlock ephemeral rollup (TEE)" : "Opens on Solana devnet"}
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
        <p className="muted small activity-note">
          ER links open on the MagicBlock Private Ephemeral Rollup through your session&apos;s access token; L1 links open on
          Solana devnet.
        </p>
      )}
    </details>
  );
}
