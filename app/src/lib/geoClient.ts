import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  permissionPdaFromAccount,
  getAuthToken,
  waitUntilPermissionActive,
  AUTHORITY_FLAG,
  TX_LOGS_FLAG,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { GeoDuels } from "../idl/geo_duels";

export const GAME_SEED = "geo_game";
export const GUESS_SEED = "geo_guess";
export const VAULT_SEED = "geo_vault";
export const EPHEMERAL_VAULT_ID = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);
export const MAX_PLAYERS = 10;

export interface GeoConfig {
  programId: PublicKey;
  baseEndpoint: string;
  teeEndpoint: string;
  teeWsEndpoint: string;
  validator: PublicKey;
  /** Base-layer VRF oracle queue (devnet: Cuj97…, local: GKE6d…). */
  vrfQueue: PublicKey;
}

export interface TokenCache {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type PhaseName =
  | "lobby"
  | "locating"
  | "guessing"
  | "revealed"
  | "settled"
  | "cancelled";

export interface PlayerSlot {
  player: PublicKey;
  locked: boolean;
  guessed: boolean;
  lat: number;
  lng: number;
  distanceM: number;
  guessedAt: BN;
}

export interface GameAccount {
  gameId: BN;
  host: PublicKey;
  stake: BN;
  maxPlayers: number;
  guessSecs: number;
  phase: Record<string, object>;
  createdAt: BN;
  locationIndex: number;
  targetLat: number;
  targetLng: number;
  deadline: BN;
  revealedAt: BN;
  winnerMask: number;
  paid: boolean;
  players: PlayerSlot[];
}

export interface GuessAccount {
  gameId: BN;
  player: PublicKey;
  lat: number;
  lng: number;
  submitted: boolean;
  submittedAt: BN;
}

export const phaseOf = (g: GameAccount | null): PhaseName | null =>
  g ? (Object.keys(g.phase)[0] as PhaseName) : null;

export const isWinner = (g: GameAccount, index: number) =>
  (g.winnerMask & (1 << index)) !== 0;

export const toMicro = (deg: number) => Math.round(deg * 1e6);
export const fromMicro = (micro: number) => micro / 1e6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const walletFrom = (keypair: Keypair) => ({
  publicKey: keypair.publicKey,
  payer: keypair,
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
    if (tx instanceof Transaction) tx.partialSign(keypair);
    else tx.sign([keypair]);
    return tx;
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ) {
    for (const tx of txs) {
      if (tx instanceof Transaction) tx.partialSign(keypair);
      else tx.sign([keypair]);
    }
    return txs;
  },
});

/**
 * One client per identity: a base-layer connection plus a lazily authenticated
 * TEE connection. Every ER read goes through this identity's auth token —
 * that's what keeps the other players' guesses sealed.
 */
export class GeoClient {
  readonly keypair: Keypair;
  readonly cfg: GeoConfig;
  readonly base: Connection;
  readonly program: Program<GeoDuels>;
  private tee: Connection | null = null;
  private teeExpiry = 0;
  private cache?: TokenCache;

