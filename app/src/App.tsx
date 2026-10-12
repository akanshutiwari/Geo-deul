import { useCallback, useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import idl from "./idl/geo_duels.json";
import type { GeoDuels } from "./idl/geo_duels";
import { GeoClient, PlayerWallet, keypairWallet } from "./lib/geoClient";
import { GEO_CONFIG } from "./lib/config";
import { loadOrCreateKeypair, localTokenCache } from "./lib/wallet";
import { sessionFor } from "./lib/session";
import { codeFromId, idFromCode } from "./lib/geo";
import Entry from "./components/Entry";
import Hub from "./components/Hub";
import DuelPage from "./components/DuelPage";
import TopBar from "./components/TopBar";
import Tutorial from "./components/Tutorial";

const TUTORIAL_KEY = "geo-tutorial-done";
const params = () => new URLSearchParams(window.location.search);

const readDuelFromUrl = (): BN | null => {
  const c = params().get("duel");
  if (!c) return null;
  try {
    return idFromCode(c);
  } catch {
    return null;
  }
};

const tutorialDone = () => {
  try {
    return !!window.localStorage.getItem(TUTORIAL_KEY);
  } catch {
    return true;
  }
};

export default function App() {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  // Developer-only: `?guest=name` plays from a local test keypair (handy for
  // driving several seats from one browser on a local cluster).
  const guest = params().get("guest");

  const wallet: PlayerWallet | null = useMemo(() => {
    if (guest) return keypairWallet(loadOrCreateKeypair(`geo-guest-${guest}`));
    if (!connected || !publicKey || !signTransaction) return null;
    return { publicKey, signTransaction, signMessage };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest, connected, publicKey?.toBase58()]);

  const client = useMemo(
    () =>
      wallet
        ? new GeoClient(wallet, sessionFor(wallet.publicKey), idl as GeoDuels, GEO_CONFIG, localTokenCache)
        : null,
    [wallet],
  );

  const [gameId, setGameId] = useState<BN | null>(readDuelFromUrl);
  const [balance, setBalance] = useState<number | null>(null);
  const [tutorial, setTutorial] = useState(false);

  // First time a wallet connects, walk them through a practice round.
  useEffect(() => {
    if (client && !tutorialDone() && !gameId) setTutorial(true);
  }, [client, gameId]);

  const refreshBalance = useCallback(async () => {
    if (!client) return setBalance(null);
    try {
      setBalance((await client.base.getBalance(client.publicKey)) / LAMPORTS_PER_SOL);
    } catch {
      /* keep last */
    }
  }, [client]);

  useEffect(() => {
    refreshBalance();
    const t = setInterval(refreshBalance, 5000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  useEffect(() => {
    const onPop = () => setGameId(readDuelFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = (id: BN | null) => {
    const p = params();
    if (id) p.set("duel", codeFromId(id));
    else p.delete("duel");
    const qs = p.toString();
    window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
    setGameId(id);
    refreshBalance();
  };

  const finishTutorial = () => {
    try {
      window.localStorage.setItem(TUTORIAL_KEY, "1");
    } catch {
      /* ignore */
    }
    setTutorial(false);
  };

  if (tutorial) return <Tutorial onDone={finishTutorial} />;

  if (!client) {
    return (
      <div className="app">
        <TopBar client={null} balance={null} onHome={() => open(null)} onHowTo={() => setTutorial(true)} />
        <Entry invited={gameId ? codeFromId(gameId) : null} onHowTo={() => setTutorial(true)} />
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        client={client}
        balance={balance}
        guest={!!guest}
        onHome={() => open(null)}
        onHowTo={() => setTutorial(true)}
      />
      {gameId ? (
        <main>
          <DuelPage key={gameId.toString()} client={client} gameId={gameId} balance={balance} onHome={() => open(null)} />
        </main>
      ) : (
        <Hub client={client} balance={balance} onOpen={open} onPractice={() => setTutorial(true)} />
      )}
    </div>
  );
}
