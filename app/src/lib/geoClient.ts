import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  permissionPdaFromAccount,
  getAuthToken,
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
  score: number;
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

/**
 * Whoever plays: a browser wallet (Phantom, Solflare, …) through the wallet
 * adapter, or a plain keypair in tests. Only `signTransaction` is required;
 * `signMessage` is needed just to read your *own* sealed guess back.
 */
export interface PlayerWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

export const keypairWallet = (keypair: Keypair): PlayerWallet => ({
  publicKey: keypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
    if (tx instanceof Transaction) tx.partialSign(keypair);
    else tx.sign([keypair]);
    return tx;
  },
  async signMessage(message: Uint8Array) {
    return nacl.sign.detached(message, keypair.secretKey);
  },
});

/** Lamports the session key keeps for fees + delegation rent ("game gas"). */
export const SESSION_MIN_LAMPORTS = 6_000_000;
export const SESSION_TOPUP_LAMPORTS = 15_000_000;

type Actor = "wallet" | "session";

/**
 * Client for one player. Money and identity live in the player's wallet: it
 * signs creating/joining (stakes), starting, and locking in a guess. The
 * permissionless plumbing — sealing the guess slot, moving the round onto the
 * rollup, revealing, paying out — is signed by a local session key that the
 * wallet tops up inside its own join/create transaction, so players never
 * see a popup for those steps.
 */
export class GeoClient {
  readonly wallet: PlayerWallet;
  readonly session: Keypair;
  readonly cfg: GeoConfig;
  readonly base: Connection;
  readonly program: Program<GeoDuels>;
  private tee: Partial<Record<Actor, { conn: Connection; expiry: number }>> = {};
  private cache?: TokenCache;

  constructor(
    wallet: PlayerWallet,
    session: Keypair,
    idl: GeoDuels,
    cfg: GeoConfig,
    cache?: TokenCache,
  ) {
    this.wallet = wallet;
    this.session = session;
    this.cfg = cfg;
    this.cache = cache;
    this.base = new Connection(cfg.baseEndpoint, "confirmed");
    const provider = new anchor.AnchorProvider(
      this.base,
      { publicKey: wallet.publicKey } as unknown as anchor.Wallet,
      { commitment: "confirmed" },
    );
    this.program = new Program<GeoDuels>(
      { ...idl, address: cfg.programId.toBase58() } as GeoDuels,
      provider,
    );
  }

  /** The player's identity (their wallet). */
  get publicKey() {
    return this.wallet.publicKey;
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

  /**
   * Authenticated TEE connection. The session key's token is used for
   * everything public; the wallet's token (one signMessage) only to read the
   * wallet's own sealed guess.
   */
  async teeConn(as: Actor = "session"): Promise<Connection> {
    const live = this.tee[as];
    if (live && Date.now() < live.expiry - 60_000) return live.conn;
    const who = as === "wallet" ? this.wallet.publicKey : this.session.publicKey;
    const key = `geo-tee-${this.cfg.teeEndpoint}-${who.toBase58()}`;
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
      const sign =
        as === "wallet"
          ? (msg: Uint8Array) => {
              if (!this.wallet.signMessage) throw new Error("This wallet can't sign messages");
              return this.wallet.signMessage(msg);
            }
          : (msg: Uint8Array) => Promise.resolve(nacl.sign.detached(msg, this.session.secretKey));
      auth = await getAuthToken(this.cfg.teeEndpoint, who, sign);
      this.cache?.set(key, JSON.stringify(auth));
    }
    const http = this.cfg.teeEndpoint.replace(/\/$/, "");
    const ws = this.cfg.teeWsEndpoint.replace(/\/$/, "");
    const conn = new Connection(`${http}?token=${auth.token}`, {
      wsEndpoint: `${ws}?token=${auth.token}`,
      commitment: "confirmed",
    });
    this.tee[as] = { conn, expiry: expMs(auth) };
    return conn;
  }

  /** Tokenized TEE RPC URL (for explorer links to ER transactions). */
  async erExplorerRpc(): Promise<string> {
    return (await this.teeConn("session")).rpcEndpoint;
  }

  // ───────────── tx helpers ─────────────

