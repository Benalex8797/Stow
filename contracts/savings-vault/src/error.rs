use soroban_sdk::contracterror;

/// Contract-wide error codes.
///
/// Keep these stable and append-only — clients and the indexer map to them.
/// 
/// Error codes are organized by category for maintainability:
/// - 1-9: Lifecycle and initialization
/// - 10-19: Authentication and authorization
/// - 20-29: Generic validation
/// - 30-39: Locked savings
/// - 40-49: Goal savings
/// - 50-59: Group savings
/// - 60-69: Arithmetic and limits
/// - 70-79: Admin lifecycle
/// - 80-89: Policy limits
/// - 90-99: Time-based operations
/// - 100+: Reserved for future use
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // --- Lifecycle (1-9) ---
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract must be initialized before this call.
    NotInitialized = 2,
    /// Invalid initialization parameters provided.
    InvalidInitialization = 3,

    // --- Authentication & Authorization (10-19) ---
    /// Caller is not authorized for this action.
    Unauthorized = 10,
    /// The provided admin address is invalid.
    InvalidAdmin = 11,
    /// The action requires admin privileges.
    AdminOnly = 12,
    /// The caller has been banned from this contract.
    CallerBanned = 13,

    // --- Generic Validation (20-29) ---
    /// A provided amount was zero or negative.
    InvalidAmount = 20,
    /// The referenced account/plan/goal/group does not exist.
    NotFound = 21,
    /// The caller has insufficient balance for the requested withdrawal.
    InsufficientBalance = 22,
    /// The provided address is invalid.
    InvalidAddress = 23,
    /// The operation conflicts with existing state.
    ConflictingState = 24,
    /// Invalid parameter combination provided.
    InvalidParameters = 25,

    // --- Locked Savings (30-39) ---
    /// Funds are still locked; unlock time has not been reached.
    StillLocked = 30,
    /// The provided unlock time is in the past.
    InvalidUnlockTime = 31,
    /// Lock duration exceeds maximum allowed.
    LockDurationTooLong = 32,
    /// Lock duration is below minimum allowed.
    LockDurationTooShort = 33,
    /// Early unlock is not permitted for this lock type.
    EarlyUnlockNotAllowed = 34,

    // --- Goal Savings (40-49) ---
    /// The goal target has not yet been reached.
    GoalNotReached = 40,
    /// Invalid goal target amount.
    InvalidGoalTarget = 41,
    /// Goal deadline has passed.
    GoalDeadlinePassed = 42,
    /// Goal has already been completed.
    GoalAlreadyCompleted = 43,
    /// Goal milestone configuration is invalid.
    InvalidMilestone = 44,

    // --- Group Savings (50-59) ---
    /// The group is full or the round is closed to new members.
    GroupClosed = 50,
    /// Member shares do not sum to the expected total (basis points).
    InvalidShares = 51,
    /// Caller is not a member of this group.
    NotAMember = 52,
    /// Maximum number of group members reached.
    GroupFull = 53,
    /// Group payout schedule is invalid.
    InvalidPayoutSchedule = 54,
    /// Group has insufficient funds for payout.
    InsufficientGroupFunds = 55,
    /// Member already exists in group.
    MemberAlreadyExists = 56,
    /// The caller has already voted on this proposal.
    AlreadyVoted = 57,
    /// The proposal has already been executed.
    ProposalAlreadyExecuted = 58,

    // --- Arithmetic & Limits (60-69) ---
    /// A monetary computation would have overflowed or underflowed `i128`.
    Overflow = 60,
    /// The admin-configured per-account deposit cap would be exceeded.
    DepositCapExceeded = 61,
    /// Withdrawal would exceed available balance.
    WithdrawExceedsBalance = 62,
    /// Division by zero attempted.
    DivisionByZero = 63,
    /// Result is negative when positive was required.
    NegativeResult = 64,

    // --- Admin Lifecycle (70-79) ---
    /// The contract is paused; mutating entrypoints are rejected.
    Paused = 70,
    /// The contract must be paused for this operation.
    NotPaused = 71,
    /// Emergency shutdown has been activated.
    EmergencyShutdown = 72,
    /// Contract upgrade failed.
    UpgradeFailed = 73,

    // --- Policy Limits (80-89) ---
    /// The deposit amount was below the admin-configured minimum deposit.
    DepositBelowMinimum = 80,
    /// The withdrawal amount is below the minimum allowed.
    WithdrawBelowMinimum = 81,
    /// Daily transaction limit exceeded.
    DailyLimitExceeded = 82,
    /// Rate limit exceeded for this operation.
    RateLimitExceeded = 83,
    /// Maximum number of concurrent operations exceeded.
    ConcurrentOperationLimitExceeded = 84,

    // --- Time-based Operations (90-99) ---
    /// Operation cannot be performed yet; cooldown period active.
    CooldownActive = 90,
    /// The provided timestamp is invalid.
    InvalidTimestamp = 91,
    /// Operation has expired.
    OperationExpired = 92,
    /// Time window for operation has not opened yet.
    TimeWindowNotOpen = 93,

    // --- Token Operations (100-109) ---
    /// Token transfer failed.
    TransferFailed = 100,
    /// Invalid token contract address.
    InvalidToken = 101,
    /// Token allowance is insufficient.
    InsufficientAllowance = 102,
    /// Token contract call failed.
    TokenCallFailed = 103,

    // --- Storage & State (110-119) ---
    /// Storage operation failed.
    StorageFailed = 110,
    /// Data corruption detected.
    DataCorruption = 111,
    /// Storage limit exceeded.
    StorageLimitExceeded = 112,
    /// Invalid state transition.
    InvalidStateTransition = 113,
}

