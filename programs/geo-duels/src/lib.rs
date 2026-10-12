//! Geo Duels — N players get dropped at the same VRF-picked spot on Earth,
//! lock in sealed guesses inside a Private Ephemeral Rollup, and whoever lands
//! closest takes the escrowed pot.
//!
//! Lifecycle (B = base layer, ER = private ephemeral rollup / TEE):
//!   B  create_game      host opens a lobby, stakes, gets a sealed Guess PDA
//!   B  join_game        anyone joins (up to MAX_PLAYERS), stakes, gets a Guess PDA
//!   B  start_game       host locks the lobby and requests VRF randomness
//!   B  callback_set_location   VRF oracle drops the location + starts the timer
//!   B  delegate_pda     game PDA moves to the ER (guess PDAs moved at join)
//!   ER init_permission  game public, each guess private to its owner
//!   ER submit_guess     sealed: only the guesser can read their Guess PDA
//!   ER reveal_and_settle  once all locked in (or timer ran out): copy guesses
//!                       into the game, score them, pick winner(s), and
//!                       commit + undelegate everything back to the base layer
//!   B  payout           vault pays the winner(s) — permissionless, idempotent

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

mod locations;
use locations::LOCATIONS;

declare_id!("2Cju35ZeK1ZV5VZnn99LFS7tt8Vh3rkBQG6TZYirz5Et");

pub const GAME_SEED: &[u8] = b"geo_game";
pub const GUESS_SEED: &[u8] = b"geo_guess";
pub const VAULT_SEED: &[u8] = b"geo_vault";

pub const MAX_PLAYERS: usize = 10;
pub const MIN_GUESS_SECS: u32 = 15;
pub const MAX_GUESS_SECS: u32 = 600;
/// Extra seconds on the clock to cover moving the game onto the ER after the
/// location lands, so nobody loses guessing time to delegation latency.
pub const DELEGATION_GRACE_SECS: i64 = 6;
/// Jitter applied around the curated point, in micro-degrees (±0.015° ≈ ±1.6 km),
/// so even a repeated pool entry is never the exact same spot.
pub const JITTER_MICRO_DEG: i64 = 15_000;
pub const NO_DISTANCE: u32 = u32::MAX;

#[ephemeral]
#[program]
pub mod geo_duels {
    use super::*;

    // ───────────────────────────── base layer: lobby ─────────────────────────────

