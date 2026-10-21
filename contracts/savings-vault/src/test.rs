#![cfg(test)]
//! Test skeleton. Each `#[ignore]`d test is a placeholder for a contributor.
//!
//! Pattern: register the contract, register a SEP-41 token (StellarAssetClient
//! from `soroban_sdk::testutils`), initialize, then exercise the entrypoint.
//!
//! Helper [`setup_with_token`] wires a mock token, mints an initial balance to
//! the given user, and returns everything the tests need.  Tests that only need
//! the bare contract shell (no token) can still call [`setup`].

use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Env, IntoVal, Map, String,
};

use crate::error::Error;
use crate::events::{TOPIC_DEPOSIT, TOPIC_WITHDRAW};
use crate::group_split;
use crate::types::CompoundFrequency;
use crate::{SavingsVault, SavingsVaultClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup(env: &Env) -> SavingsVaultClient {
    let contract_id = env.register(SavingsVault, ());
    SavingsVaultClient::new(env, &contract_id)
}

/// Full setup: vault + SEP-41 mock token + admin.
///
/// Returns `(client, admin, token_address)`.
fn setup_with_token(env: &Env) -> (SavingsVaultClient, Address, Address) {
    let client = setup(env);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);

    // Register a built-in Stellar asset contract as the mock USDC token.
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();

    client.initialize(&admin, &token_address);

    (client, admin, token_address)
}

/// Mint `amount` stroops of the vault token to `recipient` (bypasses auth for
/// test convenience).
fn mint(env: &Env, token: &Address, token_admin: &Address, recipient: &Address, amount: i128) {
    let sac = StellarAssetClient::new(env, token);
    env.mock_all_auths();
    sac.mint(recipient, &amount);
}

/// Set the ledger timestamp (and sequence number) so time-lock tests can
/// travel forward deterministically.
fn set_ledger_time(env: &Env, timestamp: u64, sequence_number: u32) {
    env.ledger().set(LedgerInfo {
        timestamp,
        protocol_version: 22,
        sequence_number,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });
}

// ---------------------------------------------------------------------------
// Existing placeholder stubs
// ---------------------------------------------------------------------------

#[test]
fn initialize_sets_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    assert_eq!(client.admin(), admin);
    assert_eq!(client.token(), token);
}

#[test]
fn flexible_deposit_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let amount = 25_000_000i128;
    mint(&env, &token, &token_admin, &owner, amount);
    client.deposit(&owner, &amount);
    let account = client.get_account(&owner);
    assert_eq!(account.owner, owner);
    assert_eq!(account.balance, amount);
    assert_eq!(
        client.try_get_account(&Address::generate(&env)),
        Err(Ok(Error::NotFound))
    );
}

#[test]
fn locked_respects_time_lock() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let amount = 25_000_000i128;
    mint(&env, &token, &token_admin, &owner, amount);
    let now = env.ledger().timestamp();
    let id = client.locked_create(&owner, &amount, &(now + 100));
    let top_up = 5_000_000i128;
    mint(&env, &token, &token_admin, &owner, top_up);
    client.locked_top_up(&owner, &id, &top_up);
    let plan = client.locked_plan(&id);
    assert_eq!(plan.balance, amount + top_up);
    assert_eq!(plan.unlock_at, now + 100);
}

// ---------------------------------------------------------------------------
// Issue #36 — goal milestone + claim
// ---------------------------------------------------------------------------

/// Contributing across the target boundary sets `reached_at` exactly once
/// and emits a `goal_reached` event alongside the `goal_contribution` event;
/// further contributions after the target is met neither move `reached_at`
/// nor re-emit the milestone event.
#[test]
fn goal_reaches_target() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 100_000_000; // 100 USDC
    const FIRST: i128 = 40_000_000; // below target
    const SECOND: i128 = 70_000_000; // 40 + 70 = 110 -> crosses target
    const THIRD: i128 = 1_000_000; // contributed after already reached

    mint(&env, &token, &token_admin, &owner, FIRST + SECOND + THIRD);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "holiday"), &TARGET);

    // Contribute below the target: not yet reached. `events().all()` scopes
    // to the most recent top-level invocation, so this call's log holds
    // exactly the token transfer + the contribution event (no reached event).
    client.goal_contribute(&owner, &goal_id, &FIRST);
    let events_after_first = env.events().all().len();

    let goal = client.goal(&goal_id);
    assert_eq!(goal.saved_amount, FIRST);
    assert!(
        goal.reached_at.is_none(),
        "goal must not be reached before the target is crossed"
    );
    assert_eq!(
        events_after_first, 2,
        "a below-target contribution emits a transfer and a contribution event, no reached event"
    );

    // Contribute across the target boundary: reached_at set, and this
    // call's event log additionally carries the reached event.
    client.goal_contribute(&owner, &goal_id, &SECOND);
    let events_after_second = env.events().all().len();

    let goal = client.goal(&goal_id);
    assert_eq!(goal.saved_amount, FIRST + SECOND);
    assert!(
        goal.reached_at.is_some(),
        "reached_at must be set once the target is crossed"
    );
    let reached_at_first = goal.reached_at;
    assert_eq!(
        events_after_second, 3,
        "crossing the target emits a transfer, contribution, and reached event"
    );

    // Contribute again after already reached: reached_at unchanged, and no
    // reached event shows up in this call's log.
    client.goal_contribute(&owner, &goal_id, &THIRD);
    let events_after_third = env.events().all().len();

    let goal = client.goal(&goal_id);
    assert_eq!(
        goal.reached_at, reached_at_first,
        "reached_at must be set only once"
    );
    assert_eq!(
        events_after_third, 2,
        "a post-target contribution does not re-emit the reached event"
    );
}

/// Claiming a reached goal transfers the full saved balance back to the
/// owner and closes the goal so it cannot be claimed a second time.
#[test]
fn goal_claim_after_reached_returns_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 100_000_000; // 100 USDC

    mint(&env, &token, &token_admin, &owner, TARGET);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "holiday"), &TARGET);
    client.goal_contribute(&owner, &goal_id, &TARGET);

    let goal = client.goal(&goal_id);
    assert!(
        goal.reached_at.is_some(),
        "goal must be reached before claim"
    );

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let owner_balance_before_claim = token_client.balance(&owner);

    client.goal_claim(&owner, &goal_id);

    let owner_balance_after_claim = token_client.balance(&owner);
    assert_eq!(
        owner_balance_after_claim - owner_balance_before_claim,
        TARGET,
        "claim must return the full saved amount to the owner"
    );

    // The goal is closed on claim; a second claim finds nothing to pay out.
    let result = client.try_goal_claim(&owner, &goal_id);
    assert_eq!(result, Err(Ok(Error::NotFound)));
}

/// An unreached goal cannot be claimed and remains intact.
#[test]
fn goal_claim_before_reached_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    const TARGET: i128 = 100_000_000;
    const SAVED: i128 = 40_000_000;

    mint(&env, &token, &token_admin, &owner, SAVED);
    let goal_id = client.goal_create(&owner, &String::from_str(&env, "holiday"), &TARGET);
    client.goal_contribute(&owner, &goal_id, &SAVED);

    let result = client.try_goal_claim(&owner, &goal_id);
    assert_eq!(result, Err(Ok(Error::GoalNotReached)));
    assert_eq!(client.goal(&goal_id).saved_amount, SAVED);
}

/// Issue #431 — goal auto-renewal.
///
/// With `auto_renew` enabled, claiming a reached goal pays the owner out but
/// keeps the goal alive: `saved_amount` resets to 0 and `reached_at` clears,
/// so the owner can save toward the same target again (and claim again).
#[test]
fn goal_auto_renew_restarts_on_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 100_000_000;
    mint(&env, &token, &token_admin, &owner, TARGET * 2);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "rainy day"), &TARGET);
    assert!(
        !client.goal(&goal_id).auto_renew,
        "goals must default to no auto-renewal"
    );

    // Opt in, contribute to the target, and claim.
    client.goal_set_auto_renew(&owner, &goal_id, &true);
    client.goal_contribute(&owner, &goal_id, &TARGET);
    assert!(client.goal(&goal_id).reached_at.is_some());

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let balance_before = token_client.balance(&owner);

    client.goal_claim(&owner, &goal_id);

    assert_eq!(
        token_client.balance(&owner) - balance_before,
        TARGET,
        "claim must still pay the full saved amount out"
    );

    let renewed = client.goal(&goal_id);
    assert_eq!(renewed.saved_amount, 0, "renewed goal restarts at zero");
    assert!(
        renewed.reached_at.is_none(),
        "renewed goal clears its reached milestone"
    );
    assert!(renewed.auto_renew, "renewal setting is retained");
    assert_eq!(renewed.target_amount, TARGET, "target is preserved");

    // The goal is live again: contribute to the target and claim a second
    // time, proving the restart is a full cycle rather than a one-off.
    client.goal_contribute(&owner, &goal_id, &TARGET);
    assert!(client.goal(&goal_id).reached_at.is_some());
    client.goal_claim(&owner, &goal_id);
    assert_eq!(client.goal(&goal_id).saved_amount, 0);
}

/// An auto-renewing goal can be claimed again, unlike a goal that opted out
/// (which is closed on claim — covered by `goal_claim_after_reached_returns_funds`).
#[test]
fn goal_auto_renew_can_be_disabled_again() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 100_000_000;
    mint(&env, &token, &token_admin, &owner, TARGET);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "rainy day"), &TARGET);
    client.goal_set_auto_renew(&owner, &goal_id, &true);
    client.goal_set_auto_renew(&owner, &goal_id, &false);
    client.goal_contribute(&owner, &goal_id, &TARGET);
    client.goal_claim(&owner, &goal_id);

    // Renewal was switched back off, so the goal closes on claim.
    assert_eq!(client.try_goal(&goal_id), Err(Ok(Error::NotFound)));
}

/// Only the goal's owner may toggle auto-renewal.
#[test]
fn goal_set_auto_renew_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "rainy day"), &1_000_000);

    let result = client.try_goal_set_auto_renew(&attacker, &goal_id, &true);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert!(!client.goal(&goal_id).auto_renew);
}

