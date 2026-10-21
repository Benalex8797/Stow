//! Storage helpers and TTL management.
//!
//! Centralize all `env.storage()` access here so the persistence strategy
//! (instance vs. persistent, TTL bumping) lives in one place.
//!
//! # Storage model
//!
//! Soroban gives contracts three storage durabilities; this crate uses two
//! of them, chosen per [`DataKey`] variant as documented on each variant:
//!
//! - **Instance storage** — attached to the contract instance itself. Used
//!   for small, hot, singleton values that are read on nearly every call:
//!   `Token`, `Admin`, `DepositCap`, `Config`, `InterestRateBps`,
//!   `InterestFrequency`, and the `Next*Id` counters.
//!   Cheapest option for this shape of data, and its TTL is bumped as a
//!   single unit by [`extend_instance_ttl`], called at the top of every
//!   state-changing entrypoint — so as long as the contract sees any
//!   mutating traffic within the bump window, none of these values expire.
//! - **Persistent storage** — one entry per record, for unbounded
//!   collections keyed by user or id: `Flexible(Address)`,
//!   `InterestAccount(Address)`, `Locked(u64)`, `Goal(u64)`, `Group(u64)`.
//!   These do **not** share a TTL with the
//!   instance; each entry's TTL is refreshed only when that specific entry
//!   is written. A record that is never touched again (e.g. a flexible
//!   account drained to zero and abandoned) will eventually hit its
//!   minimum persistent TTL and become eligible for archival by the
//!   network; reading an archived entry then requires a `restore` before
//! the next `get`. [`extend_persistent_ttl`] is called after every read
//! and write of a `Flexible`, `InterestAccount`, `Locked`, `Goal`, or
//! `Group` record so a record touched within the bump window never expires.
//!
//! ## TTL policy
//!
//! [`INSTANCE_BUMP_AMOUNT`] / [`INSTANCE_LIFETIME_THRESHOLD`] control the
//! instance TTL. [`PERSISTENT_BUMP_AMOUNT`] / [`PERSISTENT_LIFETIME_THRESHOLD`]
//! control persistent per-entry TTLs via [`extend_persistent_ttl`], called
//! on every read and write of a `Flexible`/`InterestAccount`/`Locked`/
//! `Goal`/`Group` record.
//!
//! ## Storage cost for large groups
//!
//! `Group` (see [`DataKey::Group`]) stores its full `members` vector and
//! `shares_bps` map inline in a single persistent entry. Every `join`,
//! `contribute`, `set_shares`, or `settle` call reads and rewrites that
//! entire entry, so per-call cost — and the rent required to keep the
//! entry's TTL alive — scales linearly with membership size. There is no
//! enforced cap on group size; a very large group is progressively more
//! expensive to mutate and to keep from expiring than a small one.

use soroban_sdk::{token, Address, Env};

use crate::error::Error;
use crate::types::DataKey;

// --- TTL constants (ledgers) --------------------------------------------
// Roughly: 1 ledger ~= 5s on mainnet cadence.
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// Instance TTL: bumped at the top of every state-changing entrypoint, so it
/// only lapses if the contract sees no mutating traffic for a full bump
/// window. 30 days gives generous headroom over any realistic call cadence
/// while keeping the per-call rent cost predictable.
pub const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Persistent per-entry TTL: bumped on every read/write of a `Flexible`,
/// `Locked`, `Goal`, or `Group` record via [`extend_persistent_ttl`]. Same
/// window as the instance bump — a record touched at least once a month
/// (deposit, withdraw, contribute, a simple query, ...) never expires.
pub const PERSISTENT_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = PERSISTENT_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Bump the instance TTL. Call at the top of every state-changing entrypoint.
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

/// Bump a persistent entry's TTL. Call after every read and write of a
/// `Flexible`, `InterestAccount`, `Locked`, `Goal`, or `Group` record so it
/// does not become eligible for archival between touches.
pub fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(
        key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// The token (e.g. USDC) this vault custodies, or `None` before `initialize`.
pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token)
}

/// Persist `DataKey::Token`.
pub fn set_token(env: &Env, token: &Address) {
    extend_instance_ttl(env);
    env.storage().instance().set(&DataKey::Token, token);
}

/// The contract admin, or `None` before `initialize`.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

/// Allocate and persist the next id for the given counter key.
///
/// Ids start at `1` (the counter reads `0` when absent, so the first
/// allocation returns `1`).
pub fn next_id(env: &Env, key: DataKey) -> u64 {
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}

// --- SEP-41 token movement -------------------------------------------------
//
// Every module moves funds through these two helpers rather than building a
// `token::Client` and calling `transfer` directly, so amount validation and
// the transfer direction (in vs. out of the vault) live in exactly one
// place.

/// Move `amount` of the vault token from `from` into the contract.
///
/// Errors `Error::InvalidAmount` if `amount <= 0`, `Error::NotInitialized`
/// if the vault token has not been configured.
pub fn transfer_in(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let token_address = get_token(env).ok_or(Error::NotInitialized)?;
    let token_client = token::Client::new(env, &token_address);
    token_client.transfer(from, &env.current_contract_address(), &amount);
    Ok(())
}

/// Move `amount` of the vault token from the contract out to `to`.
///
/// Errors `Error::InvalidAmount` if `amount <= 0`, `Error::NotInitialized`
/// if the vault token has not been configured.
pub fn transfer_out(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let token_address = get_token(env).ok_or(Error::NotInitialized)?;
    let token_client = token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), to, &amount);
    Ok(())
}
