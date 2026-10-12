import BN from "bn.js";

/** Great-circle distance in metres (matches the on-chain haversine). */
export const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dp = rad(lat2 - lat1);
  const dl = rad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const formatDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`;

/** Distance points, 0–5000 (mirrors the on-chain `round_score`). */
export const points = (m: number) => Math.round(5000 * Math.exp(-m / 1_492_700));

/** Speed bonus, 0–500, scaled by accuracy so blind fast guesses earn ~nothing. */
export const speedBonus = (m: number, secsLeft: number, total: number) =>
  Math.round(500 * Math.exp(-m / 1_492_700) * Math.max(0, Math.min(1, secsLeft / total)));

/** Full round score = distance points + speed bonus (same formula as on-chain). */
export const roundScore = (m: number, secsLeft: number, total: number) => {
  const acc = Math.exp(-m / 1_492_700);
  return Math.round(5000 * acc + 500 * acc * Math.max(0, Math.min(1, secsLeft / total)));
};

/** Short shareable duel code ⇄ u64 game id. */
export const codeFromId = (id: BN) => id.toString(36).toUpperCase();
export const idFromCode = (code: string) => new BN(code.trim().toLowerCase(), 36);

export const newGameId = () => {
  // ~48 bits of time + 12 random bits → short codes that never collide in practice
  const t = BigInt(Date.now()) << 12n;
  const r = BigInt(Math.floor(Math.random() * 4096));
  return new BN((t | r).toString());
};

export const PLAYER_COLORS = [
  "#7CFFB2", "#FF6B8B", "#6BC5FF", "#FFD166", "#C792EA",
  "#FF9F45", "#4DE1D2", "#F78FB3", "#A3E048", "#9AA5FF",
];