/// Closing a group, assigning shares, and settling pays each member their
/// bps-weighted portion of the pooled contributions and fully drains the
/// group balance. Shares (34%/33%/33%) don't divide the pool evenly, so this
/// also exercises the rule that the creator (first member) absorbs the
/// rounding remainder.
#[test]
fn group_split_settles_by_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    const CREATOR_CONTRIB: i128 = 50_000_000;
    const MEMBER_B_CONTRIB: i128 = 30_000_000;
    const MEMBER_C_CONTRIB: i128 = 20_000_000;
    const TOTAL: i128 = CREATOR_CONTRIB + MEMBER_B_CONTRIB + MEMBER_C_CONTRIB;

    mint(&env, &token, &token_admin, &creator, CREATOR_CONTRIB);
    mint(&env, &token, &token_admin, &member_b, MEMBER_B_CONTRIB);
    mint(&env, &token, &token_admin, &member_c, MEMBER_C_CONTRIB);

    let group_id = client.group_create(&creator, &String::from_str(&env, "split-pool"));
    client.group_join(&member_b, &group_id);
    client.group_join(&member_c, &group_id);

    client.group_contribute(&creator, &group_id, &CREATOR_CONTRIB);
    client.group_contribute(&member_b, &group_id, &MEMBER_B_CONTRIB);
    client.group_contribute(&member_c, &group_id, &MEMBER_C_CONTRIB);

    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 3_334u32); // 33.34%
    shares.set(member_b.clone(), 3_333u32); // 33.33%
    shares.set(member_c.clone(), 3_333u32); // 33.33%
    client.group_set_shares(&creator, &group_id, &shares);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let creator_before = token_client.balance(&creator);
    let member_b_before = token_client.balance(&member_b);
    let member_c_before = token_client.balance(&member_c);

    client.group_settle(&creator, &group_id);

    let creator_after = token_client.balance(&creator);
    let member_b_after = token_client.balance(&member_b);
    let member_c_after = token_client.balance(&member_c);

    let member_b_payout = TOTAL * 3_333 / group_split::TOTAL_BPS as i128;
    let member_c_payout = TOTAL * 3_333 / group_split::TOTAL_BPS as i128;
    let creator_floor_payout = TOTAL * 3_334 / group_split::TOTAL_BPS as i128;
    let remainder = TOTAL - creator_floor_payout - member_b_payout - member_c_payout;

    assert_eq!(
        member_b_after - member_b_before,
        member_b_payout,
        "member B must receive their bps-weighted share"
    );
    assert_eq!(
        member_c_after - member_c_before,
        member_c_payout,
        "member C must receive their bps-weighted share"
    );
    assert_eq!(
        creator_after - creator_before,
        creator_floor_payout + remainder,
        "creator (first member) must receive their share plus the rounding remainder"
    );

    let payouts_sum = (creator_after - creator_before)
        + (member_b_after - member_b_before)
        + (member_c_after - member_c_before);
    assert_eq!(
        payouts_sum, TOTAL,
        "payouts must exactly account for the whole pool"
    );

    let group = client.group(&group_id);
    assert_eq!(group.balance, 0, "pool must be fully drained after settle");
}

// ---------------------------------------------------------------------------
// Issue #40 — InsufficientBalance rejection
// ---------------------------------------------------------------------------

/// Flexible over-withdrawal: depositing 100 then requesting 101 must return
/// `Error::InsufficientBalance` and leave the on-chain balance unchanged.
#[test]
fn flexible_withdraw_over_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const DEPOSIT: i128 = 100_000_000; // 100 USDC (7 decimals)
    const OVER_AMOUNT: i128 = DEPOSIT + 1;

    // Fund the user's wallet so the token transfer_in can succeed.
    mint(&env, &token, &token_admin, &user, DEPOSIT);

    // Deposit the full amount.
    client.deposit(&user, &DEPOSIT);

    // Attempting to withdraw one stroop more than the balance must fail.
    let result = client.try_withdraw(&user, &OVER_AMOUNT);
    assert_eq!(
        result,
        Err(Ok(Error::InsufficientBalance)),
        "expected InsufficientBalance when withdrawing {} from a balance of {}",
        OVER_AMOUNT,
        DEPOSIT,
    );

    // Balance must remain intact after the failed withdrawal.
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, DEPOSIT,
        "balance must not change after a rejected over-withdrawal",
    );
}

/// Flexible exact-balance withdrawal must succeed (boundary condition).
///
/// This is the complement of the rejection test: withdrawing exactly the
/// deposited amount must NOT return `InsufficientBalance`.
#[test]
fn flexible_withdraw_exact_balance_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const DEPOSIT: i128 = 50_000_000; // 50 USDC

    mint(&env, &token, &token_admin, &user, DEPOSIT);
    client.deposit(&user, &DEPOSIT);

    // Withdraw the exact amount — must not error.
    client.withdraw(&user, &DEPOSIT);

    // Balance must now be zero.
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, 0,
        "balance must be zero after a full withdrawal",
    );
}

/// Flexible deposit/withdraw round-trip (issue #34).
///
/// Funds a user via the mock token, deposits, partially withdraws, asserts
/// the balance at each step, then confirms an over-withdrawal against the
/// remaining balance is rejected and leaves that balance untouched. The
/// existing `flexible_withdraw_over_balance_rejected` /
/// `flexible_withdraw_exact_balance_succeeds` tests each isolate a single
/// step; this test exercises the full sequence in one flow, including the
/// partial-withdrawal-then-over-withdraw case neither of those cover.
#[test]
fn flexible_deposit_withdraw_round_trip() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const DEPOSIT: i128 = 100_000_000; // 100 USDC
    const PARTIAL_WITHDRAW: i128 = 40_000_000; // 40 USDC
    const REMAINING: i128 = DEPOSIT - PARTIAL_WITHDRAW; // 60 USDC

    // Fund the user's wallet so deposit's token transfer_in can succeed.
    mint(&env, &token, &token_admin, &user, DEPOSIT);

    // Deposit the full amount; balance must reflect exactly what was deposited.
    client.deposit(&user, &DEPOSIT);
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, DEPOSIT,
        "balance must equal the deposited amount",
    );

    // Partially withdraw; balance must reflect exactly what remains.
    client.withdraw(&user, &PARTIAL_WITHDRAW);
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, REMAINING,
        "balance must be deposit minus the partial withdrawal",
    );

    // Attempting to withdraw more than the remaining balance must be
    // rejected, and must not change the balance.
    let result = client.try_withdraw(&user, &(REMAINING + 1));
    assert_eq!(
        result,
        Err(Ok(Error::InsufficientBalance)),
        "expected InsufficientBalance when withdrawing {} from a remaining balance of {}",
        REMAINING + 1,
        REMAINING,
    );
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, REMAINING,
        "balance must be unchanged after a rejected over-withdrawal",
    );

    // Withdraw exactly what remains; balance must be zero.
    client.withdraw(&user, &REMAINING);
    let account = client.get_account(&user);
    assert_eq!(
        account.balance, 0,
        "balance must be zero after withdrawing the full remaining amount",
    );
}

/// Locked over-withdrawal: once past the unlock time, attempting to withdraw
/// more than the locked plan balance must return `Error::InsufficientBalance`.
#[test]
fn locked_withdraw_over_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 200_000_000; // 200 USDC
    const OVER_AMOUNT: i128 = LOCKED_AMOUNT + 1;

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    // Set the ledger timestamp to a known value so we can control time.
    let now: u64 = 1_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 1_000; // one second from now

    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    // Advance time past the lock.
    env.ledger().set(LedgerInfo {
        timestamp: unlock_at + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    // Lock is open; but amount exceeds balance — must fail with InsufficientBalance.
    let result = client.try_locked_withdraw(&owner, &plan_id, &OVER_AMOUNT);
    assert_eq!(
        result,
        Err(Ok(Error::InsufficientBalance)),
        "expected InsufficientBalance when withdrawing {} from locked plan with balance {}",
        OVER_AMOUNT,
        LOCKED_AMOUNT,
    );

    // Plan balance must be untouched.
    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, LOCKED_AMOUNT,
        "locked plan balance must not change after a rejected over-withdrawal",
    );
}

/// Locked exact-balance withdrawal must succeed once the lock has expired
/// (boundary condition paired with the rejection test above).
#[test]
fn locked_withdraw_exact_balance_after_unlock_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 75_000_000; // 75 USDC

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 2_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 500;
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    // Advance past the lock.
    env.ledger().set(LedgerInfo {
        timestamp: unlock_at + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    // Withdraw the exact amount — must not error.
    client.locked_withdraw(&owner, &plan_id, &LOCKED_AMOUNT);

    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, 0,
        "locked plan balance must be zero after a full withdrawal",
    );
}

/// Locked withdrawal before the unlock time must be rejected with
/// `Error::StillLocked`, even when the requested amount is well within the
/// plan's balance — isolates the time-lock guard from the balance guard
/// (paired with `locked_withdraw_over_balance_rejected` above, which
/// isolates the balance guard from the time-lock guard).
#[test]
fn locked_withdraw_before_unlock_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 50_000_000; // 50 USDC

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 1_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 1_000;
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    // Still before unlock_at — withdrawing well within balance must still
    // fail with StillLocked, not succeed and not fail with a balance error.
    let result = client.try_locked_withdraw(&owner, &plan_id, &(LOCKED_AMOUNT / 2));
    assert_eq!(
        result,
        Err(Ok(Error::StillLocked)),
        "expected StillLocked when withdrawing before unlock_at with sufficient balance",
    );

    // Plan balance must be untouched.
    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, LOCKED_AMOUNT,
        "locked plan balance must not change after a rejected pre-unlock withdrawal",
    );
}