    /// Open a lobby. The host auto-joins as player 0 and stakes.
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        stake: u64,
        max_players: u8,
        guess_secs: u32,
    ) -> Result<()> {
        require!(
            (1..=MAX_PLAYERS as u8).contains(&max_players),
            GeoError::BadMaxPlayers
        );
        require!(
            (MIN_GUESS_SECS..=MAX_GUESS_SECS).contains(&guess_secs),
            GeoError::BadGuessTime
        );

        let host = ctx.accounts.host.key();
        // Pre-fund the game PDA with rent for its (public) ephemeral permission;
        // the lamports travel with it to the ER where it pays for itself.
        fund(
            &ctx.accounts.system_program,
            &ctx.accounts.host,
            &ctx.accounts.game.to_account_info(),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(0) as u32),
        )?;
        fund_guess_and_stake(
            &ctx.accounts.system_program,
            &ctx.accounts.host,
            &ctx.accounts.guess.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            stake,
        )?;

        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.host = host;
        game.stake = stake;
        game.max_players = max_players;
        game.guess_secs = guess_secs;
        game.phase = Phase::Lobby;
        game.created_at = Clock::get()?.unix_timestamp;
        game.players = vec![PlayerSlot::new(host)];

        let guess = &mut ctx.accounts.guess;
        guess.game_id = game_id;
        guess.player = host;
        guess.submitted = false;

        msg!("Geo duel {} opened by {} (stake {})", game_id, host, stake);
        Ok(())
    }

    /// Join an open lobby and match the stake.
    pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
        let player = ctx.accounts.player.key();
        {
            let game = &ctx.accounts.game;
            require!(game.phase == Phase::Lobby, GeoError::LobbyClosed);
            require!(
                game.players.len() < game.max_players as usize,
                GeoError::GameFull
            );
            require!(
                !game.players.iter().any(|p| p.player == player),
                GeoError::AlreadyJoined
            );
        }
        let stake = ctx.accounts.game.stake;
        fund_guess_and_stake(
            &ctx.accounts.system_program,
            &ctx.accounts.player,
            &ctx.accounts.guess.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            stake,
        )?;

        ctx.accounts.game.players.push(PlayerSlot::new(player));

        let guess = &mut ctx.accounts.guess;
        guess.game_id = game_id;
        guess.player = player;
        guess.submitted = false;

        msg!("{} joined geo duel {}", player, game_id);
        Ok(())
    }

    /// Host locks the lobby and asks the VRF oracle for the drop location.
    /// Nobody — the host included — can know the spot before the callback lands.
    pub fn start_game(ctx: Context<StartGame>, client_seed: u8) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == Phase::Lobby, GeoError::LobbyClosed);
        require_keys_eq!(ctx.accounts.host.key(), game.host, GeoError::NotHost);

        game.phase = Phase::Locating;

        let mut caller_seed = [client_seed; 32];
        caller_seed[..8].copy_from_slice(&game.game_id.to_le_bytes());
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.host.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackSetLocation::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: game.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        game.exit(&crate::ID)?;
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.host.to_account_info(), &ix)?;
        msg!("Geo duel {} locked — requesting location", ctx.accounts.game.game_id);
        Ok(())
    }

    /// VRF callback: pick a pool entry + jitter, then start the clock.
    pub fn callback_set_location(
        ctx: Context<CallbackSetLocation>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == Phase::Locating, GeoError::WrongPhase);

        let r = |i: usize| u32::from_le_bytes(randomness[i..i + 4].try_into().unwrap());
        let index = (r(0) as usize) % LOCATIONS.len();
        let (lat, lng) = LOCATIONS[index];
        let span = (2 * JITTER_MICRO_DEG + 1) as u32;
        let jlat = (r(4) % span) as i64 - JITTER_MICRO_DEG;
        let jlng = (r(8) % span) as i64 - JITTER_MICRO_DEG;

        game.location_index = index as u16;
        game.target_lat = (lat as i64 + jlat).clamp(-90_000_000, 90_000_000) as i32;
        game.target_lng = wrap_lng(lng as i64 + jlng);
        let now = Clock::get()?.unix_timestamp;
        game.deadline = now + game.guess_secs as i64 + DELEGATION_GRACE_SECS;
        game.phase = Phase::Guessing;

        msg!(
            "Geo duel {} dropped at ({}, {}) — guess until {}",
            game.game_id,
            game.target_lat,
            game.target_lng,
            game.deadline
        );
        Ok(())
    }

    /// Host cancels before the round goes live (lobby, or VRF never answered):
    /// everyone gets their stake back. `remaining_accounts` = player wallets in
    /// join order.
    pub fn cancel_game<'info>(ctx: Context<'info, CancelGame<'info>>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require_keys_eq!(ctx.accounts.host.key(), game.host, GeoError::NotHost);
        require!(
            matches!(game.phase, Phase::Lobby | Phase::Locating),
            GeoError::WrongPhase
        );
        let wallets = ctx.remaining_accounts;
        require!(wallets.len() == game.players.len(), GeoError::WrongPlayerAccounts);

        let id_bytes = game.game_id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &id_bytes, &[ctx.bumps.vault]]];
        if game.stake > 0 {
            for (slot, wallet) in game.players.iter().zip(wallets.iter()) {
                require_keys_eq!(wallet.key(), slot.player, GeoError::WrongPlayerAccounts);
                pay_from_vault(&ctx.accounts.vault, wallet, game.stake, &ctx.accounts.system_program, seeds)?;
            }
        }
        game.phase = Phase::Cancelled;
        game.paid = true;
        msg!("Geo duel {} cancelled, stakes refunded", game.game_id);
        Ok(())
    }

    // ─────────────────────────── delegation + privacy ───────────────────────────

    /// Delegate a guess PDA (any time) or the game PDA (only once the location
    /// is live, so the lobby can't be frozen early) to the ER validator.
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        if let AccountType::Game { .. } = account_type {
            let data = ctx.accounts.pda.try_borrow_data()?;
            let game = Game::try_deserialize(&mut &data[..])?;
            require!(game.phase == Phase::Guessing, GeoError::WrongPhase);
        }
        let seed_data = derive_seeds(&account_type);
        let seeds: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seeds,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER: create the ephemeral permission for a delegated PDA. The PDA pays
    /// its own rent (pre-funded on the base layer) and signs via its seeds.
    /// `members = Some(list)` → private to that list, `None` → public.
    pub fn init_permission(
        ctx: Context<InitPermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Permission already exists");
            return Ok(());
        }
        let mut seeds = derive_seeds(&account_type);
        let (expected, bump) = Pubkey::find_program_address(
            &seeds.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );
        require_keys_eq!(
            expected,
            ctx.accounts.permissioned_account.key(),
            GeoError::WrongPda
        );
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        let (is_private, members) = match members {
            Some(m) => (true, m),
            None => (false, vec![]),
        };
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.permissioned_account.to_account_info(),
            permissioned_account: ctx.accounts.permissioned_account.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private, members },
        }
        .invoke_signed(&[seed_refs.as_slice()])?;
        Ok(())
    }

    // ───────────────────────────── ER: the round ─────────────────────────────

    /// ER: lock in a sealed guess (micro-degrees). One shot, before the deadline.
    pub fn submit_guess(ctx: Context<SubmitGuess>, _game_id: u64, lat: i32, lng: i32) -> Result<()> {
        let game = &ctx.accounts.game;
        let now = Clock::get()?.unix_timestamp;
        require!(game.phase == Phase::Guessing, GeoError::WrongPhase);
        require!(now <= game.deadline, GeoError::TimeUp);
        require!(
            (-90_000_000..=90_000_000).contains(&lat) && (-180_000_000..=180_000_000).contains(&lng),
            GeoError::BadCoordinates
        );
        let guess = &mut ctx.accounts.guess;
        require!(!guess.submitted, GeoError::AlreadyGuessed);
        guess.lat = lat;
        guess.lng = lng;
        guess.submitted = true;
        guess.submitted_at = now;
        msg!("Sealed guess locked in for geo duel {}", game.game_id);
        Ok(())
    }

    /// ER: once everyone has locked in (or the clock ran out) anyone can reveal.
    /// Copies each sealed guess into the public game account, scores it, picks
    /// the closest guess(es) as winner(s), then commits + undelegates the game
    /// back to the base layer for payout.
    /// `remaining_accounts` = guess PDAs in join order.
    pub fn reveal_and_settle<'info>(ctx: Context<'info, RevealAndSettle<'info>>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == Phase::Guessing, GeoError::WrongPhase);
        let guesses = ctx.remaining_accounts;
        require!(guesses.len() == game.players.len(), GeoError::WrongPlayerAccounts);

        let game_id_bytes = game.game_id.to_le_bytes();
        let mut all_in = true;
        for (i, info) in guesses.iter().enumerate() {
            let player = game.players[i].player;
            let (expected, _) = Pubkey::find_program_address(
                &[GUESS_SEED, &game_id_bytes, player.as_ref()],
                &crate::ID,
            );
            require_keys_eq!(info.key(), expected, GeoError::WrongPlayerAccounts);
            let guess = Guess::try_deserialize(&mut &info.try_borrow_data()?[..])?;
            let (target_lat, target_lng) = (game.target_lat, game.target_lng);
            let slot = &mut game.players[i];
            if guess.submitted {
                slot.guessed = true;
                slot.lat = guess.lat;
                slot.lng = guess.lng;
                slot.distance_m = haversine_m(target_lat, target_lng, guess.lat, guess.lng);
                slot.guessed_at = guess.submitted_at;
            } else {
                all_in = false;
            }
        }
        let now = Clock::get()?.unix_timestamp;
        require!(all_in || now > game.deadline, GeoError::RoundStillOpen);

        let best = game
            .players
            .iter()
            .filter(|p| p.guessed)
            .map(|p| p.distance_m)
            .min();
        game.winner_mask = best.map_or(0, |best| {
            game.players
                .iter()
                .enumerate()
                .filter(|(_, p)| p.guessed && p.distance_m == best)
                .fold(0u16, |mask, (i, _)| mask | (1 << i))
        });
        game.phase = Phase::Revealed;
        game.revealed_at = now;
        msg!(
            "Geo duel {} revealed — best {:?} m, winners mask {:#b}",
            game.game_id,
            best,
            game.winner_mask
        );
        game.exit(&crate::ID)?;

        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// ER cleanup after the reveal: commit + undelegate a revealed guess PDA so
    /// its rent isn't stranded on the rollup. Kept separate from the reveal so
    /// each commit stays small. Anyone can call it once the round is revealed.
    pub fn release_guess(ctx: Context<ReleaseGuess>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.guess.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    // ───────────────────────────── base layer: payout ─────────────────────────────

    /// Pay out the pot once the revealed game is back on the base layer. Split
    /// evenly between tied winners (dust to the first); if nobody guessed,
    /// everyone is refunded. Permissionless — funds only go to recorded players.
    /// `remaining_accounts` = player wallets (writable) in join order.
    pub fn payout<'info>(ctx: Context<'info, Payout<'info>>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == Phase::Revealed, GeoError::WrongPhase);
        require!(!game.paid, GeoError::AlreadyPaid);
        let wallets = ctx.remaining_accounts;
        require!(wallets.len() == game.players.len(), GeoError::WrongPlayerAccounts);
        for (slot, wallet) in game.players.iter().zip(wallets.iter()) {
            require_keys_eq!(wallet.key(), slot.player, GeoError::WrongPlayerAccounts);
        }

        game.paid = true;
        game.phase = Phase::Settled;
        if game.stake == 0 {
            return Ok(());
        }

        let id_bytes = game.game_id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &id_bytes, &[ctx.bumps.vault]]];
        let n = game.players.len() as u64;
        let pot = game.stake.checked_mul(n).ok_or(GeoError::MathOverflow)?;

        if game.winner_mask == 0 {
            for wallet in wallets.iter() {
                pay_from_vault(&ctx.accounts.vault, wallet, game.stake, &ctx.accounts.system_program, seeds)?;
            }
            msg!("Nobody guessed — stakes refunded");
            return Ok(());
        }

        let winners: Vec<usize> = (0..game.players.len())
            .filter(|i| game.winner_mask & (1 << i) != 0)
            .collect();
        let share = pot / winners.len() as u64;
        let dust = pot - share * winners.len() as u64;
        for (k, &i) in winners.iter().enumerate() {
            let amount = if k == 0 { share + dust } else { share };
            pay_from_vault(&ctx.accounts.vault, &wallets[i], amount, &ctx.accounts.system_program, seeds)?;
            msg!("Paid {} lamports to {}", amount, game.players[i].player);
        }
        Ok(())
    }
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(init, payer = host, space = 8 + Game::LEN, seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(init, payer = host, space = 8 + Guess::LEN, seeds = [GUESS_SEED, &game_id.to_le_bytes(), host.key().as_ref()], bump)]
    pub guess: Account<'info, Guess>,
    /// SOL escrow, system-owned, never delegated.
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct JoinGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(init, payer = player, space = 8 + Guess::LEN, seeds = [GUESS_SEED, &game_id.to_le_bytes(), player.key().as_ref()], bump)]
    pub guess: Account<'info, Guess>,
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: validated by the VRF program
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSetLocation<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: the PDA to delegate (seeds checked by the delegation CPI)
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: ER validator identity
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct InitPermission<'info> {
    /// CHECK: delegated PDA being gated; verified against `account_type` seeds
    #[account(mut)]
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: verified by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct SubmitGuess<'info> {
    #[account(seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(mut, seeds = [GUESS_SEED, &game_id.to_le_bytes(), player.key().as_ref()], bump)]
    pub guess: Account<'info, Guess>,
    #[account(mut)]
    pub player: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct RevealAndSettle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

