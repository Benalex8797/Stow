//! Interest-bearing savings — compound interest accrual.
//!
//! An [`InterestAccount`] grows by compound interest at an admin-configured
//! annual rate ([`set_rate`]) and compounding frequency ([`set_frequency`]).
//! Interest is **lazy**: nothing is written per period. The accrued amount is
//! derived on demand and folded into the account's principal only when the
//! owner calls [`claim`], or on the next [`deposit`]/[`withdraw`].
//!
//! ## Accrual model
//!
//! For each whole compounding period elapsed since `last_compound_at`, the
//! principal is multiplied by `(1 + r)`, where `r` is the per-period rate
//! derived from the annual rate: `r = annual_bps / (10_000 * periods_per_year)`.
//! Partial periods do not accrue, but their time is carried forward — the
//! anchor advances by whole periods only, never to `now`.
//!
//! ## Precision & gas
//!
//! The periodic factor is a fixed-point value scaled by [`SCALE`], and the
//! `n`-period growth is computed by **exponentiation by squaring** — `O(log n)`
//! multiplications regardless of how long the account has been idle, rather
//! than looping once per period. Multiplies go through [`mul_div_floor`],
//! which uses the host's 256-bit `I256` for the intermediate product, so a
//! valid computation never overflows and only an un-representable *quotient*
//! errors. Every step rounds **down**, so the contract never over-credits.
//!
//! ## Rate changes
//!
//! Each account snapshots `rate_bps`/`frequency` when it is touched. Accrual
//! always uses the snapshot, so an admin rate change can never re-price time
//! that has already accrued; the new rate applies from the account's next
//! touch onward.

use soroban_sdk::{Address, Env, I256};

use crate::admin::require_not_paused;
use crate::error::Error;
use crate::events::{
    TOPIC_INTEREST_CLAIMED, TOPIC_INTEREST_DEPOSIT, TOPIC_INTEREST_FREQUENCY_SET,
    TOPIC_INTEREST_RATE_SET, TOPIC_INTEREST_WITHDRAW,
};
use crate::storage::{self, extend_instance_ttl};
use crate::types::{CompoundFrequency, DataKey, InterestAccount};

/// The denominator for a `rate_bps` value: 100% expressed in basis points.
const TOTAL_BPS: u32 = 10_000;

/// Highest settable annual interest rate (100%). Enforced by [`set_rate`].
const MAX_INTEREST_BPS: u32 = 10_000;

/// Fixed-point scale for the compounding factor: `SCALE` represents `1.0`.
const SCALE: i128 = 1_000_000_000_000;

/// Set the annual interest rate. Admin-only. `0` disables interest.
///
/// The rate applies to interest accounts from their next touch onward; it
/// never re-prices time already accrued (see [`settle`]).
///
/// Errors: `NotInitialized`, `Unauthorized` if the caller is not the admin,
/// `InvalidParameters` if `rate_bps > MAX_INTEREST_BPS`.
pub fn set_rate(env: &Env, caller: Address, rate_bps: u32) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != admin {
        return Err(Error::Unauthorized);
    }
    if rate_bps > MAX_INTEREST_BPS {
        return Err(Error::InvalidParameters);
    }

    env.storage()
        .instance()
        .set(&DataKey::InterestRateBps, &rate_bps);

    env.events().publish(
        (TOPIC_INTEREST_RATE_SET,),
        (caller, rate_bps, env.ledger().timestamp()),
    );

    Ok(())
}

/// The annual interest rate, in basis points. `0` (the default) means no
/// interest accrues.
pub fn rate_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::InterestRateBps)
        .unwrap_or(0)
}

/// Set the compounding frequency. Admin-only.
///
/// Applies to interest accounts from their next touch onward.
///
/// Errors: `NotInitialized`, `Unauthorized` if the caller is not the admin.
pub fn set_frequency(
    env: &Env,
    caller: Address,
    frequency: CompoundFrequency,
) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;

    let admin = storage::get_admin(env).ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != admin {
        return Err(Error::Unauthorized);
    }

    env.storage()
        .instance()
        .set(&DataKey::InterestFrequency, &frequency);

    env.events().publish(
        (TOPIC_INTEREST_FREQUENCY_SET,),
        (caller, frequency, env.ledger().timestamp()),
    );

    Ok(())
}