/// Locked plan time-lock enforcement round-trip (issue #35).
///
/// Creates a locked plan, attempts an early withdrawal (expects
/// `StillLocked`), advances the ledger past `unlock_at`, then withdraws
/// successfully — asserting the plan balance at each step. The existing
/// `locked_withdraw_before_unlock_rejected` and
/// `locked_withdraw_exact_balance_after_unlock_succeeds` tests each isolate
/// one half of this; this test exercises the full create → reject → advance
/// → withdraw sequence in one flow, matching the issue's exact scenario.
#[test]
fn locked_plan_enforces_unlock_time_round_trip() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 80_000_000; // 80 USDC

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 5_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 1_000;
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    // Plan balance right after creation must equal the locked amount.
    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, LOCKED_AMOUNT,
        "locked plan balance must equal the amount locked at creation",
    );

    // Attempt an early withdrawal — must be rejected with StillLocked, and
    // must not move the balance.
    let early_result = client.try_locked_withdraw(&owner, &plan_id, &LOCKED_AMOUNT);
    assert_eq!(
        early_result,
        Err(Ok(Error::StillLocked)),
        "expected StillLocked when withdrawing before unlock_at",
    );
    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, LOCKED_AMOUNT,
        "locked plan balance must be unchanged after a rejected early withdrawal",
    );

    // Advance the ledger past unlock_at.
    env.ledger().set(LedgerInfo {
        timestamp: unlock_at + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    // Now the withdrawal must succeed, and the plan balance must be zero.
    client.locked_withdraw(&owner, &plan_id, &LOCKED_AMOUNT);
    let plan = client.locked_plan(&plan_id);
    assert_eq!(
        plan.balance, 0,
        "locked plan balance must be zero after a full post-unlock withdrawal",
    );
}

/// Issue #432 — early partial withdrawal from a locked plan.
///
/// With a penalty configured and the minimum lock period elapsed, the owner
/// can withdraw part of a still-locked balance early: the penalty is paid to
/// the configured recipient, the remainder to the owner, and the plan keeps
/// the reduced balance (it is not closed).
#[test]
fn locked_early_withdraw_charges_penalty_and_reduces_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000; // 100 USDC
    const WITHDRAW: i128 = 40_000_000; // 40 USDC
    const PENALTY_BPS: u32 = 500; // 5%
    const PENALTY: i128 = WITHDRAW * PENALTY_BPS as i128 / 10_000; // 2 USDC
    const NET: i128 = WITHDRAW - PENALTY; // 38 USDC

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    // Configure a 5% penalty routed to a third-party recipient.
    client.set_early_withdraw_penalty_bps(&PENALTY_BPS);
    client.set_penalty_recipient(&recipient);
    assert_eq!(client.early_withdraw_penalty_bps(), PENALTY_BPS);
    assert_eq!(client.penalty_recipient(), recipient);

    let now: u64 = 1_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &(now + 10_000));

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let owner_before = token_client.balance(&owner);

    client.locked_early_withdraw(&owner, &plan_id, &WITHDRAW);

    assert_eq!(
        token_client.balance(&owner) - owner_before,
        NET,
        "owner must receive the withdrawn amount minus the penalty",
    );
    assert_eq!(
        token_client.balance(&recipient),
        PENALTY,
        "penalty must be paid to the configured recipient",
    );
    assert_eq!(
        client.locked_plan(&plan_id).balance,
        LOCKED_AMOUNT - WITHDRAW,
        "plan must keep the un-withdrawn remainder",
    );
}

/// Early withdrawal must be rejected until the plan has been locked for at
/// least the configured minimum period.
#[test]
fn locked_early_withdraw_before_min_lock_period_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000;
    const MIN_LOCK_PERIOD: u64 = 5_000;

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);
    client.set_min_lock_period(&MIN_LOCK_PERIOD);
    assert_eq!(client.min_lock_period(), MIN_LOCK_PERIOD);

    let now: u64 = 1_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &(now + 10_000));

    // Still inside the minimum lock period: window not open yet.
    set_ledger_time(&env, now + MIN_LOCK_PERIOD - 1, 101);
    let result = client.try_locked_early_withdraw(&owner, &plan_id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::TimeWindowNotOpen)));
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT);

    // Once the minimum period has elapsed (and before unlock), it succeeds.
    set_ledger_time(&env, now + MIN_LOCK_PERIOD, 102);
    client.locked_early_withdraw(&owner, &plan_id, &1_000_000);
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT - 1_000_000);
}

/// Once `unlock_at` has passed, the penalized early path is closed; the
/// penalty-free `locked_withdraw` applies instead.
#[test]
fn locked_early_withdraw_after_unlock_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000;

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 2_000_000;
    set_ledger_time(&env, now, 100);
    let unlock_at = now + 10_000;
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    set_ledger_time(&env, unlock_at, 101);
    let result = client.try_locked_early_withdraw(&owner, &plan_id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::OperationExpired)));
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT);
}

/// An early withdrawal larger than the plan balance is rejected with
/// `InsufficientBalance` and moves no funds.
#[test]
fn locked_early_withdraw_over_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000;

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 3_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &(now + 10_000));

    let result = client.try_locked_early_withdraw(&owner, &plan_id, &(LOCKED_AMOUNT + 1));
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT);
}

/// Only the plan's owner may withdraw early.
#[test]
fn locked_early_withdraw_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000;

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 4_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &(now + 10_000));

    let result = client.try_locked_early_withdraw(&attacker, &plan_id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT);
}

/// With the default (unset) penalty, early withdrawal is penalty-free: the
/// owner receives the full amount and no recipient transfer occurs.
#[test]
fn locked_early_withdraw_defaults_to_no_penalty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 100_000_000;
    const WITHDRAW: i128 = 30_000_000;

    assert_eq!(client.early_withdraw_penalty_bps(), 0);
    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 5_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &(now + 10_000));

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let owner_before = token_client.balance(&owner);

    client.locked_early_withdraw(&owner, &plan_id, &WITHDRAW);

    assert_eq!(
        token_client.balance(&owner) - owner_before,
        WITHDRAW,
        "with no penalty configured the owner receives the full amount",
    );
    assert_eq!(client.locked_plan(&plan_id).balance, LOCKED_AMOUNT - WITHDRAW);
}

/// The configured penalty rate is capped at 100% (10_000 bps).
#[test]
fn set_early_withdraw_penalty_bps_above_max_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);

    let too_high: u32 = 10_001;
    let result = client.try_set_early_withdraw_penalty_bps(&too_high);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
    assert_eq!(client.early_withdraw_penalty_bps(), 0);

    client.set_early_withdraw_penalty_bps(&10_000);
    assert_eq!(client.early_withdraw_penalty_bps(), 10_000);
}

/// Locked plan: `InsufficientBalance` takes priority over `StillLocked`.
///
/// If both conditions apply (still locked AND amount exceeds balance), the
/// contract may return either error — but must not panic or transfer funds.
/// This test documents the desired precedence: implementations SHOULD check
/// the balance guard first so callers get the most actionable error.
#[test]
#[ignore = "TODO(issue #40): confirm error precedence for locked::withdraw"]
fn locked_withdraw_still_locked_and_over_balance_prefers_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const LOCKED_AMOUNT: i128 = 10_000_000; // 10 USDC

    mint(&env, &token, &token_admin, &owner, LOCKED_AMOUNT);

    let now: u64 = 3_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 10_000; // still in the future
    let plan_id = client.locked_create(&owner, &LOCKED_AMOUNT, &unlock_at);

    // Attempt to withdraw more than the balance while the lock is still active.
    let result = client.try_locked_withdraw(&owner, &plan_id, &(LOCKED_AMOUNT + 1));

    // Must be one of the two valid errors; must not succeed.
    assert!(
        result == Err(Ok(Error::InsufficientBalance)) || result == Err(Ok(Error::StillLocked)),
        "expected InsufficientBalance or StillLocked, got {:?}",
        result,
    );

    // Either way, funds must not move.
    let plan = client.locked_plan(&plan_id);
    assert_eq!(plan.balance, LOCKED_AMOUNT);
}

// ---------------------------------------------------------------------------
// Issue #39 — Unauthorized access rejected
//
// Auth model recap
// ----------------
// Every state-mutating entrypoint calls `principal.require_auth()` inside the
// contract. In the Soroban test environment this means:
//
//  • `env.mock_all_auths()` — approves every auth check; used by happy-path tests.
//  • `env.mock_auths(&[...])` — approves only the listed (contract, fn, args)
//    tuples; any un-listed auth check causes the host to abort the invocation.
//
// Two distinct failure modes exist:
//
//  1. **Wrong signer / no auth provided** — the `require_auth()` call on the
//     legitimate principal is absent from the mock list, so the host panics
//     and `try_*` returns `Err(Err(_))`.
//
//  2. **Wrong principal reaches an ownership check** — auth was provided for
//     attacker, but the contract checks `plan.owner == caller` (or equivalent)
//     and returns `Error::Unauthorized`.
//
// These tests cover case 2 (the most expressive from a contract-logic standpoint):
// the attacker has valid auth for *themselves*, but the contract enforces that
// only the resource owner / admin may act.  The helper `mock_auths_for` below
// approves auth for exactly one address so the contract reaches the ownership
// guard.
// ---------------------------------------------------------------------------

// --- Admin-only: set_admin --------------------------------------------------

/// A random address must not be able to rotate the admin.
///
/// `set_admin` must require auth from the *current* admin. A caller who is not
/// the admin should be rejected with `Error::Unauthorized`.
#[test]
fn set_admin_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let attacker = Address::generate(&env);

    // Attacker provides valid auth for themselves — but they are not the admin.
    let result = client.try_set_admin(&attacker);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "non-admin must not be able to rotate the admin address",
    );
}

// --- Owner-only: flexible::withdraw ----------------------------------------

/// Only the account owner may withdraw from their flexible account.
///
/// A third party who provides valid auth for *themselves* must be rejected
/// even if they know the victim's address.
#[test]
#[ignore = "TODO(issue #39): implement flexible::withdraw owner check"]
fn flexible_withdraw_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const DEPOSIT: i128 = 100_000_000; // 100 USDC

    mint(&env, &token, &token_admin, &owner, DEPOSIT);
    client.deposit(&owner, &DEPOSIT);

    // Switch: only attacker's auth is approved from here on.
    // The contract must compare attacker != owner and return Unauthorized.
    env.mock_all_auths(); // reset, then re-mock as attacker-only
    let result = client.try_withdraw(&attacker, &DEPOSIT);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not withdraw from another user's flexible account",
    );

    // Owner's balance must be untouched.
    env.mock_all_auths();
    let account = client.get_account(&owner);
    assert_eq!(account.balance, DEPOSIT);
}

// --- Owner-only: locked::top_up --------------------------------------------

/// Only the plan owner may top-up a locked plan.
#[test]
fn locked_top_up_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const AMOUNT: i128 = 50_000_000; // 50 USDC

    // Mint enough for both the initial create and the attempted top-up.
    mint(&env, &token, &token_admin, &owner, AMOUNT);
    mint(&env, &token, &token_admin, &attacker, AMOUNT);

    let now: u64 = 1_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let plan_id = client.locked_create(&owner, &AMOUNT, &(now + 1_000));

    // Attacker attempts to top-up the owner's plan.
    let result = client.try_locked_top_up(&attacker, &plan_id, &AMOUNT);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not top-up another user's locked plan",
    );

    // Plan balance must not change.
    let plan = client.locked_plan(&plan_id);
    assert_eq!(plan.balance, AMOUNT);
}

// --- Owner-only: locked::withdraw ------------------------------------------

