//! Group savings — shared pools with contract-enforced rules and payouts.

use soroban_sdk::{Address, Env, Map, String, Vec};

use crate::admin::require_not_paused;
use crate::error::Error;
use crate::events::{
    TOPIC_GROUP_CLOSED, TOPIC_GROUP_CONTRIBUTION, TOPIC_GROUP_CREATED, TOPIC_GROUP_PAYOUT,
};
use crate::storage::{self, extend_instance_ttl};
use crate::types::{DataKey, Group};

/// Create a group pool. The creator is the first member.
///
/// Returns the new group id. `open == true` until `close` is called.
pub fn create(env: &Env, creator: Address, name: String) -> Result<u64, Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    creator.require_auth();

    // Allocate a new group id
    let id = next_group_id(env);

    // Create members vector with creator as the sole member
    let mut members = Vec::new(env);
    members.push_back(creator.clone());

    // Create the group with open = true and zero balance
    let now = env.ledger().timestamp();
    let group = Group {
        id,
        creator: creator.clone(),
        name: name.clone(),
        members,
        balance: 0,
        shares_bps: Map::new(env),
        open: true,
        created_at: now,
        // Proposals are opt-in: the creator must configure a voting window
        // via `group_set_voting_period` before any proposal can be opened.
        voting_period: 0,
    };

    // Store the group
    let key = DataKey::Group(id);
    env.storage().persistent().set(&key, &group);
    storage::extend_persistent_ttl(env, &key);

    // Emit group-created event: topics carry (creator, id) so indexers can
    // filter server-side without decoding data, per the event schema in
    // contracts/savings-vault/README.md.
    env.events().publish(
        (TOPIC_GROUP_CREATED, creator.clone(), id),
        (id, creator, name, now),
    );

    Ok(id)
}

/// Join an open group.
///
/// Errors `GroupClosed` if the group is not accepting members.
pub fn join(env: &Env, member: Address, group_id: u64) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    member.require_auth();

    // Load the group
    let key = DataKey::Group(group_id);
    let mut group: Group = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    // Check if the group is open
    if !group.open {
        return Err(Error::GroupClosed);
    }

    // Check if member is already in the group (idempotent)
    let already_member = group.members.iter().any(|m| m == member);

    if !already_member {
        // Add member to the group
        group.members.push_back(member.clone());

        // Save the updated group
        env.storage().persistent().set(&key, &group);
        storage::extend_persistent_ttl(env, &key);

        // Emit group-joined event
        env.events()
            .publish((crate::events::TOPIC_GROUP_JOINED,), (group_id, member));
    }

    Ok(())
}

/// Contribute `amount` into the shared pool.
///
/// Errors `NotAMember` if the caller has not joined.
pub fn contribute(env: &Env, member: Address, group_id: u64, amount: i128) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    member.require_auth();

    // Validate amount
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    // Load the group
    let key = DataKey::Group(group_id);
    let mut group: Group = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    // Verify membership
    let is_member = group.members.iter().any(|m| m == member);
    if !is_member {
        return Err(Error::NotAMember);
    }

    // Transfer tokens from member into the vault
    storage::transfer_in(env, &member, amount)?;

    // Increment pool balance
    group.balance += amount;

    // Save updated group
    env.storage().persistent().set(&key, &group);
    storage::extend_persistent_ttl(env, &key);

    // Emit contribution event
    env.events()
        .publish((TOPIC_GROUP_CONTRIBUTION,), (group_id, member, amount));

    Ok(())
}

/// Close the group to new members and lock the membership set so shares can
/// be settled. Creator-only.
pub fn close(env: &Env, creator: Address, group_id: u64) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    creator.require_auth();

    // Load the group
    let key = DataKey::Group(group_id);
    let mut group: Group = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    // Verify creator
    if group.creator != creator {
        return Err(Error::Unauthorized);
    }

    // Set open to false
    group.open = false;

    // Save updated group
    env.storage().persistent().set(&key, &group);
    storage::extend_persistent_ttl(env, &key);

    // Emit group closed event
    env.events()
        .publish((TOPIC_GROUP_CLOSED,), (group_id, creator));

    Ok(())
}

/// Equal-split payout: divide the pool balance evenly across members and
/// transfer each member their share. See `group_split` for weighted payouts.
///
/// Auth: `caller` — permissionless once the group is closed; any signed
/// caller may trigger settlement (the payout goes to the members, not to
/// `caller`, so there is no principal to restrict this to). `require_auth`
/// is still enforced so every invocation is attributable to a real signer
/// rather than an unauthenticated relay.
pub fn payout_equal(env: &Env, caller: Address, group_id: u64) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    caller.require_auth();

    // Load the group
    let key = DataKey::Group(group_id);
    let mut group: Group = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    // Require closed group
    if group.open {
        return Err(Error::GroupClosed);
    }

    // Get the number of members
    let member_count = group.members.len();
    if member_count == 0 {
        return Err(Error::NotFound); // No members to payout
    }

    // Calculate equal share and remainder
    let total_balance = group.balance;
    let share_per_member = total_balance / (member_count as i128);
    let mut remainder = total_balance % (member_count as i128);

    // Transfer to each member
    for (index, member) in group.members.iter().enumerate() {
        let mut payout_amount = share_per_member;

        // Assign remainder to the first member (creator) deterministically
        if index == 0 && remainder > 0 {
            payout_amount += remainder;
            remainder = 0;
        }

        // Skip members with nothing owed (no transfer, no event).
        if payout_amount == 0 {
            continue;
        }

        // Transfer tokens to member
        storage::transfer_out(env, &member, payout_amount)?;

        // Emit payout event for each member
        env.events().publish(
            (TOPIC_GROUP_PAYOUT,),
            (group_id, member.clone(), payout_amount),
        );
    }

    // Zero the pool balance
    group.balance = 0;

    // Save updated group
    env.storage().persistent().set(&key, &group);
    storage::extend_persistent_ttl(env, &key);

    Ok(())
}

pub fn get_group(env: &Env, group_id: u64) -> Result<Group, Error> {
    let key = DataKey::Group(group_id);
    let group = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);
    Ok(group)
}

/// Helper to allocate the next group id.
fn next_group_id(env: &Env) -> u64 {
    let key = DataKey::NextGroupId;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}
