//! Initialization and admin configuration.

use soroban_sdk::{Address, BytesN, Env};

use crate::error::Error;
use crate::events::{EVENT_SCHEMA_VERSION, TOPIC_ADMIN_SET, TOPIC_INIT, TOPIC_UPGRADED};
use crate::storage::{self, extend_instance_ttl};
use crate::types::DataKey;

/// Initialize the vault.
///
/// - Stores `admin` and the `token` (SEP-41, e.g. USDC) address.
/// - Seeds id counters.
/// - Must be callable exactly once; subsequent calls -> `Error::AlreadyInitialized`.
///
/// Acceptance: after init, `token()` and `admin()` return the given values.
pub fn initialize(env: &Env, admin: Address, token: Address) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::AlreadyInitialized);
    }

    extend_instance_ttl(env);

    env.storage().instance().set(&DataKey::Admin, &admin);
    storage::set_token(env, &token);

    env.storage().instance().set(&DataKey::NextLockedId, &0u64);
    env.storage().instance().set(&DataKey::NextGoalId, &0u64);
    env.storage().instance().set(&DataKey::NextGroupId, &0u64);
    env.storage().instance().set(&DataKey::Paused, &false);

    env.events().publish(
        (TOPIC_INIT,),
        (admin, token, EVENT_SCHEMA_VERSION, env.ledger().timestamp()),
    );

    Ok(())
}

/// Return the configured token address, or `Error::NotInitialized`.
pub fn token(env: &Env) -> Result<Address, Error> {
    storage::get_token(env).ok_or(Error::NotInitialized)
}

/// Return the configured admin address, or `Error::NotInitialized`.
pub fn admin(env: &Env) -> Result<Address, Error> {
    storage::get_admin(env).ok_or(Error::NotInitialized)
}

/// Rotate the admin. Requires `require_auth` from the current admin.
pub fn set_admin(env: &Env, new_admin: Address) -> Result<(), Error> {
    extend_instance_ttl(env);

    let current_admin = admin(env)?;
    current_admin.require_auth();

    env.storage().instance().set(&DataKey::Admin, &new_admin);

    env.events().publish(
        (TOPIC_ADMIN_SET,),
        (current_admin, new_admin, env.ledger().timestamp()),
    );

    Ok(())
}

/// Set the emergency-pause flag. Admin-only.
///
/// While paused, mutating entrypoints reject with `Error::Paused`; reads
/// remain available.
pub fn set_paused(env: &Env, caller: Address, paused: bool) -> Result<(), Error> {
    extend_instance_ttl(env);

    let current_admin = admin(env)?;
    caller.require_auth();
    if caller != current_admin {
        return Err(Error::Unauthorized);
    }

    env.storage().instance().set(&DataKey::Paused, &paused);

    Ok(())
}

/// Whether the contract is currently paused. Defaults to `false` if unset.
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

/// Guard for mutating entrypoints: returns `Error::Paused` while paused.
pub fn require_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::Paused);
    }
    Ok(())
}

/// The per-account deposit cap, in token stroops. `0` means unlimited.
///
/// Defaults to `0` (unlimited) before `set_deposit_cap` has ever been
/// called.
pub fn deposit_cap(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::DepositCap).unwrap_or(0)
}

/// Set the per-account deposit cap. Admin-only. `0` disables the cap.
///
/// - Requires `require_auth` from the current admin.
/// - Errors `InvalidAmount` if `cap < 0`.
/// - Takes effect immediately: the very next `deposit` call is checked
///   against the new value.
pub fn set_deposit_cap(env: &Env, cap: i128) -> Result<(), Error> {
    extend_instance_ttl(env);

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();

    if cap < 0 {
        return Err(Error::InvalidAmount);
    }

    env.storage().instance().set(&DataKey::DepositCap, &cap);

    Ok(())
}

/// The minimum deposit amount, in token stroops. `0` means no minimum.
///
/// Defaults to `0` (no minimum) before `set_min_deposit` has ever been
/// called.
pub fn min_deposit(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::MinDeposit).unwrap_or(0)
}

/// Set the minimum deposit amount. Admin-only. `0` disables the minimum.
///
/// - Requires `require_auth` from the current admin.
/// - Errors `InvalidAmount` if `min < 0`.
/// - Takes effect immediately: the very next `deposit` call is checked
///   against the new value.
pub fn set_min_deposit(env: &Env, min: i128) -> Result<(), Error> {
    extend_instance_ttl(env);

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();

    if min < 0 {
        return Err(Error::InvalidAmount);
    }

    env.storage().instance().set(&DataKey::MinDeposit, &min);

    Ok(())
}