/// Only the plan owner may withdraw from a locked plan, even after it unlocks.
#[test]
#[ignore = "TODO(issue #39): implement locked::withdraw owner check"]
fn locked_withdraw_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const AMOUNT: i128 = 80_000_000; // 80 USDC

    mint(&env, &token, &token_admin, &owner, AMOUNT);

    let now: u64 = 2_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    let unlock_at = now + 500;
    let plan_id = client.locked_create(&owner, &AMOUNT, &unlock_at);

    // Advance past the lock so `StillLocked` is not a confound.
    env.ledger().set(LedgerInfo {
        timestamp: unlock_at + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 3_110_400,
    });

    // Attacker attempts to drain the now-unlocked plan.
    let result = client.try_locked_withdraw(&attacker, &plan_id, &AMOUNT);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not withdraw from another user's locked plan after unlock",
    );

    let plan = client.locked_plan(&plan_id);
    assert_eq!(plan.balance, AMOUNT);
}

// --- Owner-only: goal::claim -----------------------------------------------

/// Only the goal owner may claim the funds once the target is reached.
#[test]
#[ignore = "TODO(issue #39): implement goal::claim owner check"]
fn goal_claim_by_non_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const TARGET: i128 = 100_000_000; // 100 USDC

    mint(&env, &token, &token_admin, &owner, TARGET);

    let goal_id = client.goal_create(
        &owner,
        &soroban_sdk::String::from_str(&env, "holiday"),
        &TARGET,
    );

    // Owner contributes the full target so the goal is reached.
    client.goal_contribute(&owner, &goal_id, &TARGET);

    // Attacker tries to claim a goal they don't own.
    let result = client.try_goal_claim(&attacker, &goal_id);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not claim another user's completed goal",
    );

    // Goal's saved amount must be intact.
    let goal = client.goal(&goal_id);
    assert_eq!(goal.saved_amount, TARGET);
}

// --- Creator-only: group::close --------------------------------------------

/// Only the group creator may close a group to new members.
#[test]
#[ignore = "TODO(issue #39): implement group::close creator check"]
fn group_close_by_non_creator_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);

    let group_id = client.group_create(&creator, &soroban_sdk::String::from_str(&env, "pool-a"));

    // Non-creator attempts to close the group.
    let result = client.try_group_close(&non_creator, &group_id);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "non-creator must not be able to close a group",
    );

    // Group must still be open.
    let group = client.group(&group_id);
    assert!(
        group.open,
        "group must remain open after rejected close attempt"
    );
}

// --- Creator-only: group::set_shares ---------------------------------------

/// Only the group creator may configure the member share splits.
#[test]
#[ignore = "TODO(issue #39): implement group_split::set_shares creator check"]
fn group_set_shares_by_non_creator_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let member = Address::generate(&env);
    let non_creator = Address::generate(&env);

    let group_id = client.group_create(&creator, &soroban_sdk::String::from_str(&env, "pool-b"));

    // Add a second member so a valid 10 000-bps split can be constructed.
    client.group_join(&member, &group_id);
    client.group_close(&creator, &group_id);

    // Build a valid shares map that sums to 10_000 bps.
    let mut shares = soroban_sdk::Map::new(&env);
    shares.set(creator.clone(), 5_000u32);
    shares.set(member.clone(), 5_000u32);

    // Non-creator attempts to set shares.
    let result = client.try_group_set_shares(&non_creator, &group_id, &shares);

    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "non-creator must not be able to set group shares",
    );
}

// --- Member-only: group::contribute ----------------------------------------

/// A non-member cannot contribute to a group pool.
#[test]
#[ignore = "TODO(issue #39): implement group::contribute membership check"]
fn group_contribute_by_non_member_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outsider = Address::generate(&env);

    const AMOUNT: i128 = 20_000_000; // 20 USDC
    mint(&env, &token, &token_admin, &outsider, AMOUNT);

    let group_id = client.group_create(&creator, &soroban_sdk::String::from_str(&env, "pool-c"));

    // Outsider has never called group_join; must be rejected.
    let result = client.try_group_contribute(&outsider, &group_id, &AMOUNT);

    assert_eq!(
        result,
        Err(Ok(Error::NotAMember)),
        "non-member must not contribute to a group pool",
    );

    // Pool balance must remain zero.
    let group = client.group(&group_id);
    assert_eq!(group.balance, 0);
}

// --- Double-initialize guard -----------------------------------------------

/// Calling `initialize` a second time must return `Error::AlreadyInitialized`.
///
/// This is the admin-lifecycle equivalent of an auth check: only the first
/// caller (during deployment) should be able to set the admin and token.
#[test]
fn initialize_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);

    // Any address can try — the guard is idempotency, not identity.
    let second_admin = Address::generate(&env);
    let result = client.try_initialize(&second_admin, &token);

    assert_eq!(
        result,
        Err(Ok(Error::AlreadyInitialized)),
        "initialize must be callable exactly once",
    );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Issue #31 — Auth review: require_auth on all mutations
//
// Two ways an unauthorized call is rejected (see the case 1 / case 2 recap
// above the #39 tests):
//
//  1. No valid authorization exists for the principal at all — disabling
//     mocked auth (`env.set_auths(&[])`) or never enabling it means the
//     principal's `require_auth()` call inside the contract has nothing to
//     match, so the host rejects the invocation and `try_*` returns
//     `Err(Err(_))`.
//  2. The principal *did* authorize (any signer can under `mock_all_auths`),
//     but the contract compares the claimed identity against a stored
//     owner/creator field and returns a typed `Error::Unauthorized`.
//
// These tests cover every state-changing entrypoint touched by this issue in
// flexible.rs, locked.rs, and group.rs.
// ---------------------------------------------------------------------------

/// `deposit` must require `from`'s authorization — funding isn't needed
/// since the auth check happens before anything else.
#[test]
fn deposit_without_signer_auth_rejected() {
    let env = Env::default();
    let (client, _admin, _token) = setup_with_token(&env);
    let user = Address::generate(&env);

    let result = client.try_deposit(&user, &10_000_000i128);

    assert!(
        result.is_err(),
        "deposit must fail without `from`'s authorization"
    );
}

/// `withdraw` must require `owner`'s authorization.
#[test]
fn withdraw_without_signer_auth_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const AMOUNT: i128 = 20_000_000;
    mint(&env, &token, &token_admin, &owner, AMOUNT);
    client.deposit(&owner, &AMOUNT);

    // Disable mocking: no more auths are considered valid from here on.
    env.set_auths(&[]);

    let result = client.try_withdraw(&owner, &AMOUNT);
    assert!(
        result.is_err(),
        "withdraw must fail without `owner`'s authorization"
    );
}

/// `locked_create` must require `owner`'s authorization.
#[test]
fn locked_create_without_signer_auth_rejected() {
    let env = Env::default();
    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);

    let result = client.try_locked_create(&owner, &10_000_000i128, &1_000u64);

    assert!(
        result.is_err(),
        "locked_create must fail without `owner`'s authorization"
    );
}

/// `locked_top_up` must reject a caller who is not the plan's owner, even
/// though they validly authorized *themselves* (case 2).
#[test]
fn locked_top_up_by_non_owner_rejected_issue31() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const AMOUNT: i128 = 30_000_000;
    mint(&env, &token, &token_admin, &owner, AMOUNT);
    mint(&env, &token, &token_admin, &attacker, AMOUNT);

    let plan_id = client.locked_create(&owner, &AMOUNT, &1_000_000u64);

    let result = client.try_locked_top_up(&attacker, &plan_id, &AMOUNT);
    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not top-up another user's locked plan",
    );

    let plan = client.locked_plan(&plan_id);
    assert_eq!(plan.balance, AMOUNT, "plan balance must be untouched");
}

/// `locked_withdraw` must reject a caller who is not the plan's owner.
#[test]
fn locked_withdraw_by_non_owner_rejected_issue31() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    const AMOUNT: i128 = 40_000_000;
    mint(&env, &token, &token_admin, &owner, AMOUNT);

    // `min_persistent_entry_ttl` set well above the sequence-number jump
    // below (100 -> 200) so the `LockedPlan` entry is not archived before
    // the withdrawal attempt — this test is about the ownership check, not
    // persistent-entry TTL behavior.
    let now: u64 = 1_000_000;
    env.ledger().set(LedgerInfo {
        timestamp: now,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 3_110_400,
        max_entry_ttl: 3_110_400,
    });
    let unlock_at = now + 500;
    let plan_id = client.locked_create(&owner, &AMOUNT, &unlock_at);

    env.ledger().set(LedgerInfo {
        timestamp: unlock_at + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 3_110_400,
        max_entry_ttl: 3_110_400,
    });

    let result = client.try_locked_withdraw(&attacker, &plan_id, &AMOUNT);
    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "attacker must not withdraw from another user's locked plan",
    );

    let plan = client.locked_plan(&plan_id);
    assert_eq!(plan.balance, AMOUNT, "plan balance must be untouched");
}

/// `group_payout_equal` was missing `require_auth` on `caller` entirely —
/// anyone could relay the call unauthenticated. It is intentionally
/// permissionless (payouts go to members, not to `caller`), but every
/// invocation must still be attributable to a real signer.
#[test]
fn group_payout_equal_without_signer_auth_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);

    const AMOUNT: i128 = 10_000_000;
    mint(&env, &token, &token_admin, &creator, AMOUNT);

    let group_id = client.group_create(&creator, &String::from_str(&env, "payout-auth"));
    client.group_contribute(&creator, &group_id, &AMOUNT);
    client.group_close(&creator, &group_id);

    // Disable mocking: `caller.require_auth()` now has nothing to match.
    env.set_auths(&[]);

    let result = client.try_group_payout_equal(&creator, &group_id);
    assert!(
        result.is_err(),
        "group_payout_equal must fail without a signed caller",
    );
}

/// `set_admin` must require the *current* admin's authorization.
#[test]
fn set_admin_without_admin_auth_rejected() {
    let env = Env::default();
    let (client, _admin, _token) = setup_with_token(&env);
    let new_admin = Address::generate(&env);

    let result = client.try_set_admin(&new_admin);

    assert!(
        result.is_err(),
        "set_admin must fail without the current admin's authorization"
    );
}

/// `set_deposit_cap` must require the current admin's authorization.
#[test]
fn set_deposit_cap_without_admin_auth_rejected() {
    let env = Env::default();
    let (client, _admin, _token) = setup_with_token(&env);

    let result = client.try_set_deposit_cap(&100_000_000i128);

    assert!(
        result.is_err(),
        "set_deposit_cap must fail without the admin's authorization"
    );
}

// ---------------------------------------------------------------------------
// Issue #32 — Overflow-safe i128 arithmetic audit
// ---------------------------------------------------------------------------

