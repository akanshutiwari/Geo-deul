import { Keypair, PublicKey } from "@solana/web3.js";
import { loadOrCreateKeypair } from "./wallet";

/**
 * Per-wallet session key ("game gas"): signs the permissionless steps of a
 * round so the player only approves stakes and guesses in their wallet.
 */
export const sessionFor = (wallet: PublicKey): Keypair =>
  loadOrCreateKeypair(`geo-session-${wallet.toBase58()}`);