/// The penalty charged on an early locked withdrawal, in basis points
/// (1/100 of a percent). Defaults to `0` (no penalty) before
/// `set_early_withdraw_penalty_bps` has ever been called.
pub fn early_withdraw_penalty_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::EarlyWithdrawPenaltyBps)
        .unwrap_or(0)
}

/// Set the early-withdrawal penalty. Admin-only. `0` disables the penalty.
///
/// - Requires `require_auth` from the current admin.
/// - Errors `InvalidParameters` if `bps > 10_000` (a penalty above 100%).
/// - Takes effect immediately: the very next `locked_early_withdraw` is
///   charged the new rate.
pub fn set_early_withdraw_penalty_bps(env: &Env, bps: u32) -> Result<(), Error> {
    extend_instance_ttl(env);

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();

    if bps > 10_000 {
        return Err(Error::InvalidParameters);
    }

    env.storage()
        .instance()
        .set(&DataKey::EarlyWithdrawPenaltyBps, &bps);

    Ok(())
}

/// The address that receives early-withdrawal penalties. Defaults to the
/// current admin when unset.
///
/// Errors `NotInitialized` if neither a recipient nor an admin is set.
pub fn penalty_recipient(env: &Env) -> Result<Address, Error> {
    if let Some(recipient) = env.storage().instance().get(&DataKey::PenaltyRecipient) {
        return Ok(recipient);
    }
    storage::get_admin(env).ok_or(Error::NotInitialized)
}

/// Set the address that receives early-withdrawal penalties. Admin-only.
///
/// - Requires `require_auth` from the current admin.
pub fn set_penalty_recipient(env: &Env, recipient: Address) -> Result<(), Error> {
    extend_instance_ttl(env);

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();

    env.storage()
        .instance()
        .set(&DataKey::PenaltyRecipient, &recipient);

    Ok(())
}

/// The minimum time, in seconds, a locked plan must have been locked before a
/// penalized early withdrawal is allowed. Defaults to `0` (no minimum)
/// before `set_min_lock_period` has ever been called.
pub fn min_lock_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MinLockPeriod)
        .unwrap_or(0)
}

/// Set the minimum lock period for early withdrawal. Admin-only. `0`
/// disables the minimum.
///
/// - Requires `require_auth` from the current admin.
/// - Takes effect immediately: the very next `locked_early_withdraw` is
///   checked against the new value.
pub fn set_min_lock_period(env: &Env, seconds: u64) -> Result<(), Error> {
    extend_instance_ttl(env);

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();

    env.storage()
        .instance()
        .set(&DataKey::MinLockPeriod, &seconds);

    Ok(())
}

/// Upgrade the contract's executable to `new_wasm_hash`. Admin-only.
///
/// - Requires `require_auth` from the current admin.
/// - `new_wasm_hash` must already be uploaded to the ledger (e.g. via the
///   Stellar CLI or `Deployer::upload_contract_wasm`); this call swaps the
///   currently-installed code for that Wasm. The swap does not take effect
///   until *after* this invocation finishes.
/// - Storage is not migrated as part of the swap — the new Wasm must remain
///   compatible with existing persisted `DataKey` records, or migrate them
///   itself on next write.
/// - Emits an `upgraded` event.
///
/// ## Trust trade-off
///
/// This makes the admin key a single point of total control: whoever holds
/// it can replace the contract's logic outright, including the rules that
/// govern custodied funds — there is no on-chain check that the new Wasm
/// preserves any invariant the old one had. This is deliberate for now (it
/// lets bugs be patched post-deploy without migrating to a new contract
/// address), but it means depositors are trusting the admin key's
/// operational security as much as the code itself. Hardening this trust
/// assumption (a timelock, a multisig admin, or both) is tracked as
/// follow-up work, not part of this issue.
pub fn upgrade(env: &Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
    extend_instance_ttl(env);

    let current_admin = admin(env)?;
    caller.require_auth();
    if caller != current_admin {
        return Err(Error::Unauthorized);
    }

    env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

    env.events().publish(
        (TOPIC_UPGRADED,),
        (caller, new_wasm_hash, env.ledger().timestamp()),
    );

    Ok(())
}