  private async signAndSend(conn: Connection, tx: Transaction, by: Actor) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    if (by === "session") {
      tx.feePayer = this.session.publicKey;
      tx.sign(this.session);
    } else {
      tx.feePayer = this.wallet.publicKey;
      tx = await this.wallet.signTransaction(tx);
    }
    // sign-only + submit ourselves: works the same for base and rollup,
    // whatever network the wallet itself is set to
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  private sendBase(ixs: TransactionInstruction[], by: Actor = "wallet") {
    return this.signAndSend(this.base, new Transaction().add(...ixs), by);
  }

  private async sendEr(ixs: TransactionInstruction[], by: Actor = "session") {
    return this.signAndSend(await this.teeConn("session"), new Transaction().add(...ixs), by);
  }

  /** Top up the session key from the wallet when it runs low (bundled into a wallet tx). */
  async sessionTopUpIxs(): Promise<TransactionInstruction[]> {
    const bal = await this.base.getBalance(this.session.publicKey).catch(() => 0);
    if (bal >= SESSION_MIN_LAMPORTS) return [];
    return [
      SystemProgram.transfer({
        fromPubkey: this.wallet.publicKey,
        toPubkey: this.session.publicKey,
        lamports: SESSION_TOPUP_LAMPORTS - bal,
      }),
    ];
  }

  /** Send whatever "game gas" the session key holds back to the wallet. */
  async returnSessionFunds() {
    const bal = await this.base.getBalance(this.session.publicKey);
    const amount = bal - 5000;
    if (amount <= 0) return null;
    return this.sendBase(
      [SystemProgram.transfer({ fromPubkey: this.session.publicKey, toPubkey: this.wallet.publicKey, lamports: amount })],
      "session",
    );
  }

  async waitUntilOnEr(pda: PublicKey, timeoutMs = 20_000) {
    const conn = await this.teeConn("session");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await conn.getAccountInfo(pda).catch(() => null);
      if (info) return;
      await sleep(400);
    }
    throw new Error(`${pda.toBase58()} not visible on the ER in time`);
  }

  private delegateIx(
    payer: PublicKey,
    pda: PublicKey,
    accountType: { game: { gameId: BN } } | { guess: { gameId: BN; player: PublicKey } },
  ) {
    return this.program.methods
      .delegatePda(accountType as never)
      .accountsPartial({
        payer,
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
    const delegate = await this.delegateIx(this.publicKey, guess, {
      guess: { gameId, player: this.publicKey },
    });
    return this.sendBase([...(await this.sessionTopUpIxs()), create, delegate]);
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
    const delegate = await this.delegateIx(this.publicKey, guess, {
      guess: { gameId, player: this.publicKey },
    });
    return this.sendBase([...(await this.sessionTopUpIxs()), join, delegate]);
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
        authority: this.session.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();
    const sig = await this.sendEr([ix]);
    await this.waitUntilOnEr(permissionPdaFromAccount(guess), 10_000).catch(() => {});
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
    const ix = await this.delegateIx(this.session.publicKey, this.gamePda(gameId), { game: { gameId } });
    return this.sendBase([ix], "session");
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
        authority: this.session.publicKey,
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
    return this.sendEr([ix], "wallet");
  }

  private async revealTx(gameId: BN, players: PublicKey[]) {
    const tx = await this.program.methods
      .revealAndSettle()
      .accountsPartial({ payer: this.session.publicKey, game: this.gamePda(gameId) })
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
    const conn = await this.teeConn("session");
    const tx = await this.revealTx(gameId, players);
    tx.feePayer = this.session.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx).catch(() => null);
    if (!sim || sim.value.err) return null;
    return this.signAndSend(conn, tx, "session");
  }

  /** ER cleanup after the reveal: hand a guess PDA back to the base layer. */
  async releaseGuess(gameId: BN, player: PublicKey) {
    const ix = await this.program.methods
      .releaseGuess()
      .accountsPartial({
        payer: this.session.publicKey,
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
        payer: this.session.publicKey,
      })
      .remainingAccounts(
        players.map((p) => ({ pubkey: p, isSigner: false, isWritable: true })),
      )
      .instruction();
    return this.sendBase([ix], "session");
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
    const conn = await this.teeConn("session");
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
    const conn = await this.teeConn("wallet");
    const info = await conn.getAccountInfo(this.guessPda(gameId, player));
    if (!info) return null;
    return this.program.coder.accounts.decode("guess", info.data) as GuessAccount;
  }

  async vaultBalance(gameId: BN) {
    return this.base.getBalance(this.vaultPda(gameId)).catch(() => 0);
  }
}