/// Releasing a guess mid-round would leak it to the base layer, so the game
/// must already be revealed. The game is read as raw data because right after
/// the reveal its owner is in flux (undelegating), but its address is pinned
/// by seeds so the bytes can only have come from this program.
#[commit]
#[derive(Accounts)]
pub struct ReleaseGuess<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [GUESS_SEED, &guess.game_id.to_le_bytes(), guess.player.as_ref()],
        bump,
        constraint = is_revealed(&game) @ GeoError::RoundStillOpen
    )]
    pub guess: Account<'info, Guess>,
    /// CHECK: the game PDA for this guess (seeds-pinned), checked for phase
    #[account(seeds = [GAME_SEED, &guess.game_id.to_le_bytes()], bump)]
    pub game: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────────── state ─────────────────────────────

#[account]
pub struct Game {
    pub game_id: u64,
    pub host: Pubkey,
    pub stake: u64,
    pub max_players: u8,
    pub guess_secs: u32,
    pub phase: Phase,
    pub created_at: i64,
    pub location_index: u16,
    pub target_lat: i32,
    pub target_lng: i32,
    pub deadline: i64,
    pub revealed_at: i64,
    pub winner_mask: u16,
    pub paid: bool,
    pub players: Vec<PlayerSlot>,
}
impl Game {
    pub const LEN: usize =
        8 + 32 + 8 + 1 + 4 + 1 + 8 + 2 + 4 + 4 + 8 + 8 + 2 + 1 + 4 + MAX_PLAYERS * PlayerSlot::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PlayerSlot {
    pub player: Pubkey,
    pub guessed: bool,
    pub lat: i32,
    pub lng: i32,
    pub distance_m: u32,
    pub guessed_at: i64,
}
impl PlayerSlot {
    pub const LEN: usize = 32 + 1 + 4 + 4 + 4 + 8;
    fn new(player: Pubkey) -> Self {
        Self {
            player,
            guessed: false,
            lat: 0,
            lng: 0,
            distance_m: NO_DISTANCE,
            guessed_at: 0,
        }
    }
}

/// A player's sealed guess. Lives on the ER behind a private permission, so
/// only its owner can read it until `reveal_and_settle` copies it into the game.
#[account]
pub struct Guess {
    pub game_id: u64,
    pub player: Pubkey,
    pub lat: i32,
    pub lng: i32,
    pub submitted: bool,
    pub submitted_at: i64,
}
impl Guess {
    pub const LEN: usize = 8 + 32 + 4 + 4 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Lobby,
    Locating,
    Guessing,
    Revealed,
    Settled,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    Guess { game_id: u64, player: Pubkey },
}

#[error_code]
pub enum GeoError {
    #[msg("max_players must be between 1 and 10")]
    BadMaxPlayers,
    #[msg("Guess time must be between 15 and 600 seconds")]
    BadGuessTime,
    #[msg("The lobby is closed")]
    LobbyClosed,
    #[msg("The lobby is full")]
    GameFull,
    #[msg("You already joined this game")]
    AlreadyJoined,
    #[msg("Only the host can do this")]
    NotHost,
    #[msg("Wrong game phase for this action")]
    WrongPhase,
    #[msg("Time is up")]
    TimeUp,
    #[msg("Coordinates out of range")]
    BadCoordinates,
    #[msg("You already locked in a guess")]
    AlreadyGuessed,
    #[msg("Players are still guessing")]
    RoundStillOpen,
    #[msg("Player accounts don't match the game")]
    WrongPlayerAccounts,
    #[msg("Account does not match its seeds")]
    WrongPda,
    #[msg("The pot has already been paid")]
    AlreadyPaid,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

// ───────────────────────────── helpers ─────────────────────────────

fn fund<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.to_account_info(),
                to: to.clone(),
            },
        ),
        lamports,
    )
}

