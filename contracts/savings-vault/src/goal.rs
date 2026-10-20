//! Goal-based savings — save toward a target with automated milestones.

use soroban_sdk::{Address, Env, String};

use crate::error::Error;
use crate::events::{
    TOPIC_GOAL_AUTO_RENEW_SET, TOPIC_GOAL_CLAIMED, TOPIC_GOAL_CONTRIBUTION, TOPIC_GOAL_CREATED,
    TOPIC_GOAL_REACHED, TOPIC_GOAL_RENEWED,
};
use crate::storage::{self, extend_instance_ttl};
use crate::types::{DataKey, Goal};

/// Create a savings goal with a `target_amount`.
///
/// - `owner.require_auth()`.
/// - Errors `InvalidAmount` if `target_amount <= 0`.
/// - Returns the new goal id.
pub fn create(env: &Env, owner: Address, name: String, target_amount: i128) -> Result<u64, Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    if target_amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let id = storage::next_id(env, DataKey::NextGoalId);
    let now = env.ledger().timestamp();
    let goal = Goal {
        id,
        owner: owner.clone(),
        name: name.clone(),
        target_amount,
        saved_amount: 0,
        created_at: now,
        reached_at: None,
        auto_renew: false,
    };
    let key = DataKey::Goal(id);
    env.storage().persistent().set(&key, &goal);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_GOAL_CREATED, owner.clone(), id),
        (id, owner, name, target_amount, now),
    );

    Ok(id)
}

/// Contribute `amount` toward a goal. When cumulative `saved_amount` first
/// reaches `target_amount`, set `reached_at` and emit a `goal_reached` event.
pub fn contribute(env: &Env, from: Address, goal_id: u64, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    from.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::Goal(goal_id);
    let mut goal: Goal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    storage::transfer_in(env, &from, amount)?;

    let was_reached = goal.reached_at.is_some();
    let new_saved = goal
        .saved_amount
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    goal.saved_amount = new_saved;

    let now = env.ledger().timestamp();
    env.events().publish(
        (TOPIC_GOAL_CONTRIBUTION, from.clone(), goal_id),
        (goal_id, from, amount, new_saved, now),
    );

    if !was_reached && new_saved >= goal.target_amount {
        goal.reached_at = Some(now);
        env.events().publish(
            (TOPIC_GOAL_REACHED, goal.owner.clone(), goal_id),
            (
                goal_id,
                goal.owner.clone(),
                new_saved,
                goal.target_amount,
                now,
            ),
        );
    }

    env.storage().persistent().set(&key, &goal);
    storage::extend_persistent_ttl(env, &key);

    Ok(())
}

/// Withdraw funds from a reached goal back to the owner.
///
/// If the goal has `auto_renew` enabled, the payout is followed by a
/// restart: `saved_amount` resets to 0 and `reached_at` clears (the id,
/// name, and target are kept), so the same goal can be saved toward again.
/// Otherwise the goal is closed, as before.
///
/// Errors `GoalNotReached` if the target has not been met yet.
pub fn claim(env: &Env, owner: Address, goal_id: u64) -> Result<(), Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    let key = DataKey::Goal(goal_id);
    let mut goal: Goal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;

    if goal.owner != owner {
        return Err(Error::Unauthorized);
    }

    if goal.reached_at.is_none() {
        return Err(Error::GoalNotReached);
    }

    storage::transfer_out(env, &owner, goal.saved_amount)?;

    let now = env.ledger().timestamp();
    env.events().publish(
        (TOPIC_GOAL_CLAIMED, owner.clone(), goal_id),
        (goal_id, owner.clone(), goal.saved_amount, now),
    );

    if goal.auto_renew {
        // Restart in place: clear progress but keep the goal alive so the
        // owner can begin saving toward the same target again.
        goal.saved_amount = 0;
        goal.reached_at = None;
        env.storage().persistent().set(&key, &goal);
        storage::extend_persistent_ttl(env, &key);

        env.events().publish(
            (TOPIC_GOAL_RENEWED, owner.clone(), goal_id),
            (goal_id, owner, goal.target_amount, now),
        );
    } else {
        // Paid out in full — close the goal rather than leaving a claimable
        // zero-balance record behind.
        env.storage().persistent().remove(&key);
    }

    Ok(())
}

/// Enable or disable automatic renewal for a goal. Owner-only.
///
/// When enabled, [`claim`] restarts the goal (zeroed `saved_amount`, cleared
/// `reached_at`) instead of closing it.
pub fn set_auto_renew(
    env: &Env,
    owner: Address,
    goal_id: u64,
    auto_renew: bool,
) -> Result<(), Error> {
    extend_instance_ttl(env);
    owner.require_auth();

    let key = DataKey::Goal(goal_id);
    let mut goal: Goal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if goal.owner != owner {
        return Err(Error::Unauthorized);
    }

    goal.auto_renew = auto_renew;
    env.storage().persistent().set(&key, &goal);
    storage::extend_persistent_ttl(env, &key);

    let now = env.ledger().timestamp();
    env.events().publish(
        (TOPIC_GOAL_AUTO_RENEW_SET, owner.clone(), goal_id),
        (goal_id, owner, auto_renew, now),
    );

    Ok(())
}

pub fn get_goal(env: &Env, goal_id: u64) -> Result<Goal, Error> {
    let key = DataKey::Goal(goal_id);
    let goal = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);
    Ok(goal)
}

/// Helper to allocate the next goal id.
fn next_goal_id(env: &Env) -> u64 {
    let key = DataKey::NextGoalId;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}
