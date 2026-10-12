import { useCallback, useEffect, useRef, useState } from "react";
import BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import {
  GameAccount,
  GeoClient,
  PhaseName,
  phaseOf,
} from "../lib/geoClient";
import { POLL_MS } from "../lib/config";

export interface LogEntry {
  at: number;
  text: string;
  sig?: string;
  layer?: "base" | "er";
  /** public, third-party proof (MagicBlock validator / VRF oracle) */
  proof?: boolean;
}

interface MyGuess {
  lat: number;
  lng: number;
}

const storage = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const errText = (e: unknown) => {
  const s = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(s)) return "You declined the transaction in your wallet.";
  if (/insufficient|0x1\b|debit/i.test(s)) return "Not enough SOL in your wallet.";
  const m = s.match(/Error Message: ([^.]+)/) || s.match(/"([A-Z][^"]{8,80})"/);
  return m ? m[1] : s.slice(0, 160);
};

/**
 * Live state + choreography for one duel. Every client polls the game wherever
 * it lives (base layer or ER) and performs whichever permissionless step the
 * round needs next — so the round keeps moving even if the host walks away.
 */
export function useDuel(client: GeoClient, gameId: BN) {
  const me = client.publicKey;
  const key = gameId.toString();
  const [game, setGame] = useState<GameAccount | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [myGuess, setMyGuess] = useState<MyGuess | null>(() => {
    const raw = storage.get(`geo-guess-${key}-${me.toBase58()}`);
    return raw ? JSON.parse(raw) : null;
  });
  const [payoutSig, setPayoutSig] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

  // One-shot guards for automatic steps, per game.
  const done = useRef<Record<string, number>>({});
  const firstSeen = useRef<Record<string, number>>({});
  const lastGame = useRef<GameAccount | null>(null);

  const push = useCallback((text: string, sig?: string, layer?: "base" | "er", proof?: boolean) => {
    setLog((l) => (sig && l.some((e) => e.sig === sig) ? l : [{ at: Date.now(), text, sig, layer, proof }, ...l].slice(0, 40)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { game: g, delegated: d } = await client.fetchGame(gameId);
      setDelegated(d);
      // While delegated the ER copy may be briefly unreadable (before its
      // permission exists) — keep showing the last good snapshot.
      if (g) {
        lastGame.current = g;
        setGame(g);
      } else if (!d) {
        setGame(null);
      }
    } catch {
      /* transient RPC error: keep the last snapshot */
    }
    setLoaded(true);
  }, [client, gameId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    const c = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [refresh]);

  const phase: PhaseName | null = phaseOf(game);
  const myIndex = game ? game.players.findIndex((p) => p.player.equals(me)) : -1;
  const joined = myIndex >= 0;
  const isHost = !!game && game.host.equals(me);
  const players: PublicKey[] = game ? game.players.map((p) => p.player) : [];
  const deadline = game ? game.deadline.toNumber() : 0;
  const allLocked = !!game && game.players.length > 0 && game.players.every((p) => p.locked);
  const timeLeft = Math.max(0, deadline - now);

  /** Run `fn` at most once per `tag` (retry allowed after `retryMs`). */
  const once = useCallback(
    async (tag: string, fn: () => Promise<void>, retryMs = 8000) => {
      const last = done.current[tag];
      if (last && (last === -1 || Date.now() - last < retryMs)) return;
      done.current[tag] = Date.now();
      try {
        await fn();
        done.current[tag] = -1;
      } catch (e) {
        console.warn(tag, e);
      }
    },
    [],
  );

  const sealedKey = `geo-sealed-${key}-${me.toBase58()}`;
  const ensureSealed = useCallback(async () => {
    if (storage.get(sealedKey)) return;
    const sig = await client.sealMyGuess(gameId);
    storage.set(sealedKey, "1");
    push("Sealed your guess slot inside the private rollup", sig, "er");
  }, [client, gameId, push, sealedKey]);

  // ───────────── automatic choreography ─────────────
  useEffect(() => {
    if (!game || !phase) return;
    const seen = (tag: string) => (firstSeen.current[tag] ??= Date.now());
    const waited = (tag: string) => Date.now() - seen(tag);

    // Joined players make sure their guess slot is private before anything else.
    if (joined && (phase === "lobby" || phase === "locating" || phase === "guessing")) {
      once("seal", ensureSealed, 4000);
    }

    if (phase === "guessing" && !delegated) {
      // Host moves the game to the ER right away; anyone else steps in if the
      // host is gone for a few seconds (delegation is permissionless here).
      if (isHost || waited("guessing-base") > 5000) {
        once("delegate", async () => {
          const sig = await client.delegateGame(gameId);
          push("Moved the round onto the private ephemeral rollup", sig, "base");
        });
      }
    }

    if (phase === "guessing" && delegated) {
      if (isHost || waited("guessing-er") > 4000) {
        once("publish", async () => {
          const sig = await client.publishGame(gameId);
          push("Opened the scoreboard for everyone to watch", sig, "er");
        });
      }
      if (allLocked || now > deadline + 1) {
        once(
          "reveal",
          async () => {
            const sig = await client.tryReveal(gameId, players);
            if (!sig) throw new Error("not ready");
            push("Revealed all sealed guesses and scored them", sig, "er");
          },
          2000,
        );
      }
    }

    if (phase === "revealed" && !delegated && !game.paid) {
      if (isHost || waited("payout") > 3500) {
        once(
          "payout",
          async () => {
            const sig = await client.payout(gameId, players);
            setPayoutSig(sig);
            push("Paid out the pot from escrow", sig, "base");
          },
          4000,
        );
      }
    }

    if ((phase === "revealed" || phase === "settled") && !delegated) {
      // public proof that the round ran on the MagicBlock rollup
      once(
        "proof",
        async () => {
          const { commit, vrf } = await client.rollupProof(gameId);
          if (vrf) push("MagicBlock VRF oracle delivered the random drop location", vrf, "base", true);
          if (commit) push("MagicBlock ER validator committed the scored round back to Solana", commit, "base", true);
          if (!commit) throw new Error("commit not indexed yet");
        },
        5000,
      );
    }

    if ((phase === "revealed" || phase === "settled") && joined && storage.get(sealedKey)) {
      // Best-effort cleanup: hand my guess PDA back to the base layer.
      once(
        "release",
        async () => {
          const doneKey = `geo-released-${key}-${me.toBase58()}`;
          if (storage.get(doneKey)) return;
          await client.releaseGuess(gameId, me);
          storage.set(doneKey, "1");
        },
        15000,
      );
    }
  }, [game, phase, delegated, joined, isHost, allLocked, now, deadline, players, client, gameId, once, push, ensureSealed, sealedKey, key, me]);

  // ───────────── user actions ─────────────
  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const join = () =>
    run("Joining", async () => {
      const sig = await client.joinGame(gameId);
      push("Joined the duel and escrowed your stake", sig, "base");
      await ensureSealed();
    });

  const start = () =>
    run("Starting", async () => {
      const sig = await client.startGame(gameId);
      push("Locked the lobby — asked the VRF oracle for a location", sig, "base");
    });

  const cancel = () =>
    run("Cancelling", async () => {
      const sig = await client.cancelGame(gameId, players);
      push("Cancelled — every stake refunded", sig, "base");
    });

  const submitGuess = (lat: number, lng: number) =>
    run("Locking in", async () => {
      await ensureSealed();
      const sig = await client.submitGuess(gameId, lat, lng);
      const g = { lat, lng };
      storage.set(`geo-guess-${key}-${me.toBase58()}`, JSON.stringify(g));
      setMyGuess(g);
      push("Locked in your sealed guess", sig, "er");
    });

  return {
    game,
    loaded,
    phase,
    delegated,
    joined,
    isHost,
    myIndex,
    myGuess,
    allLocked,
    timeLeft,
    busy,
    error,
    log,
    payoutSig,
    join,
    start,
    cancel,
    submitGuess,
    clearError: () => setError(null),
  };
}

export type Duel = ReturnType<typeof useDuel>;