/// Depositing into an account already at `i128::MAX` must return a typed
/// `Overflow` error instead of panicking or wrapping, and must leave the
/// balance untouched.
#[test]
fn deposit_overflow_rejected_with_typed_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    mint(&env, &token, &token_admin, &user, i128::MAX);
    client.deposit(&user, &i128::MAX);

    mint(&env, &token, &token_admin, &user, 1);
    let result = client.try_deposit(&user, &1);

    assert_eq!(
        result,
        Err(Ok(Error::Overflow)),
        "depositing past i128::MAX must return a typed Overflow error",
    );

    let account = client.get_account(&user);
    assert_eq!(
        account.balance,
        i128::MAX,
        "balance must be unchanged after a rejected overflowing deposit",
    );
}

/// `group_split::settle` must reject a per-member share computation that
/// would overflow `i128` with a typed error, rather than panicking, and
/// must leave the pool balance untouched (settlement did not proceed).
#[test]
fn group_split_settle_overflow_rejected_with_typed_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member = Address::generate(&env);

    // Large enough that `balance * 5_000` overflows i128.
    const HALF: i128 = i128::MAX / 2;

    mint(&env, &token, &token_admin, &creator, HALF);
    mint(&env, &token, &token_admin, &member, HALF);

    let group_id = client.group_create(&creator, &String::from_str(&env, "overflow-pool"));
    client.group_join(&member, &group_id);
    client.group_contribute(&creator, &group_id, &HALF);
    client.group_contribute(&member, &group_id, &HALF);
    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 5_000u32);
    shares.set(member.clone(), 5_000u32);
    client.group_set_shares(&creator, &group_id, &shares);

    let result = client.try_group_settle(&creator, &group_id);
    assert_eq!(
        result,
        Err(Ok(Error::Overflow)),
        "settling a pool whose balance*bps overflows i128 must return a typed error",
    );

    let group = client.group(&group_id);
    assert_eq!(
        group.balance,
        HALF + HALF,
        "pool must be untouched after a rejected overflowing settle",
    );
}

// ---------------------------------------------------------------------------
// Issue #48 — Per-account deposit cap policy
// ---------------------------------------------------------------------------

/// With no cap ever configured (defaults to `0`), deposits of any size
/// succeed.
#[test]
fn deposit_cap_defaults_to_unlimited() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const LARGE: i128 = 1_000_000_000_000;
    mint(&env, &token, &token_admin, &user, LARGE);
    client.deposit(&user, &LARGE);

    let account = client.get_account(&user);
    assert_eq!(account.balance, LARGE);
}

/// A deposit that lands exactly on the configured cap succeeds.
#[test]
fn deposit_at_cap_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const CAP: i128 = 100_000_000;
    client.set_deposit_cap(&CAP);

    mint(&env, &token, &token_admin, &user, CAP);
    client.deposit(&user, &CAP);

    let account = client.get_account(&user);
    assert_eq!(account.balance, CAP);
}

/// A deposit that would push the balance past the configured cap is
/// rejected, and the balance is left unchanged.
#[test]
fn deposit_beyond_cap_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const CAP: i128 = 100_000_000;
    client.set_deposit_cap(&CAP);

    mint(&env, &token, &token_admin, &user, CAP + 1);
    client.deposit(&user, &CAP);

    let result = client.try_deposit(&user, &1);
    assert_eq!(
        result,
        Err(Ok(Error::DepositCapExceeded)),
        "deposit pushing balance past the cap must be rejected",
    );

    let account = client.get_account(&user);
    assert_eq!(
        account.balance, CAP,
        "balance must not change on a rejected deposit"
    );
}

/// Raising the cap takes effect immediately: a deposit that was rejected
/// under the old (lower) cap succeeds once the admin raises it, without
/// needing to re-deploy or wait.
#[test]
fn deposit_cap_change_takes_effect_immediately() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const CAP_LOW: i128 = 10_000_000;
    const CAP_HIGH: i128 = 50_000_000;
    const AMOUNT: i128 = CAP_LOW + 1;

    client.set_deposit_cap(&CAP_LOW);
    mint(&env, &token, &token_admin, &user, AMOUNT);

    let result = client.try_deposit(&user, &AMOUNT);
    assert_eq!(result, Err(Ok(Error::DepositCapExceeded)));

    client.set_deposit_cap(&CAP_HIGH);

    client.deposit(&user, &AMOUNT);
    let account = client.get_account(&user);
    assert_eq!(account.balance, AMOUNT);
}

/// A negative cap is rejected as an invalid amount.
#[test]
fn set_deposit_cap_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);

    let result = client.try_set_deposit_cap(&-1i128);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// ---------------------------------------------------------------------------
// goal::get_goal
// ---------------------------------------------------------------------------

/// `goal()` returns the goal as created, and errors `NotFound` for an id
/// that was never created.
#[test]
fn get_goal_returns_created_goal_and_not_found_for_unknown_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 100_000_000;
    const CONTRIBUTION: i128 = 40_000_000;

    mint(&env, &token, &token_admin, &owner, CONTRIBUTION);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "holiday"), &TARGET);
    client.goal_contribute(&owner, &goal_id, &CONTRIBUTION);

    let goal = client.goal(&goal_id);
    assert_eq!(goal.id, goal_id);
    assert_eq!(goal.owner, owner);
    assert_eq!(goal.target_amount, TARGET);
    assert_eq!(goal.saved_amount, CONTRIBUTION);
    assert!(goal.reached_at.is_none());

    let result = client.try_goal(&(goal_id + 1));
    assert!(
        matches!(result, Err(Ok(Error::NotFound))),
        "expected Err(Ok(Error::NotFound)) for an unknown goal id"
    );
}

// ---------------------------------------------------------------------------
// group_split::set_shares
// ---------------------------------------------------------------------------

/// Shares whose bps values don't sum to `TOTAL_BPS` are rejected, and the
/// group's stored shares are left untouched.
#[test]
fn group_set_shares_rejects_invalid_sum() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);

    let group_id = client.group_create(&creator, &String::from_str(&env, "split-pool"));
    client.group_join(&member_b, &group_id);
    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 5_000u32);
    shares.set(member_b.clone(), 4_000u32); // 5_000 + 4_000 = 9_000 != TOTAL_BPS

    let result = client.try_group_set_shares(&creator, &group_id, &shares);
    assert_eq!(result, Err(Ok(Error::InvalidShares)));
}

/// A shares map naming an address that never joined the group is rejected,
/// even if the bps values would otherwise sum correctly.
#[test]
fn group_set_shares_rejects_non_member_key() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let outsider = Address::generate(&env);

    let group_id = client.group_create(&creator, &String::from_str(&env, "split-pool"));
    client.group_join(&member_b, &group_id);
    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 5_000u32);
    shares.set(outsider.clone(), 5_000u32); // outsider never joined

    let result = client.try_group_set_shares(&creator, &group_id, &shares);
    assert_eq!(result, Err(Ok(Error::InvalidShares)));
}

/// Valid shares that sum to exactly `TOTAL_BPS` and name only group members
/// are stored and emit a `group_shares_set` event.
#[test]
fn group_set_shares_stores_valid_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);

    let group_id = client.group_create(&creator, &String::from_str(&env, "split-pool"));
    client.group_join(&member_b, &group_id);
    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 6_000u32);
    shares.set(member_b.clone(), 4_000u32);

    client.group_set_shares(&creator, &group_id, &shares);
    let event_count = env.events().all().len();
    assert_eq!(
        event_count, 1,
        "set_shares emits exactly one group_shares_set event"
    );

    let group = client.group(&group_id);
    assert_eq!(group.shares_bps.get(creator.clone()), Some(6_000u32));
    assert_eq!(group.shares_bps.get(member_b.clone()), Some(4_000u32));
}

// ---------------------------------------------------------------------------
// flexible::deposit / flexible::withdraw events
// ---------------------------------------------------------------------------

/// `deposit` emits a `deposit` event with the (from, amount, new_balance,
/// timestamp) data tuple described in the events registry.
#[test]
fn deposit_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const AMOUNT: i128 = 25_000_000;

    mint(&env, &token, &token_admin, &user, AMOUNT);

    client.deposit(&user, &AMOUNT);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (TOPIC_DEPOSIT, user.clone()).into_val(&env);
    let decoded_data: (Address, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (user, AMOUNT, AMOUNT, now));
}

/// `withdraw` emits a `withdraw` event with the (owner, amount,
/// new_balance, timestamp) data tuple described in the events registry.
#[test]
fn withdraw_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let user = Address::generate(&env);

    const DEPOSIT_AMOUNT: i128 = 25_000_000;
    const WITHDRAW_AMOUNT: i128 = 10_000_000;

    mint(&env, &token, &token_admin, &user, DEPOSIT_AMOUNT);
    client.deposit(&user, &DEPOSIT_AMOUNT);

    client.withdraw(&user, &WITHDRAW_AMOUNT);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();
    let remaining_balance = DEPOSIT_AMOUNT - WITHDRAW_AMOUNT;

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (TOPIC_WITHDRAW, user.clone()).into_val(&env);
    let decoded_data: (Address, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(
        decoded_data,
        (user, WITHDRAW_AMOUNT, remaining_balance, now)
    );
}

// ---------------------------------------------------------------------------
// Issue #28 / #29 — typed event publishers: locked_created, goal_reached,
// group_created, group_split_settled.
//
// Each test asserts the exact topics and data tuple against the schema
// documented in `contracts/savings-vault/README.md` ("Event schema"), not
// just that *an* event was emitted — so a future accidental field
// reordering or omission fails the test instead of silently drifting from
// the documented (and indexer-relied-upon) shape.
// ---------------------------------------------------------------------------

/// `locked_create` emits a `locked_created` event with topics
/// `(locked_created, owner, id)` and data `(id, owner, amount, unlock_at,
/// timestamp)`.
#[test]
fn locked_create_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const AMOUNT: i128 = 20_000_000;
    let unlock_at = env.ledger().timestamp() + 1_000;

    mint(&env, &token, &token_admin, &owner, AMOUNT);

    let plan_id = client.locked_create(&owner, &AMOUNT, &unlock_at);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (crate::events::TOPIC_LOCKED_CREATED, owner.clone(), plan_id).into_val(&env);
    let decoded_data: (u64, Address, i128, u64, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (plan_id, owner, AMOUNT, unlock_at, now));
}

