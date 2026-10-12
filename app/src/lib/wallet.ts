import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { TokenCache } from "./geoClient";

/** Burner keypair kept in localStorage so ER transactions need no popups. */
export const loadOrCreateKeypair = (storageKey: string): Keypair => {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
  } catch {
    /* fall through to a fresh burner */
  }
  const kp = Keypair.generate();
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(kp.secretKey)));
  } catch {
    /* storage unavailable: session-only burner */
  }
  return kp;
};

export const localTokenCache: TokenCache = {
  get: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

export const shortKey = (pk: PublicKey | string, chars = 4) => {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  return `${s.slice(0, chars)}…${s.slice(-chars)}`;
};

export const requestAirdrop = async (conn: Connection, to: PublicKey, sol: number) => {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
};

export const transferSol = (conn: Connection, from: Keypair, to: PublicKey, sol: number) => {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Math.floor(sol * LAMPORTS_PER_SOL),
    }),
  );
  return sendAndConfirmTransaction(conn, tx, [from], { commitment: "confirmed" });
};