  constructor(
    keypair: Keypair,
    idl: GeoDuels,
    cfg: GeoConfig,
    cache?: TokenCache,
  ) {
    this.keypair = keypair;
    this.cfg = cfg;
    this.cache = cache;
    this.base = new Connection(cfg.baseEndpoint, "confirmed");
    const provider = new anchor.AnchorProvider(
      this.base,
      walletFrom(keypair) as unknown as anchor.Wallet,
      { commitment: "confirmed" },
    );
    this.program = new Program<GeoDuels>(
      { ...idl, address: cfg.programId.toBase58() } as GeoDuels,
      provider,
    );
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  // ───────────── PDAs ─────────────

  private idBytes(gameId: BN) {
    return gameId.toArrayLike(Buffer, "le", 8);
  }
  gamePda(gameId: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(GAME_SEED), this.idBytes(gameId)],
      this.cfg.programId,
    )[0];
  }
  guessPda(gameId: BN, player: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(GUESS_SEED), this.idBytes(gameId), player.toBuffer()],
      this.cfg.programId,
    )[0];
  }
  vaultPda(gameId: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED), this.idBytes(gameId)],
      this.cfg.programId,
    )[0];
  }

  // ───────────── TEE auth ─────────────

  async teeConn(): Promise<Connection> {
    if (this.tee && Date.now() < this.teeExpiry - 60_000) return this.tee;
    const key = `geo-tee-${this.cfg.teeEndpoint}-${this.publicKey.toBase58()}`;
    const expMs = (a: { expiresAt: number }) =>
      a.expiresAt > 1e12 ? a.expiresAt : a.expiresAt * 1000;
    let auth: { token: string; expiresAt: number } | null = null;
    try {
      const raw = this.cache?.get(key);
      if (raw) auth = JSON.parse(raw);
    } catch {
      auth = null;
    }
    if (!auth || expMs(auth) - Date.now() < 60_000) {
      auth = await getAuthToken(this.cfg.teeEndpoint, this.publicKey, (msg) =>
        Promise.resolve(nacl.sign.detached(msg, this.keypair.secretKey)),
      );
      this.cache?.set(key, JSON.stringify(auth));
    }
    const http = this.cfg.teeEndpoint.replace(/\/$/, "");
    const ws = this.cfg.teeWsEndpoint.replace(/\/$/, "");
    this.tee = new Connection(`${http}?token=${auth.token}`, {
      wsEndpoint: `${ws}?token=${auth.token}`,
      commitment: "confirmed",
    });
    this.teeExpiry = expMs(auth);
    return this.tee;
  }

  // ───────────── tx helpers ─────────────

  private async sendBase(ixs: TransactionInstruction[]) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.publicKey;
    return sendAndConfirmTransaction(this.base, tx, [this.keypair], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }

  private async sendEr(ixs: TransactionInstruction[]) {
    const conn = await this.teeConn();
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    return sendAndConfirmTransaction(conn, tx, [this.keypair], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }

  async waitUntilOnEr(pda: PublicKey, timeoutMs = 20_000) {
    const conn = await this.teeConn();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await conn.getAccountInfo(pda).catch(() => null);
      if (info) return;
      await sleep(400);
    }
    throw new Error(`${pda.toBase58()} not visible on the ER in time`);
  }

  private delegateIx(
    pda: PublicKey,
    accountType: { game: { gameId: BN } } | { guess: { gameId: BN; player: PublicKey } },
  ) {
    return this.program.methods
      .delegatePda(accountType as never)
      .accountsPartial({
        payer: this.publicKey,
        validator: this.cfg.validator,
        pda,
      })
      .instruction();
  }

  // ───────────── lobby (base layer) ─────────────

  /** Open a lobby, stake, and move my sealed Guess PDA onto the ER. */
  async createGame(
    gameId: BN,
    stakeLamports: BN,
    maxPlayers: number,
    guessSecs: number,
  ) {
    const guess = this.guessPda(gameId, this.publicKey);
    const create = await this.program.methods
      .createGame(gameId, stakeLamports, maxPlayers, guessSecs)
      .accountsPartial({
        game: this.gamePda(gameId),
        guess,
        vault: this.vaultPda(gameId),
        host: this.publicKey,
      })
      .instruction();
    const delegate = await this.delegateIx(guess, {
      guess: { gameId, player: this.publicKey },
    });
    return this.sendBase([create, delegate]);
  }

  /** Join a lobby, match the stake, and move my sealed Guess PDA onto the ER. */
  async joinGame(gameId: BN) {
    const guess = this.guessPda(gameId, this.publicKey);
    const join = await this.program.methods
      .joinGame(gameId)
      .accountsPartial({
        game: this.gamePda(gameId),
        guess,
        vault: this.vaultPda(gameId),
        player: this.publicKey,
      })
      .instruction();
    const delegate = await this.delegateIx(guess, {
      guess: { gameId, player: this.publicKey },
    });
    return this.sendBase([join, delegate]);
  }

  /** ER: seal my Guess PDA — readable by me alone. Idempotent. */
  async sealMyGuess(gameId: BN) {
    const guess = this.guessPda(gameId, this.publicKey);
    await this.waitUntilOnEr(guess);
    const ix = await this.program.methods
      .initPermission({ guess: { gameId, player: this.publicKey } } as never, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: this.publicKey },
      ])
      .accountsPartial({
        permissionedAccount: guess,
        permission: permissionPdaFromAccount(guess),
        authority: this.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();
    const sig = await this.sendEr([ix]);
    await waitUntilPermissionActive(this.cfg.teeEndpoint, guess);
    return sig;
  }

  /** Host: lock the lobby and ask the VRF oracle for the drop location. */
  async startGame(gameId: BN) {
    const ix = await this.program.methods
      .startGame(Math.floor(Math.random() * 256))
      .accountsPartial({
        host: this.publicKey,
        game: this.gamePda(gameId),
        oracleQueue: this.cfg.vrfQueue,
      })
      .instruction();
    return this.sendBase([ix]);
  }

  /** Host: cancel before the round goes live; refunds everyone. */
  async cancelGame(gameId: BN, players: PublicKey[]) {
    const ix = await this.program.methods
      .cancelGame()
      .accountsPartial({
        game: this.gamePda(gameId),
        vault: this.vaultPda(gameId),
        host: this.publicKey,
      })
      .remainingAccounts(
        players.map((p) => ({ pubkey: p, isSigner: false, isWritable: true })),
      )
      .instruction();
    return this.sendBase([ix]);
  }

  /** Base → ER: move the live game onto the rollup (once the location landed). */
  async delegateGame(gameId: BN) {
    const ix = await this.delegateIx(this.gamePda(gameId), { game: { gameId } });
    return this.sendBase([ix]);
  }

  /** ER: make the game account publicly readable. Idempotent. */
  async publishGame(gameId: BN) {
    const game = this.gamePda(gameId);
    await this.waitUntilOnEr(game);
    const ix = await this.program.methods
      .initPermission({ game: { gameId } } as never, null)
      .accountsPartial({
        permissionedAccount: game,
        permission: permissionPdaFromAccount(game),
        authority: this.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();
    return this.sendEr([ix]);
  }

  // ───────────── the round (ER) ─────────────

  async submitGuess(gameId: BN, latDeg: number, lngDeg: number) {
    const ix = await this.program.methods
      .submitGuess(gameId, toMicro(latDeg), toMicro(lngDeg))
      .accountsPartial({
        game: this.gamePda(gameId),
        guess: this.guessPda(gameId, this.publicKey),
        player: this.publicKey,
      })
      .instruction();
    return this.sendEr([ix]);
  }

  private async revealTx(gameId: BN, players: PublicKey[]) {
    const tx = await this.program.methods
      .revealAndSettle()
      .accountsPartial({ payer: this.publicKey, game: this.gamePda(gameId) })
      .remainingAccounts(
        players.map((p) => ({
          pubkey: this.guessPda(gameId, p),
          isSigner: false,
          isWritable: true,
        })),
      )
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .transaction();
    return tx;
  }

  /**
   * Reveal once it would succeed (everyone locked in, or time ran out).
   * Simulates first so waiting clients never spam failing reveals.
   */
  async tryReveal(gameId: BN, players: PublicKey[]): Promise<string | null> {
    const conn = await this.teeConn();
    const tx = await this.revealTx(gameId, players);
    tx.feePayer = this.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx).catch(() => null);
    if (!sim || sim.value.err) return null;
    return sendAndConfirmTransaction(conn, tx, [this.keypair], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }

  /** ER cleanup after the reveal: hand a guess PDA back to the base layer. */
  async releaseGuess(gameId: BN, player: PublicKey) {
    const ix = await this.program.methods
      .releaseGuess()
      .accountsPartial({
        payer: this.publicKey,
        guess: this.guessPda(gameId, player),
        game: this.gamePda(gameId),
      })
      .instruction();
    return this.sendEr([ix]);
  }

  // ───────────── payout (base) ─────────────

  async payout(gameId: BN, players: PublicKey[]) {
    const ix = await this.program.methods
      .payout()
      .accountsPartial({
        game: this.gamePda(gameId),
        vault: this.vaultPda(gameId),
        payer: this.publicKey,
      })
      .remainingAccounts(
        players.map((p) => ({ pubkey: p, isSigner: false, isWritable: true })),
      )
      .instruction();
    return this.sendBase([ix]);
  }

  // ───────────── reads ─────────────

  decodeGame(data: Buffer): GameAccount {
    return this.program.coder.accounts.decode("game", data) as GameAccount;
  }

  /** Game as stored on the base layer (null while delegated or missing). */
  async fetchGameBase(gameId: BN): Promise<GameAccount | null> {
    const info = await this.base.getAccountInfo(this.gamePda(gameId));
    if (!info || !info.owner.equals(this.cfg.programId)) return null;
    return this.decodeGame(info.data);
  }

  async fetchGameEr(gameId: BN): Promise<GameAccount | null> {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(this.gamePda(gameId));
    if (!info || !info.owner.equals(this.cfg.programId)) return null;
    return this.decodeGame(info.data);
  }

  /** Is the game PDA currently delegated (owned by the delegation program)? */
  async isDelegated(gameId: BN): Promise<boolean> {
    const info = await this.base.getAccountInfo(this.gamePda(gameId));
    return !!info && !info.owner.equals(this.cfg.programId);
  }

  /**
   * Wherever the game currently lives: base when it's owned by the program,
   * otherwise the ER copy (delegated).
   */
  async fetchGame(
    gameId: BN,
  ): Promise<{ game: GameAccount | null; delegated: boolean }> {
    const info = await this.base.getAccountInfo(this.gamePda(gameId));
    if (!info) return { game: null, delegated: false };
    if (info.owner.equals(this.cfg.programId)) {
      return { game: this.decodeGame(info.data), delegated: false };
    }
    const er = await this.fetchGameEr(gameId).catch(() => null);
    return { game: er, delegated: true };
  }

  /** My own sealed guess, read through my token (nobody else can). */
  async fetchMyGuess(gameId: BN): Promise<GuessAccount | null> {
    return this.fetchGuessEr(gameId, this.publicKey);
  }

  async fetchGuessEr(
    gameId: BN,
    player: PublicKey,
  ): Promise<GuessAccount | null> {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(this.guessPda(gameId, player));
    if (!info) return null;
    return this.program.coder.accounts.decode("guess", info.data) as GuessAccount;
  }

  async vaultBalance(gameId: BN) {
    return this.base.getBalance(this.vaultPda(gameId)).catch(() => 0);
  }
}
