import { useCallback, useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import idl from "./idl/geo_duels.json";
import type { GeoDuels } from "./idl/geo_duels";
import { GeoClient } from "./lib/geoClient";
import { GEO_CONFIG, NETWORK_LABEL, PLAYER_STORAGE_KEY } from "./lib/config";
import { loadOrCreateKeypair, localTokenCache } from "./lib/wallet";
import { codeFromId, idFromCode } from "./lib/geo";
import Home from "./components/Home";
import DuelPage from "./components/DuelPage";
import WalletPanel from "./components/WalletPanel";

const readDuelFromUrl = (): BN | null => {
  const c = new URLSearchParams(window.location.search).get("duel");
  if (!c) return null;
  try {
    return idFromCode(c);
  } catch {
    return null;
  }
};

export default function App() {
  // `?seat=2` gives this tab its own burner — handy for playing several
  // players from one browser.
  const client = useMemo(() => {
    const seat = new URLSearchParams(window.location.search).get("seat");
    const storageKey = seat ? `${PLAYER_STORAGE_KEY}-${seat}` : PLAYER_STORAGE_KEY;
    return new GeoClient(loadOrCreateKeypair(storageKey), idl as GeoDuels, GEO_CONFIG, localTokenCache);
  }, []);
  const [gameId, setGameId] = useState<BN | null>(readDuelFromUrl);
  const [balance, setBalance] = useState<number | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance((await client.base.getBalance(client.publicKey)) / LAMPORTS_PER_SOL);
    } catch {
      /* keep last */
    }
  }, [client]);

  useEffect(() => {
    refreshBalance();
    const t = setInterval(refreshBalance, 4000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  useEffect(() => {
    const onPop = () => setGameId(readDuelFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = (id: BN | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("duel", codeFromId(id));
    else params.delete("duel");
    const qs = params.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.pushState(null, "", url);
    setGameId(id);
    refreshBalance();
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => open(null)}>
          <span className="brand-mark">◎</span> Geo Duels
        </button>
        <span className="net">{NETWORK_LABEL}</span>
        <div className="spacer" />
        <WalletPanel client={client} balance={balance} onChange={refreshBalance} compact />
      </header>
      <main>
        {gameId ? (
          <DuelPage key={gameId.toString()} client={client} gameId={gameId} balance={balance} onHome={() => open(null)} />
        ) : (
          <Home client={client} balance={balance} onOpen={open} />
        )}
      </main>
      <footer className="foot muted small">
        VRF location · sealed guesses in a Private Ephemeral Rollup · on-chain escrow — powered by MagicBlock
      </footer>
    </div>
  );
}
