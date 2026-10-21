//! Group savings voting — members decide how to spend a group's pool.
//!
//! Lifecycle:
//!
//! 1. The creator configures a voting window with [`set_voting_period`]
//!    (`0` disables proposals for the group).
//! 2. Any member opens a proposal to send `amount` from the pool to a
//!    `recipient` via [`propose`].
//! 3. Members cast one vote each with [`vote`] until the window closes.
//! 4. Once the window has closed, anyone may settle the outcome with
//!    [`execute`]: the proposal passes when the yes votes exceed half of all
//!    members, and on a pass the pool pays the recipient.
//!
//! Proposals require the group to be *closed* (`group::close`), which freezes
//! the membership set so the majority threshold cannot be moved mid-vote.

use soroban_sdk::{Address, Env, Vec};

use crate::admin::require_not_paused;
use crate::error::Error;
use crate::events::{
    TOPIC_GROUP_PROPOSAL_CREATED, TOPIC_GROUP_PROPOSAL_EXECUTED, TOPIC_GROUP_VOTE_CAST,
    TOPIC_GROUP_VOTING_PERIOD_SET,
};
use crate::storage::{self, extend_instance_ttl};
use crate::types::{DataKey, Group, Proposal};

/// Set the voting window, in seconds, for spending proposals on `group_id`.
/// Creator-only. `0` disables proposals for the group.
///
/// Errors: `NotFound` (unknown group), `Unauthorized` (caller is not the
/// creator).
pub fn set_voting_period(
    env: &Env,
    creator: Address,
    group_id: u64,
    seconds: u64,
) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    creator.require_auth();

    let key = DataKey::Group(group_id);
    let mut group: Group = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if group.creator != creator {
        return Err(Error::Unauthorized);
    }

    group.voting_period = seconds;
    env.storage().persistent().set(&key, &group);
    storage::extend_persistent_ttl(env, &key);

    env.events().publish(
        (TOPIC_GROUP_VOTING_PERIOD_SET, creator.clone(), group_id),
        (group_id, creator, seconds, env.ledger().timestamp()),
    );

    Ok(())
}

/// Propose spending `amount` from the group pool to `recipient`.
///
/// Any member may propose, but the group must be closed (membership frozen)
/// and have a non-zero voting period configured. The voting window runs from
/// now until `now + voting_period`.
///
/// Errors: `InvalidAmount` (`amount <= 0`), `NotFound`, `NotAMember`,
/// `GroupClosed` (the group is still open), `InvalidParameters` (no voting
/// period configured), `InsufficientGroupFunds` (amount exceeds the pool),
/// `Overflow`.
pub fn propose(
    env: &Env,
    proposer: Address,
    group_id: u64,
    recipient: Address,
    amount: i128,
) -> Result<u64, Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    proposer.require_auth();

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let key = DataKey::Group(group_id);
    let group: Group = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);

    if !group.members.iter().any(|m| m == proposer) {
        return Err(Error::NotAMember);
    }
    if group.open {
        return Err(Error::GroupClosed);
    }
    if group.voting_period == 0 {
        return Err(Error::InvalidParameters);
    }
    if amount > group.balance {
        return Err(Error::InsufficientGroupFunds);
    }

    let id = next_proposal_id(env);
    let now = env.ledger().timestamp();
    let voting_ends_at = now.checked_add(group.voting_period).ok_or(Error::Overflow)?;

    let proposal = Proposal {
        id,
        group_id,
        proposer: proposer.clone(),
        recipient: recipient.clone(),
        amount,
        voting_ends_at,
        yes_voters: Vec::new(env),
        no_voters: Vec::new(env),
        created_at: now,
        executed: false,
        passed: false,
    };

    let pkey = DataKey::Proposal(id);
    env.storage().persistent().set(&pkey, &proposal);
    storage::extend_persistent_ttl(env, &pkey);

    env.events().publish(
        (TOPIC_GROUP_PROPOSAL_CREATED, proposer.clone(), id),
        (id, group_id, recipient, amount, voting_ends_at, now),
    );

    Ok(id)
}