/// `locked_early_withdraw` emits a `locked_early_withdraw` event with topics
/// `(locked_early_withdraw, owner, id)` and data `(id, owner, amount,
/// penalty, new_balance, timestamp)`.
#[test]
fn locked_early_withdraw_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const AMOUNT: i128 = 50_000_000;
    const WITHDRAW: i128 = 20_000_000;
    const PENALTY_BPS: u32 = 500;
    const PENALTY: i128 = WITHDRAW * PENALTY_BPS as i128 / 10_000;

    mint(&env, &token, &token_admin, &owner, AMOUNT);
    client.set_early_withdraw_penalty_bps(&PENALTY_BPS);

    let now: u64 = 7_000_000;
    set_ledger_time(&env, now, 100);
    let plan_id = client.locked_create(&owner, &AMOUNT, &(now + 10_000));

    // Move to a time inside the early-withdrawal window, then withdraw.
    set_ledger_time(&env, now + 1, 101);
    let call_time = env.ledger().timestamp();
    client.locked_early_withdraw(&owner, &plan_id, &WITHDRAW);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_LOCKED_EARLY_WITHDRAW,
        owner.clone(),
        plan_id,
    )
        .into_val(&env);
    let decoded_data: (u64, Address, i128, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(
        decoded_data,
        (plan_id, owner, WITHDRAW, PENALTY, AMOUNT - WITHDRAW, call_time)
    );
}

/// `goal_contribute` that first crosses the target emits a `goal_reached`
/// event with topics `(goal_reached, owner, id)` and data `(id, owner,
/// saved_amount, target_amount, timestamp)`.
#[test]
fn goal_reached_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 10_000_000;
    const CONTRIBUTION: i128 = 10_000_000; // exactly meets the target

    mint(&env, &token, &token_admin, &owner, CONTRIBUTION);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "New laptop"), &TARGET);
    client.goal_contribute(&owner, &goal_id, &CONTRIBUTION);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    // goal_contribute publishes goal_contribution then, in the same call,
    // goal_reached — the reached event is the last one emitted.
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (crate::events::TOPIC_GOAL_REACHED, owner.clone(), goal_id).into_val(&env);
    let decoded_data: (u64, Address, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (goal_id, owner, CONTRIBUTION, TARGET, now));
}

/// `goal_set_auto_renew` emits a `goal_auto_renew_set` event with topics
/// `(goal_auto_renew_set, owner, id)` and data `(id, owner, auto_renew,
/// timestamp)`.
#[test]
fn goal_auto_renew_set_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "New laptop"), &10_000_000);
    client.goal_set_auto_renew(&owner, &goal_id, &true);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GOAL_AUTO_RENEW_SET,
        owner.clone(),
        goal_id,
    )
        .into_val(&env);
    let decoded_data: (u64, Address, bool, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (goal_id, owner, true, now));
}

/// Claiming an auto-renewing goal emits a `goal_renewed` event with topics
/// `(goal_renewed, owner, id)` and data `(id, owner, target_amount,
/// timestamp)`, after the `goal_claimed` event in the same call.
#[test]
fn goal_claim_auto_renew_emits_goal_renewed_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);

    const TARGET: i128 = 10_000_000;
    mint(&env, &token, &token_admin, &owner, TARGET);

    let goal_id = client.goal_create(&owner, &String::from_str(&env, "New laptop"), &TARGET);
    client.goal_set_auto_renew(&owner, &goal_id, &true);
    client.goal_contribute(&owner, &goal_id, &TARGET);

    client.goal_claim(&owner, &goal_id);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    // goal_claim publishes goal_claimed then goal_renewed — renewed is last.
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (crate::events::TOPIC_GOAL_RENEWED, owner.clone(), goal_id).into_val(&env);
    let decoded_data: (u64, Address, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (goal_id, owner, TARGET, now));
}

/// `group_create` emits a `group_created` event with topics
/// `(group_created, creator, id)` and data `(id, creator, name,
/// timestamp)`.
#[test]
fn group_create_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let name = String::from_str(&env, "Vacation fund");

    let group_id = client.group_create(&creator, &name);

    let now = env.ledger().timestamp();
    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_CREATED,
        creator.clone(),
        group_id,
    )
        .into_val(&env);
    let decoded_data: (u64, Address, String, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (group_id, creator, name, now));
}

/// `group_settle` emits one `group_split_settled` event per member with
/// topics `(group_split_settled, member, id)` and data `(id, member,
/// amount, timestamp)`.
#[test]
fn group_settle_emits_typed_events_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);

    const CREATOR_CONTRIB: i128 = 60_000_000;
    const MEMBER_B_CONTRIB: i128 = 40_000_000;
    const TOTAL: i128 = CREATOR_CONTRIB + MEMBER_B_CONTRIB;

    mint(&env, &token, &token_admin, &creator, CREATOR_CONTRIB);
    mint(&env, &token, &token_admin, &member_b, MEMBER_B_CONTRIB);

    let group_id = client.group_create(&creator, &String::from_str(&env, "typed-event-split"));
    client.group_join(&member_b, &group_id);
    client.group_contribute(&creator, &group_id, &CREATOR_CONTRIB);
    client.group_contribute(&member_b, &group_id, &MEMBER_B_CONTRIB);
    client.group_close(&creator, &group_id);

    let mut shares = Map::new(&env);
    shares.set(creator.clone(), 6_000u32);
    shares.set(member_b.clone(), 4_000u32);
    client.group_set_shares(&creator, &group_id, &shares);

    // Snapshot the event count right before settle so this test only
    // asserts on events `group_settle` itself emits — group_create,
    // group_join, group_contribute (x2), and group_set_shares all emit
    // their own events earlier in this setup.
    let events_before_settle = env.events().all().len();

    client.group_settle(&creator, &group_id);

    let now = env.ledger().timestamp();
    let member_b_payout = TOTAL * 4_000 / group_split::TOTAL_BPS as i128;
    let creator_payout = TOTAL - member_b_payout; // first member absorbs the rounding remainder

    let events = env.events().all();
    // `settle` also triggers a `transfer` event per member from the token
    // contract itself (a side effect of `token_client.transfer`), which is
    // interleaved with the vault's own `group_split_settled` events — so
    // filter by topic rather than assuming the vault's events are
    // contiguous or positionally first.
    let expected_creator_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_SPLIT_SETTLED,
        creator.clone(),
        group_id,
    )
        .into_val(&env);
    let expected_member_b_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_SPLIT_SETTLED,
        member_b.clone(),
        group_id,
    )
        .into_val(&env);

    let mut settled_events: soroban_sdk::Vec<(
        Address,
        soroban_sdk::Vec<soroban_sdk::Val>,
        soroban_sdk::Val,
    )> = soroban_sdk::Vec::new(&env);
    for i in events_before_settle..events.len() {
        let (contract_id, topics, data) = events.get(i).unwrap();
        if topics == expected_creator_topics || topics == expected_member_b_topics {
            settled_events.push_back((contract_id, topics, data));
        }
    }

    assert_eq!(
        settled_events.len(),
        2,
        "group_settle must emit exactly 2 group_split_settled events (one per member)"
    );

    let (creator_contract_id, _, creator_data) = settled_events.get(0).unwrap();
    let decoded_creator_data: (u64, Address, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &creator_data).unwrap();
    assert_eq!(creator_contract_id, client.address);
    assert_eq!(
        decoded_creator_data,
        (group_id, creator, creator_payout, now)
    );

    let (member_b_contract_id, _, member_b_data) = settled_events.get(1).unwrap();
    let decoded_member_b_data: (u64, Address, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &member_b_data).unwrap();
    assert_eq!(member_b_contract_id, client.address);
    assert_eq!(
        decoded_member_b_data,
        (group_id, member_b, member_b_payout, now)
    );
}

// ---------------------------------------------------------------------------
// Issue #47 — Emergency pause (admin)
//
// An admin-only `set_paused(bool)` toggles a flag that rejects mutating
// entrypoints with `Error::Paused` while paused. Reads remain available
// while paused, and the admin can unpause to resume normal operation.
// ---------------------------------------------------------------------------

/// While paused, a mutating entrypoint (`group_create`) is rejected with
/// `Error::Paused`; reads (`admin`, `is_paused`) keep working; and after the
/// admin unpauses, the same mutating call succeeds.
#[test]
fn paused_blocks_writes_and_admin_can_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);

    client.set_paused(&admin, &true);
    assert!(
        client.is_paused(),
        "vault must report paused after set_paused(true)"
    );

    let result = client.try_group_create(&creator, &soroban_sdk::String::from_str(&env, "pool"));
    assert_eq!(
        result,
        Err(Ok(Error::Paused)),
        "mutating entrypoints must be rejected with Paused while paused",
    );

    // Reads remain available while paused.
    assert_eq!(client.admin(), admin);

    client.set_paused(&admin, &false);
    assert!(
        !client.is_paused(),
        "vault must report unpaused after set_paused(false)"
    );

    let group_id = client.group_create(&creator, &soroban_sdk::String::from_str(&env, "pool"));
    let group = client.group(&group_id);
    assert_eq!(
        group.creator, creator,
        "group_create must succeed once unpaused"
    );
}

/// Only the admin may pause/unpause the vault.
#[test]
fn set_paused_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let attacker = Address::generate(&env);

    let result = client.try_set_paused(&attacker, &true);
    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "non-admin must not be able to pause the vault",
    );
    assert!(
        !client.is_paused(),
        "vault must remain unpaused after a rejected pause attempt"
    );
}

// ---------------------------------------------------------------------------
// Issue #30 — Audit and extend error codes
//
// Every documented Error variant must be reachable and asserted at least
// once. The tests above already cover AlreadyInitialized,
// DepositCapExceeded, InsufficientBalance, InvalidAmount, InvalidShares,
// NotAMember, NotFound, Overflow, Paused, StillLocked, and Unauthorized.
// The four tests below cover the remaining variants: NotInitialized,
// InvalidUnlockTime, GoalNotReached, and GroupClosed.
// ---------------------------------------------------------------------------

/// Every entrypoint that touches the configured token must reject with
/// `NotInitialized` before `initialize` has ever been called.
#[test]
fn uninitialized_vault_rejects_with_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let owner = Address::generate(&env);

    let deposit_result = client.try_deposit(&owner, &1_000_000);
    assert_eq!(
        deposit_result,
        Err(Ok(Error::NotInitialized)),
        "deposit on an uninitialized vault must fail with NotInitialized",
    );

    let locked_result = client.try_locked_create(&owner, &1_000_000, &1);
    assert_eq!(
        locked_result,
        Err(Ok(Error::NotInitialized)),
        "locked_create on an uninitialized vault must fail with NotInitialized",
    );
}

