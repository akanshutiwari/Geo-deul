import type { LogEntry } from "../hooks/useDuel";
import { explorerTx } from "../lib/config";

export default function ActivityLog({ log }: { log: LogEntry[] }) {
  if (!log.length) return null;
  return (
    <details className="activity">
      <summary>On-chain activity ({log.length})</summary>
      <ul>
        {log.map((e) => (
          <li key={e.at + e.text}>
            <span className={`layer ${e.layer}`}>{e.layer === "er" ? "ER" : "L1"}</span>
            <span>{e.text}</span>
            {e.sig && e.layer === "base" ? (
              <a className="mono small" href={explorerTx(e.sig)} target="_blank" rel="noreferrer">
                {e.sig.slice(0, 8)}…
              </a>
            ) : (
              e.sig && <span className="mono small muted">{e.sig.slice(0, 8)}…</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
