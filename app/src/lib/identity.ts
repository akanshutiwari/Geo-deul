import type { PublicKey } from "@solana/web3.js";

// Every player gets a stable explorer name + avatar derived from their wallet,
// so all clients show the same identity without storing anything on-chain.
const ADJ = [
  "Equatorial", "Polar", "Coastal", "Alpine", "Desert", "Tropical", "Arctic", "Misty", "Golden", "Rapid",
  "Silent", "Lunar", "Solar", "Wandering", "Northern", "Southern", "Hidden", "Crimson", "Emerald", "Cobalt",
];
const NOUN = [
  "Island", "Fjord", "Mesa", "Delta", "Atoll", "Canyon", "Glacier", "Steppe", "Lagoon", "Volcano",
  "Tundra", "Savanna", "Harbor", "Ridge", "Oasis", "Strait", "Peak", "Reef", "Plateau", "Bayou",
];
const AVATARS = ["🧭", "🦊", "🐧", "🦉", "🐢", "🦜", "🐙", "🦁", "🐼", "🦅", "🐬", "🦒", "🐨", "🦩", "🐸", "🐯"];

const hash = (pk: PublicKey) => {
  const b = pk.toBytes();
  return (b[0] << 24) ^ (b[7] << 16) ^ (b[13] << 8) ^ b[21];
};

export const playerName = (pk: PublicKey) => {
  const b = pk.toBytes();
  return `${ADJ[b[1] % ADJ.length]}${NOUN[b[2] % NOUN.length]}${(((b[3] << 8) | b[4]) % 900) + 100}`;
};

export const playerAvatar = (pk: PublicKey) => AVATARS[Math.abs(hash(pk)) % AVATARS.length];