/// `locked_create` must reject an `unlock_at` that is not strictly in the
/// future (at or before the current ledger timestamp).
#[test]
fn locked_create_rejects_unlock_at_not_in_future() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);

    let now = env.ledger().timestamp();

    let at_now = client.try_locked_create(&owner, &1_000_000, &now);
    assert_eq!(
        at_now,
        Err(Ok(Error::InvalidUnlockTime)),
        "unlock_at == now must be rejected as not strictly in the future",
    );

    if now > 0 {
        let in_past = client.try_locked_create(&owner, &1_000_000, &(now - 1));
        assert_eq!(
            in_past,
            Err(Ok(Error::InvalidUnlockTime)),
            "unlock_at in the past must be rejected",
        );
    }
}

/// `goal_claim` must reject with `GoalNotReached` while the goal's
/// `saved_amount` is still below its `target_amount`.
#[test]
fn goal_claim_before_target_reached_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);
    let name = soroban_sdk::String::from_str(&env, "unreached goal");

    let goal_id = client.goal_create(&owner, &name, &1_000_000_000);

    let result = client.try_goal_claim(&owner, &goal_id);
    assert_eq!(
        result,
        Err(Ok(Error::GoalNotReached)),
        "claiming a goal before its target is reached must fail with GoalNotReached",
    );
}

/// `group_join` must reject with `GroupClosed` once the group's creator
/// has closed it.
#[test]
fn group_join_after_close_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let latecomer = Address::generate(&env);
    let name = soroban_sdk::String::from_str(&env, "closed pool");

    let group_id = client.group_create(&creator, &name);
    client.group_close(&creator, &group_id);

    let result = client.try_group_join(&latecomer, &group_id);
    assert_eq!(
        result,
        Err(Ok(Error::GroupClosed)),
        "joining a closed group must fail with GroupClosed",
    );
}

// ---------------------------------------------------------------------------
// Issue #433 — Group savings voting
// ---------------------------------------------------------------------------

const VOTING_PERIOD: u64 = 3_600;
const VOTE_CONTRIB: i128 = 10_000_000;

/// Create a group owned by `creator`, joined by `others`, funded so every
/// member contributes [`VOTE_CONTRIB`] (pool = `VOTE_CONTRIB * (others.len()
/// + 1)`), with a `period`-second voting window, then close it. Returns the
/// group id.
fn closed_group_with_voting(
    env: &Env,
    client: &SavingsVaultClient,
    token: &Address,
    token_admin: &Address,
    creator: &Address,
    others: &[Address],
    period: u64,
) -> u64 {
    let group_id = client.group_create(creator, &String::from_str(env, "vote-pool"));
    for m in others {
        client.group_join(m, &group_id);
    }
    mint(env, token, token_admin, creator, VOTE_CONTRIB);
    client.group_contribute(creator, &group_id, &VOTE_CONTRIB);
    for m in others {
        mint(env, token, token_admin, m, VOTE_CONTRIB);
        client.group_contribute(m, &group_id, &VOTE_CONTRIB);
    }
    client.group_set_voting_period(creator, &group_id, &period);
    client.group_close(creator, &group_id);
    group_id
}

/// A proposal that clears the majority threshold pays the recipient and
/// reduces the pool by exactly the proposed amount.
#[test]
fn group_voting_passing_proposal_pays_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone(), member_c.clone()],
        VOTING_PERIOD,
    );
    let pool = VOTE_CONTRIB * 3;
    assert_eq!(client.group(&group_id).balance, pool);

    // Any member can propose, not just the creator.
    const SPEND: i128 = 12_000_000;
    let proposal_id = client.group_propose(&member_b, &group_id, &recipient, &SPEND);

    // Two of three members vote yes — a strict majority.
    client.group_vote(&creator, &proposal_id, &true);
    client.group_vote(&member_b, &proposal_id, &true);

    let ends_at = client.group_proposal(&proposal_id).voting_ends_at;
    set_ledger_time(&env, ends_at + 1, 2);

    let passed = client.group_execute(&member_c, &proposal_id);
    assert!(passed, "2 of 3 yes votes must carry the proposal");

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), SPEND);
    assert_eq!(client.group(&group_id).balance, pool - SPEND);

    let proposal = client.group_proposal(&proposal_id);
    assert!(proposal.executed);
    assert!(proposal.passed);
}

/// A proposal without a majority pays nothing and leaves the pool untouched.
#[test]
fn group_voting_rejected_proposal_pays_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone(), member_c.clone()],
        VOTING_PERIOD,
    );
    let pool = VOTE_CONTRIB * 3;
    const SPEND: i128 = 5_000_000;
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &SPEND);

    // 1 yes, 2 no — below half of 3 members.
    client.group_vote(&creator, &proposal_id, &true);
    client.group_vote(&member_b, &proposal_id, &false);
    client.group_vote(&member_c, &proposal_id, &false);

    let ends_at = client.group_proposal(&proposal_id).voting_ends_at;
    set_ledger_time(&env, ends_at + 1, 2);

    let passed = client.group_execute(&creator, &proposal_id);
    assert!(!passed, "1 of 3 yes votes must not carry the proposal");

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(client.group(&group_id).balance, pool);
    assert!(client.group_proposal(&proposal_id).executed);
}

/// Voting is rejected once the window has closed.
#[test]
fn group_vote_after_window_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone()],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);

    let ends_at = client.group_proposal(&proposal_id).voting_ends_at;
    set_ledger_time(&env, ends_at, 2);

    let result = client.try_group_vote(&member_b, &proposal_id, &true);
    assert_eq!(
        result,
        Err(Ok(Error::OperationExpired)),
        "voting at/after the window close must fail with OperationExpired",
    );
}

/// Execution is rejected until the voting window has closed.
#[test]
fn group_execute_before_window_closed_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone()],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);
    client.group_vote(&creator, &proposal_id, &true);
    client.group_vote(&member_b, &proposal_id, &true);

    let result = client.try_group_execute(&creator, &proposal_id);
    assert_eq!(
        result,
        Err(Ok(Error::TimeWindowNotOpen)),
        "executing before the window closes must fail with TimeWindowNotOpen",
    );
}

/// A member cannot vote twice on the same proposal.
#[test]
fn group_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone()],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);

    client.group_vote(&creator, &proposal_id, &true);
    let result = client.try_group_vote(&creator, &proposal_id, &false);
    assert_eq!(
        result,
        Err(Ok(Error::AlreadyVoted)),
        "a member voting twice must fail with AlreadyVoted",
    );
}

/// Only current group members may vote.
#[test]
fn group_vote_by_non_member_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let outsider = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone()],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);

    let result = client.try_group_vote(&outsider, &proposal_id, &true);
    assert_eq!(
        result,
        Err(Ok(Error::NotAMember)),
        "a non-member vote must fail with NotAMember",
    );
}

/// Proposing is rejected while the group is still open.
#[test]
fn group_propose_requires_closed_group() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = client.group_create(&creator, &String::from_str(&env, "open-pool"));
    client.group_set_voting_period(&creator, &group_id, &VOTING_PERIOD);
    mint(&env, &token, &token_admin, &creator, VOTE_CONTRIB);
    client.group_contribute(&creator, &group_id, &VOTE_CONTRIB);

    let result = client.try_group_propose(&creator, &group_id, &recipient, &1_000_000);
    assert_eq!(
        result,
        Err(Ok(Error::GroupClosed)),
        "proposing on an open group must fail with GroupClosed",
    );
}

/// Proposing is rejected when no voting period has been configured.
#[test]
fn group_propose_without_voting_period_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    // period = 0 disables proposals.
    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[],
        0,
    );

    let result = client.try_group_propose(&creator, &group_id, &recipient, &1_000_000);
    assert_eq!(
        result,
        Err(Ok(Error::InvalidParameters)),
        "proposing without a voting period must fail with InvalidParameters",
    );
}

/// A proposal cannot be executed twice.
#[test]
fn group_execute_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[member_b.clone()],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);
    client.group_vote(&creator, &proposal_id, &true);
    client.group_vote(&member_b, &proposal_id, &true);

    let ends_at = client.group_proposal(&proposal_id).voting_ends_at;
    set_ledger_time(&env, ends_at + 1, 2);

    assert!(client.group_execute(&creator, &proposal_id));
    let result = client.try_group_execute(&creator, &proposal_id);
    assert_eq!(
        result,
        Err(Ok(Error::ProposalAlreadyExecuted)),
        "re-executing a settled proposal must fail with ProposalAlreadyExecuted",
    );
}

/// Only the creator may configure the voting period.
#[test]
fn group_set_voting_period_by_non_creator_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_token(&env);
    let creator = Address::generate(&env);
    let member_b = Address::generate(&env);

    let group_id = client.group_create(&creator, &String::from_str(&env, "period-pool"));
    client.group_join(&member_b, &group_id);

    let result = client.try_group_set_voting_period(&member_b, &group_id, &VOTING_PERIOD);
    assert_eq!(
        result,
        Err(Ok(Error::Unauthorized)),
        "a non-creator setting the voting period must fail with Unauthorized",
    );
}

/// `group_propose` emits a `group_proposal_created` event with topics
/// `(group_proposal_created, proposer, id)` and data `(id, group_id,
/// recipient, amount, voting_ends_at, timestamp)`.
#[test]
fn group_propose_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[],
        VOTING_PERIOD,
    );

    const SPEND: i128 = 4_000_000;
    let now = env.ledger().timestamp();
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &SPEND);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_PROPOSAL_CREATED,
        creator.clone(),
        proposal_id,
    )
        .into_val(&env);
    let decoded_data: (u64, u64, Address, i128, u64, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(
        decoded_data,
        (proposal_id, group_id, recipient, SPEND, now + VOTING_PERIOD, now)
    );
}

/// `group_vote` emits a `group_vote_cast` event with topics
/// `(group_vote_cast, voter, id)` and data `(id, group_id, approve,
/// timestamp)`.
#[test]
fn group_vote_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[],
        VOTING_PERIOD,
    );
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &1_000_000);

    let now = env.ledger().timestamp();
    client.group_vote(&creator, &proposal_id, &true);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_VOTE_CAST,
        creator.clone(),
        proposal_id,
    )
        .into_val(&env);
    let decoded_data: (u64, u64, bool, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (proposal_id, group_id, true, now));
}