/// Pre-fund a guess PDA's private permission rent and escrow the stake.
fn fund_guess_and_stake<'info>(
    system_program: &Program<'info, System>,
    player: &Signer<'info>,
    guess: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    stake: u64,
) -> Result<()> {
    fund(
        system_program,
        player,
        guess,
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
    )?;
    if stake > 0 {
        fund(system_program, player, vault, stake)?;
    }
    Ok(())
}

fn pay_from_vault<'info>(
    vault: &SystemAccount<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    system_program: &Program<'info, System>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.clone(),
            },
            signer_seeds,
        ),
        amount,
    )
}

fn derive_seeds(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Game { game_id } => vec![GAME_SEED.to_vec(), game_id.to_le_bytes().to_vec()],
        AccountType::Guess { game_id, player } => vec![
            GUESS_SEED.to_vec(),
            game_id.to_le_bytes().to_vec(),
            player.to_bytes().to_vec(),
        ],
    }
}

fn is_revealed(game: &AccountInfo) -> bool {
    let Ok(data) = game.try_borrow_data() else { return false };
    matches!(
        Game::try_deserialize(&mut &data[..]).map(|g| g.phase),
        Ok(Phase::Revealed | Phase::Settled)
    )
}

fn wrap_lng(lng: i64) -> i32 {
    let mut l = lng;
    if l > 180_000_000 {
        l -= 360_000_000;
    } else if l < -180_000_000 {
        l += 360_000_000;
    }
    l as i32
}

/// Great-circle distance in metres between two micro-degree coordinates.
pub fn haversine_m(lat1: i32, lng1: i32, lat2: i32, lng2: i32) -> u32 {
    const R: f64 = 6_371_008.8;
    let to_rad = |micro: i32| (micro as f64 / 1e6).to_radians();
    let (p1, p2) = (to_rad(lat1), to_rad(lat2));
    let dp = p2 - p1;
    let dl = to_rad(lng2) - to_rad(lng1);
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().min(1.0).asin();
    (R * c).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_known_distances() {
        // London -> Paris ≈ 343.5 km
        let d = haversine_m(51_507_400, -127_800, 48_856_600, 2_352_200);
        assert!((340_000..347_000).contains(&d), "{d}");
        assert_eq!(haversine_m(10_000_000, 20_000_000, 10_000_000, 20_000_000), 0);
        // antipodes ≈ half circumference
        let d = haversine_m(0, 0, 0, 180_000_000);
        assert!((20_000_000..20_040_000).contains(&d), "{d}");
    }

    #[test]
    fn lng_wraps() {
        assert_eq!(wrap_lng(180_010_000), -179_990_000);
        assert_eq!(wrap_lng(-180_010_000), 179_990_000);
    }
}
