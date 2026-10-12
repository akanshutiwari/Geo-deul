import { PublicKey } from "@solana/web3.js";
import rawIdl from "../idl/geo_duels.json";
import type { GeoConfig } from "./geoClient";

const env = import.meta.env;

export const BASE_ENDPOINT: string =
  env.VITE_BASE_ENDPOINT || "https://api.devnet.solana.com";
export const IS_LOCAL = /localhost|127\.0\.0\.1/.test(BASE_ENDPOINT);
export const TEE_ENDPOINT: string =
  env.VITE_TEE_ENDPOINT ||
  (IS_LOCAL ? "http://localhost:6699" : "https://devnet-tee.magicblock.app");
export const TEE_WS_ENDPOINT: string =
  env.VITE_TEE_WS_ENDPOINT ||
  (IS_LOCAL ? "ws://localhost:6700" : TEE_ENDPOINT.replace(/^http/, "ws"));

export const GEO_CONFIG: GeoConfig = {
  programId: new PublicKey(env.VITE_PROGRAM_ID || rawIdl.address),
  baseEndpoint: BASE_ENDPOINT,
  teeEndpoint: TEE_ENDPOINT,
  teeWsEndpoint: TEE_WS_ENDPOINT,
  validator: new PublicKey(
    env.VITE_VALIDATOR ||
      (IS_LOCAL
        ? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
        : "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
  ),
  vrfQueue: new PublicKey(
    env.VITE_VRF_QUEUE ||
      (IS_LOCAL
        ? "GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb"
        : "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"),
  ),
};

/** Optional: enables a Street View tab next to the satellite drop. */
export const GOOGLE_MAPS_KEY: string | undefined = env.VITE_GOOGLE_MAPS_KEY;

export const NETWORK_LABEL = IS_LOCAL
  ? "local cluster"
  : /mainnet/i.test(BASE_ENDPOINT)
    ? "mainnet"
    : "devnet";

export const PLAYER_STORAGE_KEY = "geo-duels-burner";
export const STAKE_PRESETS_SOL = [0, 0.01, 0.05, 0.1];
export const TIMER_PRESETS_S = [30, 60, 90, 120];
export const DEFAULT_MAX_PLAYERS = 4;
/** Rent for the game/guess PDAs + permission pre-funding + fees, roughly. */
export const PLAY_COST_SOL = 0.012;
export const WITHDRAW_RESERVE_SOL = 0.002;
export const POLL_MS = 1000;

export const explorerTx = (sig: string) =>
  IS_LOCAL
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(BASE_ENDPOINT)}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/**
 * Rollup (ER) transactions live on the MagicBlock TEE, which only answers
 * authenticated requests — so Solscan is pointed at our tokenized TEE RPC as a
 * custom cluster (it opens directly, unlike Solana Explorer's RPC prompt).
 */
export const erExplorerTx = (sig: string, tokenizedRpc: string) =>
  `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(tokenizedRpc)}`;
