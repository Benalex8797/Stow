# savings-vault

Non-custodial savings vault for **Stow**, on Stellar/Soroban (Rust, `soroban-sdk` 22).

This crate is a **skeleton**. Every entrypoint is stubbed with `unimplemented!()`
and a `TODO(issue)` comment describing intended behavior and acceptance criteria.
Each stub is designed to become one GitHub issue. The reference below documents
the contract's intended, stable interface so integrators (indexer, backend,
frontend) can build against it without reading the stub bodies.

## Contents

- [Module → issue map](#module--issue-map)
- [Layout](#layout)
- [Build & test](#build--test)
- [Wasm size budget & optimization](#wasm-size-budget--optimization)
- [Testnet deployment](#testnet-deployment)
- [Entrypoint reference](#entrypoint-reference)
- [Event schema](#event-schema)

## Module → issue map

| Module | Entrypoints | Suggested issues |
| --- | --- | --- |
| `admin` | `initialize`, `token`, `set_admin`, `set_deposit_cap`, `set_min_deposit`, `set_early_withdraw_penalty_bps`, `set_penalty_recipient`, `set_min_lock_period`, `upgrade` | init guard, token config, admin rotation, deposit cap, minimum deposit, early-withdrawal penalty + recipient + minimum lock period, contract upgrade |
| `storage` | TTL + accessors | storage helpers, TTL tuning, id allocation |
| `flexible` | `deposit`, `withdraw`, `get_account` | one issue each |
| `locked` | `create`, `top_up`, `withdraw`, `early_withdraw`, `plan` | create + time-lock enforcement, top-up, withdraw, early partial withdrawal |
| `goal` | `create`, `contribute`, `claim`, `set_auto_renew`, `goal` | create, contribute + milestone, claim, auto-renewal |
| `group` | `create`, `join`, `contribute`, `close`, `payout_equal` | one issue each |
| `group_split` | `set_shares`, `settle` | shares validation, weighted settlement |
| `voting` | `set_voting_period`, `propose`, `vote`, `execute`, `proposal` | proposal creation, voting period, execution |
| `interest` | `set_rate`, `rate_bps`, `set_frequency`, `frequency`, `deposit`, `withdraw`, `claim`, `get_account`, `accrued` | rate + frequency config, deposit/withdraw, lazy compound accrual |
| `events` | typed publishers | one issue per event topic |
| `test` | integration tests | one issue per `#[ignore]`d test |

## Layout

```text
src/
  lib.rs         # contract + entrypoints (delegates to modules)
  types.rs       # data structures + DataKey storage keys
  storage.rs     # storage/TTL helpers
  admin.rs       # init + admin
  flexible.rs    # flexible savings
  locked.rs      # locked savings
  goal.rs        # goal-based savings
  group.rs       # group pools
  group_split.rs # weighted group settlement
  voting.rs      # group spending proposals + voting
  interest.rs    # interest-bearing accounts + compound accrual
  events.rs      # event topic registry (see "Event schema" below)
  test.rs        # test skeleton
```

## Build & test

```bash
cargo build --target wasm32-unknown-unknown --release
cargo test           # placeholder tests are #[ignore]d until implemented
```

> Note: entrypoints currently `unimplemented!()` — they compile but panic at
> runtime until a contributor implements them. The signatures, auth rules,
> errors, and events below are the contract this crate implements against;
> implementations must not deviate from them without updating this doc.

## Wasm size budget & optimization

CI builds the release wasm, runs `stellar contract optimize` against it, and
fails the build if the **optimized** wasm exceeds a size budget. This catches
size regressions before they reach a deployed contract.

The current budget is `65536` bytes (64 KiB), set via `WASM_SIZE_BUDGET_BYTES`
in the `savings-vault` job's `env:` block in
[`.github/workflows/contract-ci.yml`](../../.github/workflows/contract-ci.yml).
Raise it only alongside a deliberate decision to accept the size increase —
e.g. a new savings mechanism or a larger dependency — not as a routine fix
for a failing build.

To check locally:

```bash
cargo build --target wasm32-unknown-unknown --release
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/savings_vault.wasm \
  --wasm-out target/wasm32-unknown-unknown/release/savings_vault.optimized.wasm
wc -c target/wasm32-unknown-unknown/release/savings_vault.optimized.wasm
```

## Testnet deployment

[`scripts/deploy_testnet.sh`](scripts/deploy_testnet.sh) builds, deploys, and
initializes the vault on Stellar testnet in one command, then prints the
deployed contract id:

```bash
SOURCE_ACCOUNT=alice ./scripts/deploy_testnet.sh
```

`SOURCE_ACCOUNT` must name a funded Stellar CLI identity (create one with
`stellar keys generate --fund --network testnet alice`). By default the
script wraps native XLM as the vault's token, since it's always available on
testnet with no setup. Env vars:

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SOURCE_ACCOUNT` | yes | — | Identity that deploys, pays fees, and becomes admin unless overridden. |
| `ADMIN_ACCOUNT` | no | `SOURCE_ACCOUNT`'s address | Address set as the vault admin. |
| `TOKEN_CONTRACT_ID` | no | — | Use an already-deployed SEP-41 token instead of wrapping an asset. |
| `TEST_ASSET` | no | `native` | Classic asset to wrap as the vault's token, as `CODE:ISSUER`. |
| `STELLAR_NETWORK` | no | `testnet` | Network passed to the Stellar CLI. |

---

## Entrypoint reference

All amounts are `i128` in the vault token's smallest unit (stroops for a
7-decimal SEP-41 token). All timestamps are `u64` ledger timestamps (seconds
since epoch, per `env.ledger().timestamp()`). Every entrypoint that mutates
state calls `require_auth()` on the address noted in **Auth** — the caller
must sign as that address (or hold a valid signature delegation for it).
Every entrypoint returns `Result<T, Error>`; see [`src/error.rs`](src/error.rs)
for the full, stable error enum (`Error` codes are append-only — safe to
match on by numeric discriminant).

Invocation examples use the `stellar` CLI against a deployed instance:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- <function> --arg value ...
```

### Lifecycle

#### `initialize(admin: Address, token: Address) -> Result<(), Error>`
- **Auth:** none enforced by the contract; call once, immediately after
  deploy, from your deploy pipeline's identity.
- **Errors:** `AlreadyInitialized` if called a second time.
- **Events:** [`init`](#init).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- initialize \
  --admin GADMIN...ADDRESS \
  --token GTOKEN...ADDRESS
```

#### `token() -> Result<Address, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotInitialized`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- token
```

#### `set_admin(new_admin: Address) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `Unauthorized` if the caller is not the
  current admin.
- **Events:** [`admin_set`](#admin_set).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_admin --new_admin GNEWADMIN...ADDRESS
```

#### `deposit_cap() -> i128`
- **Auth:** none (read-only).
- **Returns:** the current per-account deposit cap, in token stroops. `0`
  means unlimited (the default before `set_deposit_cap` is ever called).
- **Errors:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- deposit_cap
```

#### `set_deposit_cap(cap: i128) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `InvalidAmount` if `cap < 0`.
- Takes effect immediately — the next `deposit` call is checked against the
  new value.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_deposit_cap --cap 1000000000
```

#### `min_deposit() -> i128`
- **Auth:** none (read-only).
- **Returns:** the current minimum deposit amount, in token stroops. `0`
  means no minimum (the default before `set_min_deposit` is ever called).
- **Errors:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- min_deposit
```

#### `set_min_deposit(min: i128) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `InvalidAmount` if `min < 0`.
- Takes effect immediately — the next `deposit` call is checked against the
  new value. Guards against dust deposits that waste storage.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_min_deposit --min 10000000
```

#### `early_withdraw_penalty_bps() -> u32`
- **Auth:** none (read-only).
- **Errors:** none.
- The penalty charged on an early locked withdrawal, in basis points (1/100
  of a percent). Defaults to `0` (no penalty) before
  `set_early_withdraw_penalty_bps` is ever called.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- early_withdraw_penalty_bps
```

#### `set_early_withdraw_penalty_bps(bps: u32) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `InvalidParameters` if `bps > 10_000` (a
  penalty above 100%).
- Takes effect immediately — the next `locked_early_withdraw` call is
  charged the new rate. `0` disables the penalty.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_early_withdraw_penalty_bps --bps 500
```

#### `penalty_recipient() -> Result<Address, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotInitialized` if neither a recipient nor an admin is set.
- The address that receives early-withdrawal penalties. Defaults to the
  current admin until `set_penalty_recipient` is called.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- penalty_recipient
```

#### `set_penalty_recipient(recipient: Address) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`.
- Sets the address that receives early-withdrawal penalties.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_penalty_recipient --recipient GTREASURY...ADDRESS
```

#### `min_lock_period() -> u64`
- **Auth:** none (read-only).
- **Errors:** none.
- The minimum time, in seconds, a locked plan must have been locked before a
  penalized early withdrawal is allowed. Defaults to `0` (no minimum) before
  `set_min_lock_period` is ever called.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- min_lock_period
```

#### `set_min_lock_period(seconds: u64) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`.
- Takes effect immediately — the next `locked_early_withdraw` call is checked
  against the new value. `0` disables the minimum.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_min_lock_period --seconds 604800
```

#### `upgrade(caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `Unauthorized` if the caller is not the
  current admin.
- `new_wasm_hash` must already be uploaded to the ledger (e.g. via
  `stellar contract upload` or `Deployer::upload_contract_wasm`); this swaps
  the contract's currently-installed code for that Wasm. The swap takes
  effect after this invocation finishes; storage is **not** migrated —
  the new Wasm must stay compatible with existing persisted `DataKey`
  records or migrate them itself on next write.
- **Trust trade-off:** this gives the admin key total, unchecked control
  over the contract's logic, including the rules governing custodied
  funds — there is no on-chain check that a new Wasm preserves any
  invariant the old one had. It is deliberate for now (it lets bugs be
  patched post-deploy without a new contract address), but it means
  depositors trust the admin key's operational security as much as the
  code itself. A timelock and/or a multisig admin are tracked as follow-up
  hardening, not part of this issue.
- **Before upgrading:** work through the
  [upgrade safety checklist](../UPGRADE_CHECKLIST.md), which covers storage
  layout compatibility, entrypoint (selector) collisions and initialization.
- **Events:** [`upgraded`](#upgraded).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- upgrade --caller GADMIN...ADDRESS --new_wasm_hash <64-char-hex-hash>
```

### Flexible savings — deposit / withdraw any time

#### `deposit(from: Address, amount: i128) -> Result<(), Error>`
- **Auth:** `from`.
- **Errors:** `InvalidAmount` if `amount <= 0`, `NotInitialized`,
  `DepositCapExceeded` if the admin-configured per-account cap
  (`deposit_cap`, set via `set_deposit_cap`) is non-zero and the resulting
  balance would exceed it, `Overflow` if the resulting balance would not
  fit in `i128`.
- **Events:** [`deposit`](#deposit).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- deposit --from GALICE...ADDRESS --amount 1000000000
```

#### `withdraw(owner: Address, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound` if no account exists for `owner`, `InvalidAmount`,
  `InsufficientBalance` if `amount` exceeds the account balance, `Overflow`
  (defensive; unreachable in practice since the balance check runs first).
- **Events:** [`withdraw`](#withdraw).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- withdraw --owner GALICE...ADDRESS --amount 500000000
```

#### `get_account(owner: Address) -> Result<FlexibleAccount, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- get_account --owner GALICE...ADDRESS
```

### Locked savings — deterministic on-chain time locks

#### `locked_create(owner: Address, amount: i128, unlock_at: u64) -> Result<u64, Error>`
- **Auth:** `owner`.
- **Errors:** `InvalidAmount`, `InvalidUnlockTime` if `unlock_at <= now`.
- **Returns:** the new plan id.
- **Events:** [`locked_created`](#locked_created).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- locked_create --owner GALICE...ADDRESS --amount 2000000000 --unlock_at 1798761600
```

#### `locked_top_up(owner: Address, plan_id: u64, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Unauthorized` if `owner` does not own `plan_id`,
  `InvalidAmount`, `Overflow` if the resulting balance would not fit in
  `i128`.
- **Events:** [`locked_top_up`](#locked_top_up).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- locked_top_up --owner GALICE...ADDRESS --plan_id 1 --amount 500000000
```

#### `locked_withdraw(owner: Address, plan_id: u64, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Unauthorized`, `InsufficientBalance` (checked
  before `StillLocked` so callers get the more actionable error when both
  conditions hold), `StillLocked` if `now < unlock_at`, `InvalidAmount`,
  `Overflow` (defensive; unreachable in practice since the balance check
  runs first).
- **Events:** [`locked_withdraw`](#locked_withdraw).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- locked_withdraw --owner GALICE...ADDRESS --plan_id 1 --amount 2500000000
```

#### `locked_early_withdraw(owner: Address, plan_id: u64, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Unauthorized`, `InsufficientBalance` if
  over-withdrawing, `TimeWindowNotOpen` if the minimum lock period has not
  yet elapsed, `OperationExpired` once `unlock_at` has passed (use
  `locked_withdraw` instead), `InvalidAmount`, `Overflow`.
- Withdraws part of a **still-locked** balance early, charging an
  admin-configured penalty on the withdrawn amount. The owner receives
  `amount − penalty`; the penalty goes to the configured
  [penalty recipient](#penalty_recipient-address). The plan is not closed — it
  keeps the reduced balance and can be withdrawn from again.
- The valid early-withdrawal window is
  `[created_at + min_lock_period, unlock_at)`; see
  [`min_lock_period`](#min_lock_period-u64) and
  [`early_withdraw_penalty_bps`](#early_withdraw_penalty_bps-u32).
- **Events:** [`locked_early_withdraw`](#locked_early_withdraw).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- locked_early_withdraw --owner GALICE...ADDRESS --plan_id 1 --amount 1000000000
```

#### `locked_plan(plan_id: u64) -> Result<LockedPlan, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- locked_plan --plan_id 1
```

### Goal savings — save toward a target with milestones

#### `goal_create(owner: Address, name: String, target_amount: i128) -> Result<u64, Error>`
- **Auth:** `owner`.
- **Errors:** `InvalidAmount` if `target_amount <= 0`.
- **Returns:** the new goal id.
- **Events:** [`goal_created`](#goal_created).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- goal_create --owner GALICE...ADDRESS --name "New laptop" --target_amount 5000000000
```

#### `goal_contribute(from: Address, goal_id: u64, amount: i128) -> Result<(), Error>`
- **Auth:** `from`.
- **Errors:** `NotFound`, `InvalidAmount`.
- **Events:** [`goal_contribution`](#goal_contribution), plus
  [`goal_reached`](#goal_reached) the call that first crosses `target_amount`.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- goal_contribute --from GALICE...ADDRESS --goal_id 1 --amount 1000000000
```

#### `goal_claim(owner: Address, goal_id: u64) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Unauthorized`, `GoalNotReached` if `reached_at`
  is unset.
- **Events:** [`goal_claimed`](#goal_claimed), plus
  [`goal_renewed`](#goal_renewed) when the goal has `auto_renew` enabled.
- **Note:** when `auto_renew` is enabled, the goal is restarted instead of
  closed — `saved_amount` resets to 0 and `reached_at` clears, keeping the
  same id, name, and target.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- goal_claim --owner GALICE...ADDRESS --goal_id 1
```

#### `goal_set_auto_renew(owner: Address, goal_id: u64, auto_renew: bool) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Unauthorized`.
- **Events:** [`goal_auto_renew_set`](#goal_auto_renew_set).
- **Note:** with `auto_renew` enabled, `goal_claim` restarts the goal rather
  than closing it, so the owner can save toward the same target again.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- goal_set_auto_renew --owner GALICE...ADDRESS --goal_id 1 --auto_renew true
```

#### `goal(goal_id: u64) -> Result<Goal, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- goal --goal_id 1
```

### Group savings — shared pools, equal payout

#### `group_create(creator: Address, name: String) -> Result<u64, Error>`
- **Auth:** `creator`.
- **Errors:** none beyond generic validation.
- **Returns:** the new group id; `creator` is the first member.
- **Events:** [`group_created`](#group_created).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_create --creator GALICE...ADDRESS --name "Vacation fund"
```

#### `group_join(member: Address, group_id: u64) -> Result<(), Error>`
- **Auth:** `member`.
- **Errors:** `NotFound`, `GroupClosed` if the group no longer accepts
  members.
- **Events:** [`group_joined`](#group_joined).
```bash
stellar contract invoke --id $CONTRACT_ID --source bob --network testnet \
  -- group_join --member GBOB...ADDRESS --group_id 1
```

#### `group_contribute(member: Address, group_id: u64, amount: i128) -> Result<(), Error>`
- **Auth:** `member`.
- **Errors:** `NotFound`, `NotAMember` if the caller has not joined,
  `InvalidAmount`.
- **Events:** [`group_contribution`](#group_contribution).
```bash
stellar contract invoke --id $CONTRACT_ID --source bob --network testnet \
  -- group_contribute --member GBOB...ADDRESS --group_id 1 --amount 1000000000
```

#### `group_close(creator: Address, group_id: u64) -> Result<(), Error>`
- **Auth:** `creator`.
- **Errors:** `NotFound`, `Unauthorized` if the caller is not the creator.
- **Events:** [`group_closed`](#group_closed).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_close --creator GALICE...ADDRESS --group_id 1
```

#### `group_payout_equal(caller: Address, group_id: u64) -> Result<(), Error>`
- **Auth:** `caller` — permissionless once the group is closed; any account
  can trigger settlement.
- **Errors:** `NotFound`, `GroupClosed` if the group has not been closed yet.
- **Events:** [`group_payout`](#group_payout), once per member.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_payout_equal --caller GALICE...ADDRESS --group_id 1
```

#### `group(group_id: u64) -> Result<Group, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group --group_id 1
```

### Group-split savings — pool settled by agreed shares

Shares are basis points (`u32`, out of `10_000`) keyed by member `Address`;
see `group_split::TOTAL_BPS`.

#### `group_set_shares(creator: Address, group_id: u64, shares_bps: Map<Address, u32>) -> Result<(), Error>`
- **Auth:** `creator`; group must already be closed (`group_close`).
- **Errors:** `NotFound`, `Unauthorized`, `InvalidShares` if the values
  don't sum to exactly `10_000` or a key is not a group member.
- **Events:** [`group_shares_set`](#group_shares_set).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_set_shares --creator GALICE...ADDRESS --group_id 1 \
  --shares_bps '{"GALICE...ADDRESS":6000,"GBOB...ADDRESS":4000}'
```

#### `group_settle(caller: Address, group_id: u64) -> Result<(), Error>`
- **Auth:** `caller` — permissionless once shares are set.
- **Errors:** `NotFound`, `InvalidShares` if shares were never configured,
  `Overflow` if a per-member share computation would not fit in `i128`.
- **Events:** [`group_split_settled`](#group_split_settled), once per member.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_settle --caller GALICE...ADDRESS --group_id 1
```

### Group voting — members vote to spend the pool

Members decide how to spend a closed group's pool. The creator configures a
voting window, any member opens a spending proposal, members cast one vote
each, and once the window closes anyone can settle the outcome. A proposal
passes when the yes votes are a **strict majority of all members**
(`yes * 2 > members`). Proposals require the group to be closed (via
`group_close`), which freezes the membership set so the threshold can't move
mid-vote.

#### `group_set_voting_period(creator: Address, group_id: u64, seconds: u64) -> Result<(), Error>`
- **Auth:** `creator`; group must exist and the caller must be its creator.
- **Errors:** `NotFound`, `Unauthorized`.
- Sets the voting window, in seconds, applied to proposals opened afterwards
  (`voting_ends_at = now + seconds`). `0` disables proposals for the group.
- **Events:** [`group_voting_period_set`](#group_voting_period_set).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_set_voting_period --creator GALICE...ADDRESS --group_id 1 --seconds 604800
```

#### `group_propose(proposer: Address, group_id: u64, recipient: Address, amount: i128) -> Result<u64, Error>`
- **Auth:** `proposer`; must be a current member.
- **Errors:** `InvalidAmount` if `amount <= 0`, `NotFound`, `NotAMember`,
  `GroupClosed` if the group is still open, `InvalidParameters` if no voting
  period is configured, `InsufficientGroupFunds` if `amount` exceeds the pool.
- **Returns:** the new proposal id. The voting window runs until
  `now + voting_period`.
- **Events:** [`group_proposal_created`](#group_proposal_created).
```bash
stellar contract invoke --id $CONTRACT_ID --source bob --network testnet \
  -- group_propose --proposer GBOB...ADDRESS --group_id 1 \
  --recipient GRECIPIENT...ADDRESS --amount 500000000
```

#### `group_vote(voter: Address, proposal_id: u64, approve: bool) -> Result<(), Error>`
- **Auth:** `voter`; must be a current member.
- **Errors:** `NotFound`, `NotAMember`, `ProposalAlreadyExecuted`,
  `OperationExpired` once the window has closed, `AlreadyVoted` if the member
  has already voted.
- Each member may vote exactly once, either way, while the window is open.
- **Events:** [`group_vote_cast`](#group_vote_cast).
```bash
stellar contract invoke --id $CONTRACT_ID --source bob --network testnet \
  -- group_vote --voter GBOB...ADDRESS --proposal_id 1 --approve true
```

#### `group_execute(caller: Address, proposal_id: u64) -> Result<bool, Error>`
- **Auth:** `caller` — permissionless once the window has closed; any signed
  caller may trigger settlement. On a pass the pool pays the proposal's
  recorded recipient, never the caller.
- **Errors:** `NotFound`, `ProposalAlreadyExecuted`, `TimeWindowNotOpen` if
  the window is still open, `InsufficientGroupFunds` if the pool can no longer
  cover the amount.
- **Returns:** whether the proposal passed. The outcome is recorded and the
  proposal marked executed, so a second call fails with
  `ProposalAlreadyExecuted`.
- **Events:** [`group_proposal_executed`](#group_proposal_executed).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_execute --caller GALICE...ADDRESS --proposal_id 1
```

#### `group_proposal(proposal_id: u64) -> Result<Proposal, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- group_proposal --proposal_id 1
```

### Interest-bearing savings — compound interest

An interest account grows by **compound interest** at an admin-configured
annual rate (`set_interest_rate`, basis points) and compounding frequency
(`set_interest_frequency`). Interest is **lazy**: nothing is written per
period — accrued interest is derived on demand and folded into the
principal only when the owner calls `interest_claim`, or on the next
`interest_deposit`/`interest_withdraw`.

For each whole compounding period elapsed since the account's last
compound, the principal is multiplied by `(1 + r)`, where `r` is the
per-period rate derived from the annual rate:
`r = rate_bps / (10_000 * periods_per_year)`. Partial periods do not accrue,
but their time is carried forward. The `n`-period growth is computed by
exponentiation by squaring (`O(log n)` multiplications), and multiplies go
through a 256-bit intermediate, so a valid computation never overflows.
Every step rounds **down**, so the contract never over-credits.

Each account snapshots the rate and frequency when it is touched; accrual
always uses the snapshot, so an admin rate/frequency change never re-prices
time that has already accrued — the new setting applies from the account's
next touch onward.

#### `set_interest_rate(caller: Address, rate_bps: u32) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `Unauthorized` if the caller is not the
  admin, `InvalidParameters` if `rate_bps > 10_000` (a rate above 100%).
- Sets the global annual interest rate, in basis points (`0` disables
  interest). Applies to accounts from their next touch onward; it never
  re-prices already-accrued time.
- **Events:** [`interest_rate_set`](#interest_rate_set).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_interest_rate --caller GADMIN...ADDRESS --rate_bps 500
```

#### `interest_rate_bps() -> u32`
- **Auth:** none (read-only).
- **Returns:** the current annual interest rate, in basis points. `0` means
  no interest (the default before `set_interest_rate` is ever called).
- **Errors:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_rate_bps
```

#### `set_interest_frequency(caller: Address, frequency: CompoundFrequency) -> Result<(), Error>`
- **Auth:** current admin.
- **Errors:** `NotInitialized`, `Unauthorized` if the caller is not the
  admin.
- Sets the global compounding frequency. Applies to accounts from their next
  touch onward.
- **Events:** [`interest_frequency_set`](#interest_frequency_set).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- set_interest_frequency --caller GADMIN...ADDRESS --frequency Monthly
```

#### `interest_frequency() -> CompoundFrequency`
- **Auth:** none (read-only).
- **Returns:** the current compounding frequency. Defaults to `Annually`
  before `set_interest_frequency` is ever called. `CompoundFrequency` is one
  of `Daily` (365/yr), `Weekly` (52/yr), `Monthly` (12/yr), `Quarterly`
  (4/yr), `Annually` (1/yr).
- **Errors:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_frequency
```

#### `interest_deposit(owner: Address, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `InvalidAmount` if `amount <= 0`, `Overflow` if the resulting
  principal would not fit in `i128`, plus the vault's transfer errors.
- Creates the account on first deposit; settles accrued interest into the
  principal first, then adds `amount`. The account adopts the latest global
  rate/frequency from this call onward.
- **Events:** [`interest_deposit`](#interest_deposit).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_deposit --owner GALICE...ADDRESS --amount 1000000000
```

#### `interest_withdraw(owner: Address, amount: i128) -> Result<(), Error>`
- **Auth:** `owner`.
- **Errors:** `InvalidAmount` if `amount <= 0`, `NotFound` if no account
  exists for `owner`, `InsufficientBalance` if `amount` exceeds the settled
  principal.
- Settles accrued interest into the principal first, so `amount` may draw on
  interest credited since the last touch, then transfers `amount` out.
- **Events:** [`interest_withdraw`](#interest_withdraw).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_withdraw --owner GALICE...ADDRESS --amount 500000000
```

#### `interest_claim(owner: Address) -> Result<i128, Error>`
- **Auth:** `owner`.
- **Errors:** `NotFound`, `Overflow`.
- **Returns:** the interest credited this call. Idempotent between
  compounding periods — a second call before the next period elapses returns
  `0`. Credited interest becomes part of the principal, so it compounds on
  subsequent periods.
- **Events:** [`interest_claimed`](#interest_claimed).
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_claim --owner GALICE...ADDRESS
```

#### `interest_account(owner: Address) -> Result<InterestAccount, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`.
- **Returns:** the stored `InterestAccount` — `owner`, `principal`,
  `last_compound_at`, the snapshotted `rate_bps` and `frequency`, and
  `created_at`/`updated_at`.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_account --owner GALICE...ADDRESS
```

#### `interest_accrued(owner: Address) -> Result<i128, Error>`
- **Auth:** none (read-only).
- **Errors:** `NotFound`, `Overflow`.
- **Returns:** the interest accrued but not yet credited — a read-only
  preview of what `interest_claim` would credit now.
- **Events:** none.
```bash
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- interest_accrued --owner GALICE...ADDRESS
```

---

## Event schema

**Version: `1`** (see [`events::EVENT_SCHEMA_VERSION`](src/events.rs)). The
[`init`](#init) event's data payload includes `schema_version` so an indexer
can assert it was built against a compatible schema before decoding
subsequent events from that contract instance.

### Stability guarantees

- **Topic names are stable identifiers.** Once shipped, a topic name is
  never renamed or reused for a different meaning.
- **Additive changes do not bump the version:** a new topic, or a new
  *trailing* field appended to an existing topic's data tuple, is
  backwards-compatible — existing decoders keep working, they just ignore
  the new field.
- **Breaking changes bump `EVENT_SCHEMA_VERSION`** and are called out in
  this section: removing a topic, removing or reordering an existing
  field, or changing a field's type.
- Field order within an event's data tuple is part of the schema — decode
  positionally, not by name.
- All events are best-effort ordering *within* a single contract
  invocation (topic emission order matches the order described below);
  cross-invocation ordering follows ledger close order.

### Encoding

Every event is published as `env.events().publish(topics, data)`:

- **Topics** — a tuple whose first element is always a `Symbol` naming the
  event (the constants in `src/events.rs`, e.g. `"deposit"`). Names longer
  than 9 characters use `Symbol::new`, not `symbol_short!`. Where noted, a
  second topic carries the primary subject `Address` and, for id-addressed
  records (locked plans, goals, groups), a third topic carries the `u64`
  id — both so indexers can filter server-side (`topic1 == owner`) without
  decoding every event's data.
- **Data** — a fixed-order tuple of the remaining fields, typed per the
  tables below. `Address`, `String`, `Map<Address, u32>` etc. decode as
  their standard Soroban XDR `ScVal` representations.

### Topics

#### `init`
Topics: `(Symbol("init"),)`

| Field | Type | Description |
| --- | --- | --- |
| `admin` | `Address` | Initial admin. |
| `token` | `Address` | SEP-41 token this vault custodies. |
| `schema_version` | `u32` | Value of `EVENT_SCHEMA_VERSION` at deploy time. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `admin_set`
Topics: `(Symbol("admin_set"),)`

| Field | Type | Description |
| --- | --- | --- |
| `previous_admin` | `Address` | Admin before rotation. |
| `new_admin` | `Address` | Admin after rotation. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `upgraded`
Topics: `(Symbol("upgraded"),)`

| Field | Type | Description |
| --- | --- | --- |
| `caller` | `Address` | Admin who triggered the upgrade. |
| `new_wasm_hash` | `BytesN<32>` | Hash of the newly-installed Wasm. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `deposit`
Topics: `(Symbol("deposit"), owner: Address)`

| Field | Type | Description |
| --- | --- | --- |
| `owner` | `Address` | Flexible account owner. |
| `amount` | `i128` | Amount deposited. |
| `balance` | `i128` | Resulting account balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `withdraw`
Topics: `(Symbol("withdraw"), owner: Address)`

| Field | Type | Description |
| --- | --- | --- |
| `owner` | `Address` | Flexible account owner. |
| `amount` | `i128` | Amount withdrawn. |
| `balance` | `i128` | Resulting account balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `locked_created`
Topics: `(Symbol("locked_created"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | New plan id. |
| `owner` | `Address` | Plan owner. |
| `amount` | `i128` | Initial funded amount. |
| `unlock_at` | `u64` | Ledger timestamp after which withdrawal is allowed. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `locked_top_up`
Topics: `(Symbol("locked_top_up"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Plan id. |
| `owner` | `Address` | Plan owner. |
| `amount` | `i128` | Amount added. |
| `balance` | `i128` | Resulting plan balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `locked_withdraw`
Topics: `(Symbol("locked_withdraw"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Plan id. |
| `owner` | `Address` | Plan owner. |
| `amount` | `i128` | Amount withdrawn. |
| `balance` | `i128` | Resulting plan balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `locked_early_withdraw`
Topics: `(Symbol("locked_early_withdraw"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Plan id. |
| `owner` | `Address` | Plan owner. |
| `amount` | `i128` | Gross amount withdrawn (before penalty). |
| `penalty` | `i128` | Penalty sent to the penalty recipient. |
| `balance` | `i128` | Resulting plan balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `goal_created`
Topics: `(Symbol("goal_created"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | New goal id. |
| `owner` | `Address` | Goal owner. |
| `name` | `String` | Goal name. |
| `target_amount` | `i128` | Target to reach. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `goal_contribution`
Topics: `(Symbol("goal_contribution"), from: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Goal id. |
| `from` | `Address` | Contributor. |
| `amount` | `i128` | Amount contributed this call. |
| `saved_amount` | `i128` | Resulting cumulative saved amount. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `goal_reached`
Topics: `(Symbol("goal_reached"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Goal id. |
| `owner` | `Address` | Goal owner. |
| `saved_amount` | `i128` | Saved amount at the moment the target was crossed. |
| `target_amount` | `i128` | Target that was reached. |
| `timestamp` | `u64` | Ledger timestamp of the call (equals `reached_at`). |

#### `goal_claimed`
Topics: `(Symbol("goal_claimed"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Goal id. |
| `owner` | `Address` | Goal owner. |
| `amount` | `i128` | Amount transferred out (full saved balance). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `goal_auto_renew_set`
Topics: `(Symbol("goal_auto_renew_set"), owner: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Goal id. |
| `owner` | `Address` | Goal owner. |
| `auto_renew` | `bool` | Renewal setting after the call. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `goal_renewed`
Topics: `(Symbol("goal_renewed"), owner: Address, id: u64)`

Emitted when claiming an auto-renewing goal restarts it; co-emitted with
`goal_claimed` in the same `goal_claim` call.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Goal id (unchanged across the restart). |
| `owner` | `Address` | Goal owner. |
| `target_amount` | `i128` | Target the restarted goal now saves toward. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_created`
Topics: `(Symbol("group_created"), creator: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | New group id. |
| `creator` | `Address` | Group creator (first member). |
| `name` | `String` | Group name. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_joined`
Topics: `(Symbol("group_joined"), member: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `member` | `Address` | Newly joined member. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_contribution`
Topics: `(Symbol("group_contribution"), member: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `member` | `Address` | Contributor. |
| `amount` | `i128` | Amount contributed this call. |
| `balance` | `i128` | Resulting pool balance. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_closed`
Topics: `(Symbol("group_closed"), creator: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `creator` | `Address` | Group creator. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_payout`
Topics: `(Symbol("group_payout"), member: Address, id: u64)`

Emitted once per member during a single `group_payout_equal` call.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `member` | `Address` | Member paid out. |
| `amount` | `i128` | Amount transferred to this member. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_shares_set`
Topics: `(Symbol("group_shares_set"), creator: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `creator` | `Address` | Group creator. |
| `shares_bps` | `Map<Address, u32>` | Configured per-member basis-point shares (sums to `10_000`). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_split_settled`
Topics: `(Symbol("group_split_settled"), member: Address, id: u64)`

Emitted once per member during a single `group_settle` call.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `member` | `Address` | Member settled. |
| `amount` | `i128` | Amount transferred to this member (rounding remainder goes to the creator's entry). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_voting_period_set`
Topics: `(Symbol("group_voting_period_set"), creator: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Group id. |
| `creator` | `Address` | Group creator. |
| `seconds` | `u64` | Configured voting window, in seconds (`0` disables proposals). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_proposal_created`
Topics: `(Symbol("group_proposal_created"), proposer: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | New proposal id. |
| `group_id` | `u64` | Group the proposal belongs to. |
| `recipient` | `Address` | Address paid if the proposal passes. |
| `amount` | `i128` | Amount proposed to spend from the pool. |
| `voting_ends_at` | `u64` | Ledger timestamp at/after which voting closes. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_vote_cast`
Topics: `(Symbol("group_vote_cast"), voter: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Proposal id. |
| `group_id` | `u64` | Group the proposal belongs to. |
| `approve` | `bool` | `true` for a yes vote, `false` for a no vote. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `group_proposal_executed`
Topics: `(Symbol("group_proposal_executed"), caller: Address, id: u64)`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `u64` | Proposal id. |
| `group_id` | `u64` | Group the proposal belongs to. |
| `passed` | `bool` | Whether the proposal cleared the majority threshold. |
| `spent` | `i128` | Amount paid to the recipient (`0` when the proposal failed). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `interest_rate_set`
Topics: `(Symbol("interest_rate_set"),)`

| Field | Type | Description |
| --- | --- | --- |
| `caller` | `Address` | Admin who set the rate. |
| `rate_bps` | `u32` | New annual interest rate, in basis points. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `interest_frequency_set`
Topics: `(Symbol("interest_frequency_set"),)`

| Field | Type | Description |
| --- | --- | --- |
| `caller` | `Address` | Admin who set the frequency. |
| `frequency` | `CompoundFrequency` | New compounding frequency. |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `interest_deposit`
Topics: `(Symbol("interest_deposit"), owner: Address)`

| Field | Type | Description |
| --- | --- | --- |
| `owner` | `Address` | Interest account owner. |
| `amount` | `i128` | Amount deposited this call. |
| `principal` | `i128` | Resulting principal (after settling accrued interest). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `interest_withdraw`
Topics: `(Symbol("interest_withdraw"), owner: Address)`

| Field | Type | Description |
| --- | --- | --- |
| `owner` | `Address` | Interest account owner. |
| `amount` | `i128` | Amount withdrawn. |
| `principal` | `i128` | Resulting principal (after settling accrued interest). |
| `timestamp` | `u64` | Ledger timestamp of the call. |

#### `interest_claimed`
Topics: `(Symbol("interest_claimed"), owner: Address)`

| Field | Type | Description |
| --- | --- | --- |
| `owner` | `Address` | Interest account owner. |
| `credited` | `i128` | Interest credited into the principal this call (`0` between periods). |
| `principal` | `i128` | Resulting principal after crediting. |
| `timestamp` | `u64` | Ledger timestamp of the call. |
