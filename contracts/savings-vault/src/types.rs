use soroban_sdk::{contracttype, Address, Map, String, Vec};

/// A flexible savings account: deposit and withdraw any time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FlexibleAccount {
    pub owner: Address,
    /// Current balance held for this owner, in token stroops.
    pub balance: i128,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A locked savings plan: funds cannot be withdrawn until `unlock_at`.
#[contracttype]
#[derive(Clone)]
pub struct LockedPlan {
    pub id: u64,
    pub owner: Address,
    pub balance: i128,
    /// Ledger timestamp after which withdrawal is permitted.
    pub unlock_at: u64,
    pub created_at: u64,
}

/// A goal-based savings target with automated milestone tracking.
#[contracttype]
#[derive(Clone)]
pub struct Goal {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    pub target_amount: i128,
    pub saved_amount: i128,
    pub created_at: u64,
    /// Set when `saved_amount >= target_amount`.
    pub reached_at: Option<u64>,
    /// When true, claiming this goal restarts it instead of closing it:
    /// `saved_amount` is reset to 0 and `reached_at` is cleared, keeping the
    /// same id, name, and target so the owner can save toward it again.
    pub auto_renew: bool,
}

/// A group savings pool with shared rules and contract-enforced payouts.
#[contracttype]
#[derive(Clone)]
pub struct Group {
    pub id: u64,
    pub creator: Address,
    pub name: String,
    pub members: Vec<Address>,
    /// Total pooled balance.
    pub balance: i128,
    /// Per-member split in basis points (must sum to 10_000) for group-split payout.
    /// Empty for equal-split groups.
    pub shares_bps: Map<Address, u32>,
    pub open: bool,
    pub created_at: u64,
    /// Voting window, in seconds, for spending proposals on this group. Set
    /// by the creator via `group_set_voting_period`; `0` means proposals are
    /// disabled. See [`crate::voting`].
    pub voting_period: u64,
}

/// A member proposal to spend part of a group's pool.
///
/// Any member opens one via `group_propose`; members cast one vote each with
/// `group_vote` before `voting_ends_at`, and `group_execute` settles the
/// outcome once the window closes. See [`crate::voting`].
#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub group_id: u64,
    pub proposer: Address,
    /// Address that receives `amount` if the proposal passes.
    pub recipient: Address,
    pub amount: i128,
    /// Ledger timestamp at/after which voting is closed and `group_execute`
    /// may run.
    pub voting_ends_at: u64,
    /// Members who voted in favour (one entry each).
    pub yes_voters: Vec<Address>,
    /// Members who voted against (one entry each).
    pub no_voters: Vec<Address>,
    pub created_at: u64,
    /// Set once `group_execute` has settled this proposal (whether it passed
    /// or not), so it can never be executed twice.
    pub executed: bool,
    /// Outcome recorded by `group_execute`: true if the yes votes exceeded
    /// half of all members at execution time.
    pub passed: bool,
}

/// How often accrued interest is compounded on an [`InterestAccount`].
///
/// Each variant maps to a fixed period length ([`Self::period_seconds`]);
/// interest compounds once per whole elapsed period. The frequency is set
/// admin-wide via `interest_set_frequency`. See [`crate::interest`].
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CompoundFrequency {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Annually,
}

impl CompoundFrequency {
    /// Length of one compounding period, in seconds.
    pub fn period_seconds(&self) -> u64 {
        match self {
            CompoundFrequency::Daily => 86_400,
            CompoundFrequency::Weekly => 604_800,
            CompoundFrequency::Monthly => 2_592_000,
            CompoundFrequency::Quarterly => 7_776_000,
            CompoundFrequency::Annually => 31_536_000,
        }
    }

    /// Nominal number of compounding periods in a year. Used to derive the
    /// per-period rate from the annual rate (`annual_bps / periods_per_year`).
    pub fn periods_per_year(&self) -> u32 {
        match self {
            CompoundFrequency::Daily => 365,
            CompoundFrequency::Weekly => 52,
            CompoundFrequency::Monthly => 12,
            CompoundFrequency::Quarterly => 4,
            CompoundFrequency::Annually => 1,
        }
    }
}