/// The current compounding frequency. Defaults to
/// [`CompoundFrequency::Annually`] before `set_frequency` is ever called.
pub fn frequency(env: &Env) -> CompoundFrequency {
    env.storage()
        .instance()
        .get(&DataKey::InterestFrequency)
        .unwrap_or(CompoundFrequency::Annually)
}

/// Deposit `amount` into the caller's interest account, creating it on first
/// deposit and settling any interest accrued so far.
///
/// Errors: `InvalidAmount` if `amount <= 0`, `Overflow` if the resulting
/// principal would not fit in `i128`, plus transfer errors from
/// [`storage::transfer_in`].
pub fn deposit(env: &Env, owner: Address, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let now = env.ledger().timestamp();
    let key = DataKey::InterestAccount(owner.clone());
    let existing: Option<InterestAccount> = env.storage().persistent().get(&key);
    let mut account = match existing {
        Some(account) => {
            storage::extend_persistent_ttl(env, &key);
            account
        }
        None => InterestAccount {
            owner: owner.clone(),
            principal: 0,
            last_compound_at: now,
            rate_bps: rate_bps(env),
            frequency: frequency(env),
            created_at: now,
            updated_at: now,
        },
    };

    // Settle under the account's snapshot *before* adopting the latest
    // global config, so a rate/frequency change never re-prices old time.
    settle(env, &mut account, now)?;
    account.rate_bps = rate_bps(env);
    account.frequency = frequency(env);

    account.principal = account.principal.checked_add(amount).ok_or(Error::Overflow)?;
    account.updated_at = now;

    storage::transfer_in(env, &owner, amount)?;

    env.storage().persistent().set(&key, &account);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_INTEREST_DEPOSIT, owner.clone()),
        (owner, amount, account.principal, now),
    );

    Ok(())
}

/// Withdraw `amount` from the caller's interest account back to their wallet.
///
/// Accrued interest is settled into the principal first, so `amount` may draw
/// on interest credited since the last touch.
///
/// Errors: `InvalidAmount` if `amount <= 0`, `NotFound` if the account does
/// not exist, `InsufficientBalance` if `amount` exceeds the settled
/// principal.
pub fn withdraw(env: &Env, owner: Address, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    owner.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::InterestAccount(owner.clone());
    let mut account: InterestAccount =
        env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    settle(env, &mut account, now)?;
    account.rate_bps = rate_bps(env);
    account.frequency = frequency(env);

    if amount > account.principal {
        return Err(Error::InsufficientBalance);
    }

    let new_principal = account.principal.checked_sub(amount).ok_or(Error::Overflow)?;

    storage::transfer_out(env, &owner, amount)?;

    account.principal = new_principal;
    account.updated_at = now;
    env.storage().persistent().set(&key, &account);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_INTEREST_WITHDRAW, owner.clone()),
        (owner, amount, new_principal, now),
    );

    Ok(())
}

/// Settle accrued interest into the caller's principal and return the amount
/// credited.
///
/// Idempotent between compounding periods: a second call before the next
/// period elapses returns `0`. The credited interest becomes part of the
/// principal, so it compounds on subsequent periods.
///
/// Errors: `NotFound` if the account does not exist, `Overflow`.
pub fn claim(env: &Env, owner: Address) -> Result<i128, Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    owner.require_auth();

    let key = DataKey::InterestAccount(owner.clone());
    let mut account: InterestAccount =
        env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    let credited = settle(env, &mut account, now)?;
    account.rate_bps = rate_bps(env);
    account.frequency = frequency(env);
    account.updated_at = now;

    env.storage().persistent().set(&key, &account);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_INTEREST_CLAIMED, owner.clone()),
        (owner, credited, account.principal, now),
    );

    Ok(credited)
}

/// Read an interest account (or `NotFound`).
pub fn get_account(env: &Env, owner: Address) -> Result<InterestAccount, Error> {
    let key = DataKey::InterestAccount(owner);
    let account = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);
    Ok(account)
}