/// Cast a vote on `proposal_id`. Each member may vote exactly once, either
/// way, and only while the voting window is open.
///
/// Errors: `NotFound`, `NotAMember`, `ProposalAlreadyExecuted`,
/// `OperationExpired` (the window has closed), `AlreadyVoted`.
pub fn vote(env: &Env, voter: Address, proposal_id: u64, approve: bool) -> Result<(), Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    voter.require_auth();

    let pkey = DataKey::Proposal(proposal_id);
    let mut proposal: Proposal = env.storage().persistent().get(&pkey).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &pkey);

    let gkey = DataKey::Group(proposal.group_id);
    let group: Group = env.storage().persistent().get(&gkey).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &gkey);

    if !group.members.iter().any(|m| m == voter) {
        return Err(Error::NotAMember);
    }
    if proposal.executed {
        return Err(Error::ProposalAlreadyExecuted);
    }

    let now = env.ledger().timestamp();
    if now >= proposal.voting_ends_at {
        return Err(Error::OperationExpired);
    }

    let already_voted = proposal.yes_voters.iter().any(|v| v == voter)
        || proposal.no_voters.iter().any(|v| v == voter);
    if already_voted {
        return Err(Error::AlreadyVoted);
    }

    if approve {
        proposal.yes_voters.push_back(voter.clone());
    } else {
        proposal.no_voters.push_back(voter.clone());
    }

    env.storage().persistent().set(&pkey, &proposal);
    storage::extend_persistent_ttl(env, &pkey);

    env.events().publish(
        (TOPIC_GROUP_VOTE_CAST, voter.clone(), proposal_id),
        (proposal_id, proposal.group_id, approve, now),
    );

    Ok(())
}

/// Settle `proposal_id` once its voting window has closed.
///
/// Permissionless once the window closes: any signed caller may trigger it —
/// on a pass the pool pays the proposal's recorded recipient, never the
/// caller. A proposal passes when the yes votes exceed half of all current
/// members (`yes * 2 > members`).
///
/// The outcome is recorded and the proposal marked executed, so a second call
/// fails with `ProposalAlreadyExecuted`. Returns whether the proposal passed.
///
/// Errors: `NotFound`, `ProposalAlreadyExecuted`, `TimeWindowNotOpen` (the
/// window is still open), `InsufficientGroupFunds` (the pool can no longer
/// cover the amount), `Overflow`.
pub fn execute(env: &Env, caller: Address, proposal_id: u64) -> Result<bool, Error> {
    extend_instance_ttl(env);
    require_not_paused(env)?;
    caller.require_auth();

    let pkey = DataKey::Proposal(proposal_id);
    let mut proposal: Proposal = env.storage().persistent().get(&pkey).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &pkey);

    if proposal.executed {
        return Err(Error::ProposalAlreadyExecuted);
    }

    let now = env.ledger().timestamp();
    if now < proposal.voting_ends_at {
        return Err(Error::TimeWindowNotOpen);
    }

    let gkey = DataKey::Group(proposal.group_id);
    let mut group: Group = env.storage().persistent().get(&gkey).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &gkey);

    let member_count = group.members.len();
    if member_count == 0 {
        return Err(Error::NotFound);
    }

    // Strict majority of all members: yes votes must be more than half.
    let yes_votes = proposal.yes_voters.len() as u64;
    let passed = yes_votes.checked_mul(2).ok_or(Error::Overflow)? > member_count as u64;

    // Checked before any state is written so a passed-but-underfunded proposal
    // leaves the record untouched (Soroban rolls back on error regardless, but
    // this keeps the intent explicit).
    if passed && proposal.amount > group.balance {
        return Err(Error::InsufficientGroupFunds);
    }

    proposal.executed = true;
    proposal.passed = passed;
    env.storage().persistent().set(&pkey, &proposal);
    storage::extend_persistent_ttl(env, &pkey);

    let mut spent: i128 = 0;
    if passed {
        storage::transfer_out(env, &proposal.recipient, proposal.amount)?;
        group.balance = group
            .balance
            .checked_sub(proposal.amount)
            .ok_or(Error::Overflow)?;
        env.storage().persistent().set(&gkey, &group);
        storage::extend_persistent_ttl(env, &gkey);
        spent = proposal.amount;
    }

    env.events().publish(
        (TOPIC_GROUP_PROPOSAL_EXECUTED, caller.clone(), proposal_id),
        (proposal_id, proposal.group_id, passed, spent, now),
    );

    Ok(passed)
}

/// Read a proposal by id.
pub fn get_proposal(env: &Env, proposal_id: u64) -> Result<Proposal, Error> {
    let key = DataKey::Proposal(proposal_id);
    let proposal = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    storage::extend_persistent_ttl(env, &key);
    Ok(proposal)
}

/// Allocate the next proposal id.
fn next_proposal_id(env: &Env) -> u64 {
    let key = DataKey::NextProposalId;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}