/// `group_execute` emits a `group_proposal_executed` event with topics
/// `(group_proposal_executed, caller, id)` and data `(id, group_id, passed,
/// spent, timestamp)`.
#[test]
fn group_execute_emits_typed_event_with_expected_topic_and_data() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    let group_id = closed_group_with_voting(
        &env,
        &client,
        &token,
        &token_admin,
        &creator,
        &[],
        VOTING_PERIOD,
    );
    const SPEND: i128 = 3_000_000;
    let proposal_id = client.group_propose(&creator, &group_id, &recipient, &SPEND);
    client.group_vote(&creator, &proposal_id, &true);

    let ends_at = client.group_proposal(&proposal_id).voting_ends_at;
    set_ledger_time(&env, ends_at + 1, 2);

    let now = env.ledger().timestamp();
    client.group_execute(&creator, &proposal_id);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> = (
        crate::events::TOPIC_GROUP_PROPOSAL_EXECUTED,
        creator.clone(),
        proposal_id,
    )
        .into_val(&env);
    // A single-member group: 1 yes out of 1 carries the proposal.
    let decoded_data: (u64, u64, bool, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (proposal_id, group_id, true, SPEND, now));
}

// ---------------------------------------------------------------------------
// Issue #434 — Compound interest
// ---------------------------------------------------------------------------

const MONTH: u64 = 2_592_000;
const YEAR: u64 = 31_536_000;
const INTEREST_PRINCIPAL: i128 = 1_000_000;

/// Configure `rate_bps`/`frequency`, create an interest account for a fresh
/// owner funded with [`INTEREST_PRINCIPAL`], and return the owner. The
/// account is opened at the current ledger time (0 unless a test has already
/// travelled the clock).
fn setup_interest(
    env: &Env,
    client: &SavingsVaultClient,
    admin: &Address,
    token: &Address,
    token_admin: &Address,
    rate_bps: u32,
    frequency: CompoundFrequency,
) -> Address {
    client.set_interest_rate(admin, &rate_bps);
    client.set_interest_frequency(admin, &frequency);

    let owner = Address::generate(env);
    mint(env, token, token_admin, &owner, INTEREST_PRINCIPAL);
    client.interest_deposit(&owner, &INTEREST_PRINCIPAL);
    owner
}

/// A deposit opens an account whose principal is the deposited amount.
#[test]
fn interest_deposit_creates_account_with_principal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    let account = client.interest_account(&owner);
    assert_eq!(account.owner, owner);
    assert_eq!(account.principal, INTEREST_PRINCIPAL);
    assert_eq!(account.rate_bps, 1200);
    assert_eq!(account.frequency, CompoundFrequency::Monthly);
    assert_eq!(account.last_compound_at, env.ledger().timestamp());
}

/// No interest accrues until a whole compounding period has elapsed.
#[test]
fn interest_no_accrual_before_a_full_period() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH - 1, 2);
    assert_eq!(client.interest_accrued(&owner), 0);
}

/// One monthly period at 12% annual credits 1% of principal (12% / 12).
#[test]
fn interest_accrues_one_monthly_period() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH, 2);
    assert_eq!(client.interest_accrued(&owner), 10_000);
}

/// Interest compounds: two monthly periods at 1% each is 1.0201× the
/// principal, not 1.02×.
#[test]
fn interest_compounds_over_multiple_periods() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, 2 * MONTH, 2);
    assert_eq!(client.interest_accrued(&owner), 20_100);
}

/// The annual frequency compounds once per year (10% of principal).
#[test]
fn interest_accrues_annually() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1000,
        CompoundFrequency::Annually,
    );

    set_ledger_time(&env, YEAR, 2);
    assert_eq!(client.interest_accrued(&owner), 100_000);
}

/// Claiming credits the accrued interest into the principal; a second claim
/// before the next period elapses credits nothing.
#[test]
fn interest_claim_credits_and_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH, 2);
    assert_eq!(client.interest_claim(&owner), 10_000);
    assert_eq!(client.interest_account(&owner).principal, 1_010_000);

    // No further whole period has elapsed.
    assert_eq!(client.interest_claim(&owner), 0);
}

/// Withdrawing settles accrued interest first, so the caller can draw on it.
#[test]
fn interest_withdraw_draws_on_accrued_interest() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH, 2);
    // Settled principal is 1_010_000; withdraw more than the original deposit.
    client.interest_withdraw(&owner, &1_005_000);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&owner), 1_005_000);
    assert_eq!(client.interest_account(&owner).principal, 5_000);
}

/// Withdrawing beyond the settled principal fails.
#[test]
fn interest_withdraw_exceeding_principal_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    assert_eq!(
        client.try_interest_withdraw(&owner, &(INTEREST_PRINCIPAL + 1)),
        Err(Ok(Error::InsufficientBalance)),
    );
}

#[test]
fn interest_deposit_rejects_non_positive_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token) = setup_with_token(&env);
    let owner = Address::generate(&env);

    assert_eq!(
        client.try_interest_deposit(&owner, &0),
        Err(Ok(Error::InvalidAmount)),
    );
}

#[test]
fn interest_unknown_account_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token) = setup_with_token(&env);
    let stranger = Address::generate(&env);

    assert_eq!(
        client.try_interest_account(&stranger),
        Err(Ok(Error::NotFound)),
    );
    assert_eq!(
        client.try_interest_withdraw(&stranger, &1_000),
        Err(Ok(Error::NotFound)),
    );
    assert_eq!(
        client.try_interest_claim(&stranger),
        Err(Ok(Error::NotFound)),
    );
    assert_eq!(
        client.try_interest_accrued(&stranger),
        Err(Ok(Error::NotFound)),
    );
}

/// A rate change does not re-price time that accrued under the old rate: the
/// account settles at its snapshot, then adopts the new rate.
#[test]
fn interest_rate_change_does_not_repricing_accrued_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH, 2);
    // Raise the rate after the period elapsed but before the account is
    // touched; the accrued period must still be priced at 12% annual.
    client.set_interest_rate(&admin, &2400);

    assert_eq!(client.interest_claim(&owner), 10_000);
    assert_eq!(client.interest_account(&owner).rate_bps, 2400);
}

#[test]
fn set_interest_rate_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token) = setup_with_token(&env);
    let not_admin = Address::generate(&env);

    assert_eq!(
        client.try_set_interest_rate(&not_admin, &100),
        Err(Ok(Error::Unauthorized)),
    );
}

#[test]
fn set_interest_rate_above_max_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token) = setup_with_token(&env);

    assert_eq!(
        client.try_set_interest_rate(&admin, &10_001),
        Err(Ok(Error::InvalidParameters)),
    );
}

#[test]
fn interest_frequency_round_trip_and_default() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token) = setup_with_token(&env);

    // Defaults to annual compounding before any configuration.
    assert_eq!(client.interest_frequency(), CompoundFrequency::Annually);
    assert_eq!(client.interest_rate_bps(), 0);

    client.set_interest_frequency(&admin, &CompoundFrequency::Daily);
    assert_eq!(client.interest_frequency(), CompoundFrequency::Daily);
}

/// A claim emits `interest_claimed` with the credited amount and new balance.
#[test]
fn interest_claim_emits_typed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);

    let owner = setup_interest(
        &env,
        &client,
        &admin,
        &token,
        &token_admin,
        1200,
        CompoundFrequency::Monthly,
    );

    set_ledger_time(&env, MONTH, 2);
    client.interest_claim(&owner);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (crate::events::TOPIC_INTEREST_CLAIMED, owner.clone()).into_val(&env);
    let decoded_data: (Address, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(decoded_data, (owner, 10_000, 1_010_000, MONTH));
}

/// A deposit emits `interest_deposit` with the amount and resulting principal.
#[test]
fn interest_deposit_emits_typed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token) = setup_with_token(&env);
    let token_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    mint(&env, &token, &token_admin, &owner, INTEREST_PRINCIPAL);

    client.interest_deposit(&owner, &INTEREST_PRINCIPAL);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap().clone();

    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (crate::events::TOPIC_INTEREST_DEPOSIT, owner.clone()).into_val(&env);
    let decoded_data: (Address, i128, i128, u64) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();

    assert_eq!(contract_id, client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(
        decoded_data,
        (owner, INTEREST_PRINCIPAL, INTEREST_PRINCIPAL, 0)
    );
}

// ---------------------------------------------------------------------------
// Issue #41 — Property test: split rounding sums to pool
//
// Weighted settlement must never create or destroy funds via rounding: for
// any valid share configuration (bps values summing to `TOTAL_BPS`) and any
// pool balance, the computed per-member payouts must sum to exactly the
// pool, and every individual payout must be non-negative.
// ---------------------------------------------------------------------------

mod group_split_properties {
    use crate::group_split::{compute_payouts, TOTAL_BPS};
    use proptest::prelude::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Map};

    /// Build a valid `shares_bps` map from arbitrary positive `weights`:
    /// each member's bps is proportional to its weight, and the last
    /// member absorbs whatever rounding remainder is needed so the shares
    /// sum to exactly `TOTAL_BPS` (a precondition `set_shares` enforces
    /// on-chain).
    fn shares_from_weights(
        env: &Env,
        weights: &[u32],
    ) -> (soroban_sdk::Vec<Address>, Map<Address, u32>) {
        let mut addrs: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(env);
        for _ in weights {
            addrs.push_back(Address::generate(env));
        }

        let total_weight: u64 = weights.iter().map(|w| *w as u64).sum();
        let mut shares: Map<Address, u32> = Map::new(env);
        let mut distributed: u32 = 0;

        for (i, w) in weights.iter().enumerate() {
            let member = addrs.get(i as u32).unwrap();
            let bps = if i + 1 == weights.len() {
                TOTAL_BPS - distributed
            } else {
                let bps = ((*w as u64) * (TOTAL_BPS as u64) / total_weight) as u32;
                distributed += bps;
                bps
            };
            shares.set(member, bps);
        }

        (addrs, shares)
    }

    proptest! {
        /// For any valid shares configuration and any non-negative pool
        /// balance, settlement conserves the pool exactly: the sum of
        /// computed payouts equals the pool, and no payout is negative.
        #[test]
        fn split_rounding_sums_to_pool(
            weights in proptest::collection::vec(1u32..=1_000u32, 1..=8),
            pool in 0i128..=1_000_000_000_000_000i128,
        ) {
            let env = Env::default();
            let (addrs, shares) = shares_from_weights(&env, &weights);
            let remainder_recipient = addrs.get(0).unwrap();

            let payouts = compute_payouts(&env, &shares, pool, &remainder_recipient);

            let mut sum: i128 = 0;
            for (_member, amount) in payouts.iter() {
                prop_assert!(amount >= 0, "every payout must be non-negative, got {}", amount);
                sum += amount;
            }

            prop_assert_eq!(sum, pool, "sum of payouts must equal the pool exactly");
        }
    }
}