/// The interest currently accrued but not yet credited to `owner`'s
/// principal — a read-only preview of what [`claim`] would credit now.
///
/// Errors: `NotFound` if the account does not exist, `Overflow`.
pub fn accrued(env: &Env, owner: Address) -> Result<i128, Error> {
    let key = DataKey::InterestAccount(owner);
    let account: InterestAccount =
        env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    let period = account.frequency.period_seconds();
    let periods = now.saturating_sub(account.last_compound_at) / period;
    if periods == 0 {
        return Ok(0);
    }

    let compounded = compound(
        env,
        account.principal,
        account.rate_bps,
        account.frequency.periods_per_year(),
        periods,
    )?;
    compounded.checked_sub(account.principal).ok_or(Error::Overflow)
}

/// Compound `account.principal` over the whole periods elapsed since
/// `last_compound_at`, advancing that anchor by exactly those periods.
///
/// Returns the interest credited. A no-op (returning `0`) when no whole
/// period has elapsed.
fn settle(env: &Env, account: &mut InterestAccount, now: u64) -> Result<i128, Error> {
    let period = account.frequency.period_seconds();
    let periods = now.saturating_sub(account.last_compound_at) / period;
    if periods == 0 {
        return Ok(0);
    }

    let compounded = compound(
        env,
        account.principal,
        account.rate_bps,
        account.frequency.periods_per_year(),
        periods,
    )?;
    let credited = compounded
        .checked_sub(account.principal)
        .ok_or(Error::Overflow)?;
    let advanced = periods
        .checked_mul(period)
        .and_then(|elapsed| account.last_compound_at.checked_add(elapsed))
        .ok_or(Error::Overflow)?;

    account.principal = compounded;
    account.last_compound_at = advanced;
    Ok(credited)
}

/// Compound `principal` over `periods` whole periods at `rate_bps` annual,
/// compounding `periods_per_year` times a year. Rounds down.
fn compound(
    env: &Env,
    principal: i128,
    rate_bps: u32,
    periods_per_year: u32,
    periods: u64,
) -> Result<i128, Error> {
    if principal == 0 || periods == 0 || rate_bps == 0 {
        return Ok(principal);
    }
    let factor = period_factor(env, rate_bps, periods_per_year)?;
    let growth = pow_factor(env, factor, periods)?;
    mul_div_floor(env, principal, growth, SCALE)
}

/// The fixed-point growth factor for a single period: `SCALE * (1 + r)`,
/// where `r = rate_bps / (TOTAL_BPS * periods_per_year)`, rounded down.
fn period_factor(env: &Env, rate_bps: u32, periods_per_year: u32) -> Result<i128, Error> {
    let denominator = (TOTAL_BPS as i128)
        .checked_mul(periods_per_year as i128)
        .ok_or(Error::Overflow)?;
    let numerator = denominator.checked_add(rate_bps as i128).ok_or(Error::Overflow)?;
    mul_div_floor(env, SCALE, numerator, denominator)
}

/// `base^exp / SCALE^(exp - 1)`, rounded down at each step, via
/// exponentiation by squaring (`O(log exp)` multiplications).
fn pow_factor(env: &Env, base: i128, mut exp: u64) -> Result<i128, Error> {
    let mut result = SCALE;
    let mut squared = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = mul_div_floor(env, result, squared, SCALE)?;
        }
        exp >>= 1;
        if exp > 0 {
            squared = mul_div_floor(env, squared, squared, SCALE)?;
        }
    }
    Ok(result)
}

/// `a * b / denominator`, rounded down, using a 256-bit intermediate so the
/// product itself can never overflow.
///
/// Callers pass non-negative `a`/`b` and a positive `denominator`, so
/// truncating integer division is exactly floor division. Errors
/// `Error::Overflow` if `denominator == 0` or the quotient does not fit in
/// `i128`.
fn mul_div_floor(env: &Env, a: i128, b: i128, denominator: i128) -> Result<i128, Error> {
    if denominator == 0 {
        return Err(Error::Overflow);
    }
    let product = I256::from_i128(env, a).mul(&I256::from_i128(env, b));
    product
        .div(&I256::from_i128(env, denominator))
        .to_i128()
        .ok_or(Error::Overflow)
}
