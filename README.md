# 🌍 Geo Duels

**Dropped somewhere on Earth. Closest pin takes the pot.**

Any number of players (1–10) get dropped at the same VRF-picked spot, study a
label-free satellite view, and drop a sealed pin on the world map before the
clock runs out. Guesses stay hidden inside a MagicBlock **Private Ephemeral
Rollup** (TEE) until everyone has locked in. Then the round reveals in real
time and the on-chain escrow pays whoever landed closest. Tied guesses split the pot.

Program (devnet): `2Cju35ZeK1ZV5VZnn99LFS7tt8Vh3rkBQG6TZYirz5Et`

## How it maps to MagicBlock

| Requirement | How Geo Duels does it |
| --- | --- |
| VRF picks the location | `start_game` requests MagicBlock VRF. `callback_set_location` picks one of 110 curated spots and adds ±1.6 km of random jitter, so nobody can learn rounds ahead of time, and nobody can memorise the pool either. |
| Guesses sealed in a PER | Each player has a `Guess` PDA delegated to the TEE validator, with a permission that only that player can read. The public game shows a 🔒 when someone locks in, but never the coordinates. |
| Timer + reveal in real time | Guessing runs on the rollup. `reveal_and_settle` fires the moment the last pin lands (or the timer expires), scores everyone with an on-chain haversine, and commits the game back to Solana in the same instruction. |
| Stakes escrowed, winner paid instantly | Stakes go to a system-owned vault PDA that is never delegated. `payout` runs automatically as soon as the commit lands. It is permissionless and idempotent, and funds can only go to recorded players. |

### What's different from GeoGuessr-style duels

- **N-player pot**, not just 1v1. Up to 10 players per lobby, and it's winner-takes-all (ties split).
- **Live sealed lock-ins**: you can see who has committed, but never where.
- **Satellite drop, no API keys**: Esri World Imagery, with zoom and panning limited to a small box so you can't just zoom out to the coastline. Street View shows up as an extra tab if you set `VITE_GOOGLE_MAPS_KEY`.
- **Self-driving rounds**: every client runs whichever permissionless step comes next (delegate, publish, reveal, pay). The game finishes even if the host closes the tab.
- **Popup-free play**: a burner wallet signs every move. You fund it with the faucet or top it up and cash out with Phantom/Solflare.

## Lifecycle

```
BASE   create_game ─ join_game×N ─ start_game ──► VRF ──► callback_set_location
                                                                   │ delegate game
ER/TEE                   init_permission (guess: private, game: public)
                         submit_guess×N (sealed) ─► reveal_and_settle ─┐ commit+undelegate
BASE                                                     payout ◄──────┘
ER                       release_guess×N (cleanup: guess PDAs back to base)
```

`cancel_game` lets the host refund everyone while the lobby is open, or if the VRF never answers.

## Layout

```
programs/geo-duels/src/lib.rs     Anchor program
programs/geo-duels/src/locations.rs  generated location pool (from locations.json)
app/                               Vite + React frontend
app/src/lib/geoClient.ts           typed client shared by the UI and the e2e test
app/src/hooks/useDuel.ts           live state + automatic round choreography
app/scripts/e2e.ts                 3-player end-to-end test (local or devnet)
scripts/local-stack.sh             local MagicBlock stack + VRF oracle
scripts/gen-locations.mjs          regenerates the location tables
```

## Run it

Toolchain: Anchor 1.0.2, Solana CLI, Node 22+, and Yarn. For local runs you also need `npm i -g @magicblock-labs/ephemeral-validator`, which provides `mb-stack` and `vrf-oracle`.

### Play on devnet (default)

```bash
cd app && yarn && yarn dev        # http://localhost:5173
```

Fund the burner using the wallet chip at the top right. To play several seats from one browser, add `?seat=2`, `?seat=3`, … to the URL so each tab gets its own burner.

### Local cluster

```bash
anchor build
./scripts/local-stack.sh          # base validator + ER + QFS privacy layer + VRF oracle
# in another terminal
cd app && echo "VITE_BASE_ENDPOINT=http://localhost:8899" > .env.local && yarn dev
```

### End-to-end test

```bash
cd app
yarn e2e                                            # against the local stack
BASE=https://api.devnet.solana.com \
TEE=https://devnet-tee.magicblock.app TEE_WS=wss://devnet-tee.magicblock.app \
FUNDER=~/.config/solana/id.json yarn e2e            # against devnet
```

The test plays a 3-player staked duel and checks the following:

- another player can't read a sealed guess
- lock-ins are public but coordinates are not
- the reveal is blocked while players are still guessing
- a guess can't be released early
- the closest player gets the full pot
- the vault ends up drained
- a second payout fails

### Changing the location pool

Edit `locations.json`, then run `node scripts/gen-locations.mjs && anchor build`.

## Config (`app/.env.local`, all optional)

| Var | Default |
| --- | --- |
| `VITE_BASE_ENDPOINT` | `https://api.devnet.solana.com` |
| `VITE_TEE_ENDPOINT` / `VITE_TEE_WS_ENDPOINT` | devnet TEE (or the local QFS when the base is localhost) |
| `VITE_VALIDATOR` | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (TEE) |
| `VITE_VRF_QUEUE` | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` (base-layer queue) |
| `VITE_PROGRAM_ID` | from the IDL |
| `VITE_GOOGLE_MAPS_KEY` | unset (enables the Street View tab) |

## Design notes

- **Why VRF runs on the base layer.** MagicBlock documents an ephemeral VRF queue but no TEE-specific one, so the drop is requested on L1 and the game is delegated once the location lands. The timer includes 6 s of grace to cover delegation.
- **Why the reveal commits only the game.** One commit stays small enough for the direct-commit path. Guess PDAs are released afterwards with `release_guess`, which is gated on the reveal so a guess can never leak mid-round.
- **Fairness caveat.** The location is visible to clients once the round starts (they have to render it). Sealing protects the guesses. The VRF guarantees that nobody knew the spot beforehand.