impl Error {
    /// Returns a human-readable description of the error.
    /// Useful for logging and debugging.
    pub fn description(&self) -> &'static str {
        match self {
            // Lifecycle
            Error::AlreadyInitialized => "Contract has already been initialized",
            Error::NotInitialized => "Contract must be initialized before this call",
            Error::InvalidInitialization => "Invalid initialization parameters provided",
            
            // Authentication & Authorization
            Error::Unauthorized => "Caller is not authorized for this action",
            Error::InvalidAdmin => "The provided admin address is invalid",
            Error::AdminOnly => "The action requires admin privileges",
            Error::CallerBanned => "The caller has been banned from this contract",
            
            // Generic Validation
            Error::InvalidAmount => "A provided amount was zero or negative",
            Error::NotFound => "The referenced resource does not exist",
            Error::InsufficientBalance => "Insufficient balance for the requested operation",
            Error::InvalidAddress => "The provided address is invalid",
            Error::ConflictingState => "The operation conflicts with existing state",
            Error::InvalidParameters => "Invalid parameter combination provided",
            
            // Locked Savings
            Error::StillLocked => "Funds are still locked; unlock time not reached",
            Error::InvalidUnlockTime => "The provided unlock time is in the past",
            Error::LockDurationTooLong => "Lock duration exceeds maximum allowed",
            Error::LockDurationTooShort => "Lock duration is below minimum allowed",
            Error::EarlyUnlockNotAllowed => "Early unlock is not permitted for this lock type",
            
            // Goal Savings
            Error::GoalNotReached => "The goal target has not yet been reached",
            Error::InvalidGoalTarget => "Invalid goal target amount",
            Error::GoalDeadlinePassed => "Goal deadline has passed",
            Error::GoalAlreadyCompleted => "Goal has already been completed",
            Error::InvalidMilestone => "Goal milestone configuration is invalid",
            
            // Group Savings
            Error::GroupClosed => "The group is full or closed to new members",
            Error::InvalidShares => "Member shares do not sum to expected total",
            Error::NotAMember => "Caller is not a member of this group",
            Error::GroupFull => "Maximum number of group members reached",
            Error::InvalidPayoutSchedule => "Group payout schedule is invalid",
            Error::InsufficientGroupFunds => "Group has insufficient funds for payout",
            Error::MemberAlreadyExists => "Member already exists in group",
            Error::AlreadyVoted => "Caller has already voted on this proposal",
            Error::ProposalAlreadyExecuted => "The proposal has already been executed",
            
            // Arithmetic & Limits
            Error::Overflow => "Arithmetic operation would overflow or underflow",
            Error::DepositCapExceeded => "Deposit would exceed per-account cap",
            Error::WithdrawExceedsBalance => "Withdrawal exceeds available balance",
            Error::DivisionByZero => "Division by zero attempted",
            Error::NegativeResult => "Result is negative when positive was required",
            
            // Admin Lifecycle
            Error::Paused => "The contract is paused",
            Error::NotPaused => "The contract must be paused for this operation",
            Error::EmergencyShutdown => "Emergency shutdown has been activated",
            Error::UpgradeFailed => "Contract upgrade failed",
            
            // Policy Limits
            Error::DepositBelowMinimum => "Deposit amount is below minimum",
            Error::WithdrawBelowMinimum => "Withdrawal amount is below minimum",
            Error::DailyLimitExceeded => "Daily transaction limit exceeded",
            Error::RateLimitExceeded => "Rate limit exceeded for this operation",
            Error::ConcurrentOperationLimitExceeded => "Too many concurrent operations",
            
            // Time-based Operations
            Error::CooldownActive => "Cooldown period is still active",
            Error::InvalidTimestamp => "The provided timestamp is invalid",
            Error::OperationExpired => "Operation has expired",
            Error::TimeWindowNotOpen => "Time window for operation has not opened yet",
            
            // Token Operations
            Error::TransferFailed => "Token transfer failed",
            Error::InvalidToken => "Invalid token contract address",
            Error::InsufficientAllowance => "Token allowance is insufficient",
            Error::TokenCallFailed => "Token contract call failed",
            
            // Storage & State
            Error::StorageFailed => "Storage operation failed",
            Error::DataCorruption => "Data corruption detected",
            Error::StorageLimitExceeded => "Storage limit exceeded",
            Error::InvalidStateTransition => "Invalid state transition",
        }
    }

    /// Returns the error category as a string.
    /// Useful for metrics and categorized error handling.
    pub fn category(&self) -> &'static str {
        match self {
            Error::AlreadyInitialized 
            | Error::NotInitialized 
            | Error::InvalidInitialization => "Lifecycle",
            
            Error::Unauthorized 
            | Error::InvalidAdmin 
            | Error::AdminOnly 
            | Error::CallerBanned => "Authorization",
            
            Error::InvalidAmount 
            | Error::NotFound 
            | Error::InsufficientBalance 
            | Error::InvalidAddress 
            | Error::ConflictingState 
            | Error::InvalidParameters => "Validation",
            
            Error::StillLocked 
            | Error::InvalidUnlockTime 
            | Error::LockDurationTooLong 
            | Error::LockDurationTooShort 
            | Error::EarlyUnlockNotAllowed => "LockedSavings",
            
            Error::GoalNotReached 
            | Error::InvalidGoalTarget 
            | Error::GoalDeadlinePassed 
            | Error::GoalAlreadyCompleted 
            | Error::InvalidMilestone => "GoalSavings",
            
            Error::GroupClosed 
            | Error::InvalidShares 
            | Error::NotAMember 
            | Error::GroupFull 
            | Error::InvalidPayoutSchedule 
            | Error::InsufficientGroupFunds 
            | Error::MemberAlreadyExists 
            | Error::AlreadyVoted 
            | Error::ProposalAlreadyExecuted => "GroupSavings",
            
            Error::Overflow 
            | Error::DepositCapExceeded 
            | Error::WithdrawExceedsBalance 
            | Error::DivisionByZero 
            | Error::NegativeResult => "Arithmetic",
            
            Error::Paused 
            | Error::NotPaused 
            | Error::EmergencyShutdown 
            | Error::UpgradeFailed => "AdminLifecycle",
            
            Error::DepositBelowMinimum 
            | Error::WithdrawBelowMinimum 
            | Error::DailyLimitExceeded 
            | Error::RateLimitExceeded 
            | Error::ConcurrentOperationLimitExceeded => "PolicyLimits",
            
            Error::CooldownActive 
            | Error::InvalidTimestamp 
            | Error::OperationExpired 
            | Error::TimeWindowNotOpen => "TimeBasedOperations",
            
            Error::TransferFailed 
            | Error::InvalidToken 
            | Error::InsufficientAllowance 
            | Error::TokenCallFailed => "TokenOperations",
            
            Error::StorageFailed 
            | Error::DataCorruption 
            | Error::StorageLimitExceeded 
            | Error::InvalidStateTransition => "StorageAndState",
        }
    }

    /// Returns true if the error is retryable.
    /// Useful for implementing retry logic in client applications.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Error::RateLimitExceeded
                | Error::CooldownActive
                | Error::ConcurrentOperationLimitExceeded
                | Error::StorageFailed
        )
    }

    /// Returns true if the error indicates a fatal condition
    /// that requires immediate attention.
    pub fn is_fatal(&self) -> bool {
        matches!(
            self,
            Error::DataCorruption 
            | Error::EmergencyShutdown 
            | Error::UpgradeFailed
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_descriptions() {
        assert_eq!(
            Error::AlreadyInitialized.description(),
            "Contract has already been initialized"
        );
        assert_eq!(
            Error::Unauthorized.description(),
            "Caller is not authorized for this action"
        );
    }

    #[test]
    fn test_error_categories() {
        assert_eq!(Error::AlreadyInitialized.category(), "Lifecycle");
        assert_eq!(Error::Unauthorized.category(), "Authorization");
        assert_eq!(Error::InvalidAmount.category(), "Validation");
        assert_eq!(Error::StillLocked.category(), "LockedSavings");
    }

    #[test]
    fn test_retryable_errors() {
        assert!(Error::RateLimitExceeded.is_retryable());
        assert!(Error::CooldownActive.is_retryable());
        assert!(!Error::Unauthorized.is_retryable());
        assert!(!Error::NotFound.is_retryable());
    }

    #[test]
    fn test_fatal_errors() {
        assert!(Error::DataCorruption.is_fatal());
        assert!(Error::EmergencyShutdown.is_fatal());
        assert!(!Error::InvalidAmount.is_fatal());
        assert!(!Error::Unauthorized.is_fatal());
    }

    #[test]
    fn test_error_code_stability() {
        // Ensure critical error codes remain stable
        assert_eq!(Error::AlreadyInitialized as u32, 1);
        assert_eq!(Error::NotInitialized as u32, 2);
        assert_eq!(Error::Unauthorized as u32, 10);
        assert_eq!(Error::InvalidAmount as u32, 20);
        assert_eq!(Error::Paused as u32, 70);
    }
}