/// An interest-bearing savings account. Its balance grows by compound
/// interest at the admin-configured annual rate and compounding frequency.
///
/// Interest is **lazy**: it is never written per period. Instead it is
/// derived on demand from `principal`, `last_compound_at`, and the account's
/// `rate_bps` / `frequency` snapshot, and only folded into `principal`
/// (compounding it) when the owner calls `interest_claim`, or on the next
/// deposit/withdraw. This keeps accrual gas-cheap regardless of how much
/// time has elapsed.
#[contracttype]
#[derive(Clone)]
pub struct InterestAccount {
    pub owner: Address,
    /// Compounded principal: deposits plus interest credited so far.
    pub principal: i128,
    /// Timestamp from which the next *uncredited* period accrues. Advances by
    /// whole periods only, so partial-period time is carried forward rather
    /// than discarded.
    pub last_compound_at: u64,
    /// Annual interest-rate snapshot, in basis points, captured when the
    /// account was last touched. Accrual uses this snapshot so a later admin
    /// rate change never re-prices time that has already accrued.
    pub rate_bps: u32,
    /// Compounding-frequency snapshot, captured alongside `rate_bps`.
    pub frequency: CompoundFrequency,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Storage keys. One variant per logical record family.
///
/// See `storage` module docs for the full storage model: durability
/// (instance vs. persistent), TTL policy, and cost implications per key.
/// Every variant below is documented with its durability + TTL at a glance;
/// treat the `storage` module doc as the canonical source if the two ever
/// disagree.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Global config / initialization guard.
    ///
    /// Durability: instance. TTL: bumped on every state-changing call via
    /// `extend_instance_ttl`. Currently unused as a standalone key — kept
    /// reserved for future config fields that don't warrant their own key.
    Config,
    /// The SEP-41 token (e.g. USDC) this vault holds.
    ///
    /// Durability: instance (one value, read on almost every entrypoint —
    /// instance storage is cheapest for hot, small, singleton data). TTL:
    /// bumped alongside the rest of instance storage; never expires as long
    /// as *any* mutation happens within the bump window.
    Token,
    /// Contract admin.
    ///
    /// Durability: instance, for the same reason as `Token`. TTL: same as
    /// `Token`.
    Admin,
    /// Emergency-pause flag. Absent/false means unpaused.
    Paused,
    /// Admin-configured per-account deposit cap, in token stroops. Absent
    /// (or `0`) means unlimited. See [`crate::admin::deposit_cap`].
    ///
    /// Durability: instance — a single scalar read on every `deposit`. TTL:
    /// bumped alongside the rest of instance storage.
    DepositCap,
    /// Admin-configured minimum deposit amount, in token stroops. Absent
    /// (or `0`) means no minimum. See [`crate::admin::min_deposit`].
    ///
    /// Durability: instance — a single scalar read on every `deposit`. TTL:
    /// bumped alongside the rest of instance storage.
    MinDeposit,
    /// Monotonic counters for plan/goal/group ids.
    ///
    /// Durability: instance — small, hot counters incremented on every
    /// `create`. TTL: bumped alongside the rest of instance storage.
    NextLockedId,
    NextGoalId,
    NextGroupId,
    /// `FlexibleAccount` by owner.
    ///
    /// Durability: persistent — one entry per user, unbounded key space, not
    /// appropriate for instance storage. TTL: **not currently bumped** by
    /// per-entry logic; relies on being re-written (which refreshes TTL) on
    /// every deposit/withdraw. An account that goes untouched for longer
    /// than the persistent minimum TTL could be archived; restoring it
    /// requires `extend_ttl`/`restore` before the next read. See the
    /// `storage` module doc for the tracked follow-up.
    Flexible(Address),
    /// `LockedPlan` by id.
    ///
    /// Durability: persistent — unbounded key space (one per plan).
    /// TTL: refreshed implicitly on `top_up`/`withdraw` writes; the same
    /// archival caveat as `Flexible` applies to long-dormant plans.
    Locked(u64),
    /// Goal by id.
    ///
    /// Durability: persistent, for the same reason as `Locked`. TTL: same
    /// caveat — refreshed only when written.
    Goal(u64),
    /// Group by id.
    ///
    /// Durability: persistent. TTL: same caveat as above.
    ///
    /// Cost note: a `Group` record embeds the *entire* `members: Vec<Address>`
    /// and `shares_bps: Map<Address, u32>` in one entry. Every `join`,
    /// `contribute`, or `set_shares` call reads and rewrites the whole
    /// entry, so write cost (and the rent needed to keep its TTL alive)
    /// grows linearly with membership size. There is currently no cap on
    /// group size — very large groups pay progressively more per mutation
    /// and are more expensive to keep alive.
    Group(u64),
    /// Admin-configured penalty charged on an early locked withdrawal, in
    /// basis points (1/100 of a percent) of the withdrawn amount. Absent (or
    /// `0`) means no penalty. See [`crate::admin::early_withdraw_penalty_bps`].
    ///
    /// Durability: instance — read on every `locked_early_withdraw`. TTL:
    /// bumped alongside the rest of instance storage.
    ///
    /// Appended after the id-keyed variants on purpose: `DataKey` is encoded
    /// by variant order, so new keys are added at the end to avoid shifting
    /// the case index of existing stored keys.
    EarlyWithdrawPenaltyBps,
    /// Address that receives early-withdrawal penalties. Absent means the
    /// penalty is paid to the current admin. See
    /// [`crate::admin::penalty_recipient`].
    ///
    /// Durability: instance — read on every `locked_early_withdraw`. TTL:
    /// bumped alongside the rest of instance storage.
    PenaltyRecipient,
    /// Minimum time, in seconds, a locked plan must have been locked before a
    /// penalized early withdrawal is allowed. Absent (or `0`) means no
    /// minimum. See [`crate::admin::min_lock_period`].
    ///
    /// Durability: instance — read on every `locked_early_withdraw`. TTL:
    /// bumped alongside the rest of instance storage.
    MinLockPeriod,
    /// `Proposal` by id.
    ///
    /// Durability: persistent — one entry per proposal. TTL: bumped on every
    /// read/write via `extend_persistent_ttl`.
    Proposal(u64),
    /// Monotonic counter for proposal ids.
    ///
    /// Durability: instance — small, hot counter incremented on every
    /// `group_propose`. TTL: bumped alongside the rest of instance storage.
    NextProposalId,
    /// `InterestAccount` by owner.
    ///
    /// Durability: persistent — one entry per owner. TTL: bumped on every
    /// read/write via `extend_persistent_ttl`.
    InterestAccount(Address),
    /// Admin-configured annual interest rate, in basis points. Absent (or
    /// `0`) means no interest accrues. See [`crate::interest::set_rate`].
    ///
    /// Durability: instance — read on every interest accrual. TTL: bumped
    /// alongside the rest of instance storage.
    InterestRateBps,
    /// Admin-configured compounding frequency applied to new/touched
    /// interest accounts. Absent defaults to
    /// [`CompoundFrequency::Annually`]. See [`crate::interest::set_frequency`].
    ///
    /// Durability: instance. TTL: same as `InterestRateBps`.
    InterestFrequency,
}
