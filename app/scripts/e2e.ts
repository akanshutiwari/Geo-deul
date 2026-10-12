/**
 * End-to-end run of a full 3-player Geo Duel through the same GeoClient the
 * UI uses. Defaults to the local MagicBlock stack (base 8899, QFS 6699, local
 * VRF oracle). For devnet, set:
 *   BASE=https://api.devnet.solana.com TEE=https://devnet-tee.magicblock.app \
 *   VALIDATOR=MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo \
 *   VRF_QUEUE=Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh FUNDER=~/.config/solana/id.json
 */
import "../src/polyfills";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import BN from "bn.js";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import idl from "../src/idl/geo_duels.json" with { type: "json" };
import type { GeoDuels } from "../src/idl/geo_duels";
import { GeoClient, GeoConfig, phaseOf, fromMicro } from "../src/lib/geoClient";
import { LOCATIONS } from "../src/lib/locations";

const env = process.env;
const BASE = env.BASE || "http://localhost:8899";
const TEE = env.TEE || "http://localhost:6699";
const isLocal = BASE.includes("localhost");
const cfg: GeoConfig = {
  programId: new PublicKey(env.PROGRAM_ID || idl.address),
  baseEndpoint: BASE,
  teeEndpoint: TEE,
  teeWsEndpoint: env.TEE_WS || TEE.replace(/^http/, "ws").replace(":6699", ":6700"),
  validator: new PublicKey(
    env.VALIDATOR ||
      (isLocal
        ? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
        : "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
  ),
  vrfQueue: new PublicKey(
    env.VRF_QUEUE ||
      (isLocal
        ? "GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb"
        : "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"),
  ),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const players = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const clients = players.map((k) => new GeoClient(k, idl as GeoDuels, cfg));
  const [host, alice, bob] = clients;
  const STAKE = new BN(0.05 * LAMPORTS_PER_SOL);
  const gameId = new BN(Date.now());
  log("program", cfg.programId.toBase58(), "game", gameId.toString());

  // Fund
  if (isLocal) {
    for (const c of clients) {
      const sig = await c.base.requestAirdrop(c.publicKey, 2 * LAMPORTS_PER_SOL);
      await c.base.confirmTransaction(sig, "confirmed");
    }
  } else {
    const funderPath = (env.FUNDER || "~/.config/solana/id.json").replace("~", homedir());
    const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderPath, "utf8"))));
    const tx = new Transaction();
    for (const c of clients) {
      tx.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: c.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }));
    }
    await sendAndConfirmTransaction(host.base, tx, [funder], { commitment: "confirmed" });
  }
  log("funded 3 players");

  // Lobby
  log("create", await host.createGame(gameId, STAKE, 4, 60));
  log("alice join", await alice.joinGame(gameId));
  log("bob join", await bob.joinGame(gameId));
  for (const c of clients) log("seal guess PDA", await c.sealMyGuess(gameId));

  let game = await host.fetchGameBase(gameId);
  assert(game && game.players.length === 3, "3 players in lobby");
  assert((await host.vaultBalance(gameId)) === STAKE.toNumber() * 3, "vault holds 3 stakes");

  // Start → VRF
  log("start (VRF request)", await host.startGame(gameId));
  game = await waitFor("VRF callback", async () => {
    const g = await host.fetchGameBase(gameId);
    return g && phaseOf(g) === "guessing" ? g : null;
  });
  const loc = LOCATIONS[game.locationIndex];
  const target = { lat: fromMicro(game.targetLat), lng: fromMicro(game.targetLng) };
  log(`dropped near ${loc.name}, ${loc.country} →`, target);

  log("delegate game", await host.delegateGame(gameId));
  log("publish game", await host.publishGame(gameId));
  const erGame = await waitFor("game on ER", () => alice.fetchGameEr(gameId));
  assert(phaseOf(erGame) === "guessing", "ER sees guessing phase");

  // Guesses: alice close, bob medium, host far
  log("alice guess", await alice.submitGuess(gameId, target.lat + 0.3, target.lng + 0.3));
  log("host guess", await host.submitGuess(gameId, -target.lat, target.lng > 0 ? target.lng - 150 : target.lng + 150));

  // Privacy: bob must NOT be able to read alice's sealed guess; alice can.
  const mine = await alice.fetchMyGuess(gameId);
  assert(mine?.submitted, "alice reads her own guess");
  const peek = await bob.fetchGuessEr(gameId, alice.publicKey).catch(() => null);
  assert(!peek || !peek.submitted, "bob cannot read alice's sealed guess");
  log("privacy ok — bob sees:", peek ? "redacted/empty account" : "nothing");

  // Lock-in badges are public, coordinates are not
  const bobView = await bob.fetchGameEr(gameId);
  assert(bobView?.players[1].locked, "bob sees alice locked in");
  assert(bobView?.players[1].lat === 0 && !bobView.players[1].guessed, "but not where");
  log("lock-in visible, coordinates hidden");

  // Releasing a guess mid-round would leak it — must fail
  const early = await alice.releaseGuess(gameId, alice.publicKey).then(() => "ok", () => "failed");
  assert(early === "failed", "guess release blocked before reveal");

  // Not everyone is in yet → reveal must not succeed
  assert((await bob.tryReveal(gameId, players.map((p) => p.publicKey))) === null, "reveal blocked while open");

  log("bob guess", await bob.submitGuess(gameId, target.lat + 3, target.lng - 3));

  const revealSig = await waitFor("reveal", () => bob.tryReveal(gameId, players.map((p) => p.publicKey)), 20_000);
  log("reveal + settle", revealSig);

  game = await waitFor(
    "game back on base",
    async () => {
      const g = await host.fetchGameBase(gameId);
      return g && phaseOf(g) === "revealed" ? g : null;
    },
    90_000,
  );
  game.players.forEach((p, i) =>
    log(`  player ${i} ${p.player.toBase58().slice(0, 6)} guessed=${p.guessed} dist=${(p.distanceM / 1000).toFixed(1)} km${game!.winnerMask & (1 << i) ? "  🏆" : ""}`),
  );
  assert(game.winnerMask === 0b010, "alice (index 1) wins");

  const paySig = await host.payout(gameId, players.map((p) => p.publicKey));
  log("payout", paySig);
  for (const c of clients) log("release guess", await c.releaseGuess(gameId, c.publicKey));
  const after = await host.fetchGameBase(gameId);
  assert(after && phaseOf(after) === "settled" && after.paid, "settled");
  // Read the gain from the payout tx itself (public devnet RPCs can serve stale balances).
  const payTx = await waitFor("payout tx", () =>
    host.base.getTransaction(paySig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
  );
  const keys = payTx.transaction.message.getAccountKeys().staticAccountKeys;
  const ai = keys.findIndex((k) => k.equals(alice.publicKey));
  const aliceGain = payTx.meta!.postBalances[ai] - payTx.meta!.preBalances[ai];
  log("alice gained", aliceGain / LAMPORTS_PER_SOL, "SOL");
  assert(aliceGain === STAKE.toNumber() * 3, "alice received the full pot");
  assert((await host.vaultBalance(gameId)) === 0, "vault drained");

  // Double payout must fail
  const again = await host.payout(gameId, players.map((p) => p.publicKey)).then(
    () => "ok",
    () => "failed",
  );
  const stillPaid = await host.fetchGameBase(gameId);
  assert(again === "failed" || stillPaid?.paid, "second payout rejected");
  log("✅ full geo duel passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
