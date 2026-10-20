//! Event topic registry.
//!
//! The off-chain indexer decodes contract events by topic. This module is
//! the canonical, compile-checked registry of topic name strings; the full
//! schema — data fields, types, encoding, and stability guarantees — is
//! documented in `README.md` under "Event schema". Keep the two in sync:
//! any change here (new topic, renamed topic) must be reflected there.
//!
//! Schema version: [`EVENT_SCHEMA_VERSION`]. Bump it whenever a change is
//! breaking for a decoder built against the previous version — see the
//! README's "Stability guarantees" for the exact rules.

/// Schema version for the event topics defined below, documented in
/// `README.md` ("Event schema"). A decoder should read this from the
/// `init` event's data payload to confirm it matches what it was built
/// against before trusting subsequent events on a given contract instance.
pub const EVENT_SCHEMA_VERSION: u32 = 1;

// --- lifecycle ---------------------------------------------------------
/// Emitted once, at the end of a successful `initialize` call.
pub const TOPIC_INIT: &str = "init";
/// Emitted at the end of a successful `set_admin` call.
pub const TOPIC_ADMIN_SET: &str = "admin_set";

// --- flexible ------------------------------------------------------------
/// Emitted at the end of a successful `deposit` call.
pub const TOPIC_DEPOSIT: &str = "deposit";
/// Emitted at the end of a successful `withdraw` call.
pub const TOPIC_WITHDRAW: &str = "withdraw";

// --- locked --------------------------------------------------------------
/// Emitted at the end of a successful `locked_create` call.
pub const TOPIC_LOCKED_CREATED: &str = "locked_created";
/// Emitted at the end of a successful `locked_top_up` call.
pub const TOPIC_LOCKED_TOP_UP: &str = "locked_top_up";
/// Emitted at the end of a successful `locked_withdraw` call.
pub const TOPIC_LOCKED_WITHDRAW: &str = "locked_withdraw";
/// Emitted at the end of a successful `locked_early_withdraw` call (a
/// penalized withdrawal before `unlock_at`).
pub const TOPIC_LOCKED_EARLY_WITHDRAW: &str = "locked_early_withdraw";

// --- goal ------------------------------------------------------------------
/// Emitted at the end of a successful `goal_create` call.
pub const TOPIC_GOAL_CREATED: &str = "goal_created";
/// Emitted on every successful `goal_contribute` call.
pub const TOPIC_GOAL_CONTRIBUTION: &str = "goal_contribution";
/// Emitted once, the first time a goal's `saved_amount` reaches
/// `target_amount` (may be co-emitted with `goal_contribution` in the same
/// `goal_contribute` call).
pub const TOPIC_GOAL_REACHED: &str = "goal_reached";
/// Emitted at the end of a successful `goal_claim` call.
pub const TOPIC_GOAL_CLAIMED: &str = "goal_claimed";
/// Emitted at the end of a successful `goal_set_auto_renew` call.
pub const TOPIC_GOAL_AUTO_RENEW_SET: &str = "goal_auto_renew_set";
/// Emitted when claiming an auto-renewing goal restarts it (co-emitted with
/// `goal_claimed` in the same `goal_claim` call).
pub const TOPIC_GOAL_RENEWED: &str = "goal_renewed";

// --- group -------------------------------------------------------------
/// Emitted at the end of a successful `group_create` call.
pub const TOPIC_GROUP_CREATED: &str = "group_created";
/// Emitted at the end of a successful `group_join` call.
pub const TOPIC_GROUP_JOINED: &str = "group_joined";
/// Emitted on every successful `group_contribute` call.
pub const TOPIC_GROUP_CONTRIBUTION: &str = "group_contribution";
/// Emitted at the end of a successful `group_close` call.
pub const TOPIC_GROUP_CLOSED: &str = "group_closed";
/// Emitted once per member during a successful `group_payout_equal` call.
pub const TOPIC_GROUP_PAYOUT: &str = "group_payout";

// --- group split -------------------------------------------------------
/// Emitted at the end of a successful `group_set_shares` call.
pub const TOPIC_GROUP_SHARES_SET: &str = "group_shares_set";
/// Emitted once per member during a successful `group_settle` call.
///
/// Topics: `(Symbol("group_split_settled"), member: Address, group_id: u64)`
/// Data:   `(group_id: u64, member: Address, amount: i128, timestamp: u64)`
pub const TOPIC_GROUP_SPLIT_SETTLED: &str = "group_split_settled";

// --- group voting ------------------------------------------------------
/// Emitted at the end of a successful `group_set_voting_period` call.
pub const TOPIC_GROUP_VOTING_PERIOD_SET: &str = "group_voting_period_set";
/// Emitted at the end of a successful `group_propose` call.
pub const TOPIC_GROUP_PROPOSAL_CREATED: &str = "group_proposal_created";
/// Emitted on every successful `group_vote` call.
pub const TOPIC_GROUP_VOTE_CAST: &str = "group_vote_cast";
/// Emitted at the end of a successful `group_execute` call, recording the
/// outcome (`passed`) and the amount actually paid out (`spent`, 0 on a fail).
pub const TOPIC_GROUP_PROPOSAL_EXECUTED: &str = "group_proposal_executed";

// --- interest ----------------------------------------------------------
/// Emitted at the end of a successful `set_interest_rate` call.
pub const TOPIC_INTEREST_RATE_SET: &str = "interest_rate_set";
/// Emitted at the end of a successful `set_interest_frequency` call.
pub const TOPIC_INTEREST_FREQUENCY_SET: &str = "interest_frequency_set";
/// Emitted at the end of a successful `interest_deposit` call.
pub const TOPIC_INTEREST_DEPOSIT: &str = "interest_deposit";
/// Emitted at the end of a successful `interest_withdraw` call.
pub const TOPIC_INTEREST_WITHDRAW: &str = "interest_withdraw";
/// Emitted at the end of a successful `interest_claim` call, recording the
/// interest credited to principal.
pub const TOPIC_INTEREST_CLAIMED: &str = "interest_claimed";
