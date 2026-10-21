//! Locked savings — deterministic, on-chain time locks.

use soroban_sdk::{Address, Env};

use crate::admin;
use crate::error::Error;
use crate::events::{
    TOPIC_LOCKED_CREATED, TOPIC_LOCKED_EARLY_WITHDRAW, TOPIC_LOCKED_TOP_UP, TOPIC_LOCKED_WITHDRAW,
};
use crate::storage::{self, extend_instance_ttl};
use crate::types::{DataKey, LockedPlan};

/// Create a locked plan that unlocks at `unlock_at` (ledger timestamp) and
/// fund it with an initial `amount`.
///
/// - `owner.require_auth()`, token transfer_in.
/// - Errors `InvalidUnlockTime` if `unlock_at <= now`.
/// - Returns the new plan id.
pub fn create(env: &Env, owner: Address, amount: i128, unlock_at: u64) -> Result<u64, Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if unlock_at <= env.ledger().timestamp() {
        return Err(Error::InvalidUnlockTime);
    }

    storage::transfer_in(env, &owner, amount)?;

    let id = storage::next_id(env, DataKey::NextLockedId);
    let now = env.ledger().timestamp();
    let plan = LockedPlan {
        id,
        owner: owner.clone(),
        balance: amount,
        unlock_at,
        created_at: now,
    };
    let key = DataKey::Locked(id);
    env.storage().persistent().set(&key, &plan);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_LOCKED_CREATED, owner.clone(), id),
        (id, owner, amount, unlock_at, now),
    );

    Ok(id)
}

/// Add more funds to an existing locked plan (does not change unlock time).
///
/// - `owner.require_auth()`.
/// - Errors `Unauthorized` if `owner` does not own `plan_id`.
pub fn top_up(env: &Env, owner: Address, plan_id: u64, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::Locked(plan_id);
    let mut plan: LockedPlan = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if plan.owner != owner {
        return Err(Error::Unauthorized);
    }

    storage::transfer_in(env, &owner, amount)?;

    let new_balance = plan.balance.checked_add(amount).ok_or(Error::Overflow)?;
    plan.balance = new_balance;
    env.storage().persistent().set(&key, &plan);
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    env.events().publish(
        (TOPIC_LOCKED_TOP_UP, owner.clone(), plan_id),
        (plan_id, owner, amount, new_balance, now),
    );

    Ok(())
}

/// Withdraw from a locked plan. Only permitted once `now >= unlock_at`.
///
/// Errors: `Unauthorized` if `owner` does not own `plan_id`,
/// `InsufficientBalance` if over-withdrawing (checked before the time
/// guard so callers get the most actionable error), `StillLocked` before
/// unlock.
///
/// ## Payout destination
///
/// As with `flexible::withdraw`, there is no separate "recipient"
/// parameter: `owner` must both authenticate (`require_auth`) and match the
/// plan's stored owner, and `token_client.transfer` always pays that same
/// address. Funds cannot be redirected to a third-party address — the API
/// gives the caller no way to name one. No exception to this exists for
/// locked (solo) plans.
pub fn withdraw(env: &Env, owner: Address, plan_id: u64, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::Locked(plan_id);
    let mut plan: LockedPlan = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if plan.owner != owner {
        return Err(Error::Unauthorized);
    }

    if amount > plan.balance {
        return Err(Error::InsufficientBalance);
    }

    if env.ledger().timestamp() < plan.unlock_at {
        return Err(Error::StillLocked);
    }

    storage::transfer_out(env, &owner, amount)?;

    let new_balance = plan.balance.checked_sub(amount).ok_or(Error::Overflow)?;
    plan.balance = new_balance;
    env.storage().persistent().set(&key, &plan);
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    env.events().publish(
        (TOPIC_LOCKED_WITHDRAW, owner.clone(), plan_id),
        (plan_id, owner, amount, new_balance, now),
    );

    Ok(())
}

pub fn get_plan(env: &Env, plan_id: u64) -> Result<LockedPlan, Error> {
    let key = DataKey::Locked(plan_id);
    let plan = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);
    Ok(plan)
}

/// Withdraw part of a locked plan's balance *before* `unlock_at`, paying an
/// admin-configured penalty on the withdrawn amount.
///
/// This is the partial-withdrawal path for funds that are still locked: the
/// owner can take some (or all) of the balance early, but a penalty is
/// skimmed off the top and sent to the configured penalty recipient. The
/// plan itself stays open with the reduced balance; a later
/// [`withdraw`] (or another early withdrawal) can take the rest.
///
/// ## Minimum lock period
///
/// Early withdrawal is only available once the plan has been locked for at
/// least `min_lock_period` seconds
/// ([`crate::admin::min_lock_period`]), so the valid window is
/// `[created_at + min_lock_period, unlock_at)`. Attempts before the window
/// opens fail with `TimeWindowNotOpen`; attempts once `unlock_at` has passed
/// fail with `OperationExpired` — at that point the penalty-free
/// [`withdraw`] applies instead.
///
/// ## Penalty
///
/// `penalty = amount * early_withdraw_penalty_bps / 10_000`, floored. The
/// owner receives `amount - penalty`; the penalty goes to
/// [`crate::admin::penalty_recipient`] (the admin by default). A zero
/// penalty (rate unset) skips the recipient transfer entirely.
///
/// Errors: `Unauthorized` if `owner` does not own `plan_id`,
/// `InsufficientBalance` if over-withdrawing, `TimeWindowNotOpen`,
/// `OperationExpired`.
pub fn early_withdraw(env: &Env, owner: Address, plan_id: u64, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::Locked(plan_id);
    let mut plan: LockedPlan = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if plan.owner != owner {
        return Err(Error::Unauthorized);
    }

    if amount > plan.balance {
        return Err(Error::InsufficientBalance);
    }

    let now = env.ledger().timestamp();

    // Already unlocked: the penalized path no longer applies.
    if now >= plan.unlock_at {
        return Err(Error::OperationExpired);
    }

    // Window not yet open: still inside the minimum lock period.
    let window_opens = plan
        .created_at
        .checked_add(admin::min_lock_period(env))
        .ok_or(Error::Overflow)?;
    if now < window_opens {
        return Err(Error::TimeWindowNotOpen);
    }

    let bps = admin::early_withdraw_penalty_bps(env);
    let penalty = amount
        .checked_mul(bps as i128)
        .ok_or(Error::Overflow)?
        / 10_000;
    let net = amount.checked_sub(penalty).ok_or(Error::Overflow)?;

    if net > 0 {
        storage::transfer_out(env, &owner, net)?;
    }
    if penalty > 0 {
        storage::transfer_out(env, &admin::penalty_recipient(env)?, penalty)?;
    }

    let new_balance = plan.balance.checked_sub(amount).ok_or(Error::Overflow)?;
    plan.balance = new_balance;
    env.storage().persistent().set(&key, &plan);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_LOCKED_EARLY_WITHDRAW, owner.clone(), plan_id),
        (plan_id, owner, amount, penalty, new_balance, now),
    );

    Ok(())
}
