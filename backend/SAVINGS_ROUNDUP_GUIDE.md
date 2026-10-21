# Savings Round-up System

## Overview

A complete savings round-up solution that automatically accumulates small amounts from transactions and deposits them into user savings accounts. Supports multiple rounding methods, triggering strategies, and batch processing.

## Key Features

✅ **Multiple rounding methods** - Dollar, cent, quarter, percentage, fixed
✅ **Flexible triggering** - Immediate, daily, weekly, monthly, or batch
✅ **External triggers** - Webhooks, API calls, scheduled jobs
✅ **Batch processing** - Efficient bulk deposit operations
✅ **Full audit trail** - Complete history of all round-ups
✅ **Pause/resume** - Control round-ups without deletion
✅ **Error handling** - Automatic retry and failure tracking
✅ **Statistics** - Comprehensive user and system metrics

## How It Works

### 1. Configuration

Users set up round-up rules specifying:
- **Method**: How to calculate the round-up amount
- **Frequency**: When to process accumulated round-ups
- **Limits**: Min/max amounts per transaction
- **Target**: Which vault to deposit into

### 2. Recording

When a transaction occurs:
1. Calculate round-up based on method
2. Check if meets minimum threshold
3. Record as pending
4. Queue for processing based on frequency

### 3. Processing

Based on frequency:
- **IMMEDIATE**: Process instantly
- **DAILY**: Batch all pending from that day
- **WEEKLY**: Batch from the past 7 days
- **MONTHLY**: Batch from the past 30 days
- **BATCH**: Manual trigger or scheduled job

### 4. Deposit

Execute the batch:
1. Create batch record
2. Submit on-chain transaction
3. Update all records with deposit hash
4. Credit user's balance
5. Record completion

## Rounding Methods

### 1. Nearest Dollar
```
$12.34 → $13.00 = roundup $0.66
$10.50 → $11.00 = roundup $0.50
$25.00 → $25.00 = roundup $0.00 (already at boundary)
```

### 2. Nearest Cent
```
$12.342 → $12.35 = roundup $0.008
$10.503 → $10.51 = roundup $0.007
```

### 3. Nearest Quarter
```
$12.34 → $12.50 = roundup $0.16
$12.76 → $13.00 = roundup $0.24 (next quarter boundary)
```

### 4. Percentage
```
1% of $100 = $1.00 roundup
2% of $50 = $1.00 roundup
5% of $20 = $1.00 roundup
```

### 5. Fixed Amount
```
Round-up by fixed 100,000 stroops (~$0.01) per transaction
```

## Data Models

### RoundupConfig

```typescript
{
  id: UUID;
  user_id: UUID;              // Owner of config
  name: string;               // "Daily Round-ups"
  description: string;        // Optional description
  method: RoundupMethod;      // nearest_dollar, nearest_cent, etc.
  method_parameter: numeric;  // Percentage, fixed amount, etc.
  frequency: RoundupFrequency; // immediate, daily, weekly, monthly, batch
  min_roundup_amount: string;  // Minimum to accumulate (stroops)
  max_roundup_per_transaction: string; // Cap per roundup (stroops)
  target_vault: string;       // "flexible", "locked", "goals"
  is_active: boolean;
  is_paused: boolean;
  pause_reason: string;
  last_processed_at: Date;
  next_scheduled_at: Date;
  created_at: Date;
  updated_at: Date;
}
```

### RoundupRecord

```typescript
{
  id: UUID;
  user_id: UUID;
  config_id: UUID;
  status: RoundupRecordStatus; // pending, processing, completed, failed
  trigger_source: RoundupTriggerSource; // transaction, external, webhook, etc.
  roundup_amount: string;      // Amount rounded up (stroops)
  original_amount: string;     // Original transaction amount
  method_applied: string;      // Method used
  transaction_reference: string; // Reference to trigger
  trigger_timestamp: Date;
  deposit_tx_hash: string;     // On-chain tx hash
  deposit_ledger: number;
  error_message: string;       // If failed
  batch_id: UUID;              // Batch this was part of
  metadata: JSON;
  created_at: Date;
  processed_at: Date;
}
```

### RoundupBatch

```typescript
{
  id: UUID;
  record_count: number;        // Number of records in batch
  total_amount: string;        // Total amount to deposit
  status: RoundupBatchStatus;  // pending, processing, completed, failed
  successful_count: number;
  failed_count: number;
  deposit_tx_hash: string;     // Batch deposit tx
  deposit_ledger: number;
  error_message: string;
  metadata: JSON;
  created_at: Date;
  processing_started_at: Date;
  processed_at: Date;
  updated_at: Date;
}
```

## API Endpoints

### Configuration Management

```
POST   /savings/roundup/config                 → Create config
GET    /savings/roundup/config                 → List configs
GET    /savings/roundup/config/:configId       → Get config
PUT    /savings/roundup/config/:configId       → Update config
POST   /savings/roundup/config/:configId/pause → Pause config
POST   /savings/roundup/config/:configId/resume → Resume config
```

### Record Management

```
GET    /savings/roundup/records                → List all records
GET    /savings/roundup/records/pending        → List pending
GET    /savings/roundup/records/:recordId      → Get record details
```

### Processing

```
POST   /savings/roundup/process                → Process pending
POST   /savings/roundup/trigger/:configId      → Trigger manually
```

### Statistics

```
GET    /savings/roundup/stats                  → Get user statistics
```

## Request/Response Examples

### Create Configuration

**Request:**
```json
POST /savings/roundup/config
{
  "name": "Daily Dollar Roundups",
  "description": "Round up all purchases to nearest dollar daily",
  "method": "nearest_dollar",
  "frequency": "daily",
  "min_roundup_amount": 10000,
  "max_roundup_per_transaction": 100000000,
  "target_vault": "flexible"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Daily Dollar Roundups",
  "method": "nearest_dollar",
  "frequency": "daily",
  "min_roundup_amount": "10000",
  "max_roundup_per_transaction": "100000000",
  "target_vault": "flexible",
  "is_active": true,
  "is_paused": false,
  "created_at": "2024-10-20T12:00:00Z",
  "updated_at": "2024-10-20T12:00:00Z"
}
```

### List Pending Records

**Request:**
```
GET /savings/roundup/records/pending
```

**Response:**
```json
[
  {
    "id": "uuid1",
    "status": "pending",
    "trigger_source": "transaction",
    "roundup_amount": "660000",
    "original_amount": "13340000",
    "method_applied": "nearest_dollar",
    "created_at": "2024-10-20T12:00:00Z"
  },
  {
    "id": "uuid2",
    "status": "pending",
    "trigger_source": "transaction",
    "roundup_amount": "500000",
    "original_amount": "10500000",
    "method_applied": "nearest_dollar",
    "created_at": "2024-10-20T12:30:00Z"
  }
]
```

### Get Statistics

**Request:**
```
GET /savings/roundup/stats
```

**Response:**
```json
{
  "total_configs": 3,
  "active_configs": 2,
  "paused_configs": 1,
  "total_accumulated": "50000000",
  "total_processed": "850000000",
  "pending_records": 5,
  "completed_records": 127,
  "failed_records": 2,
  "last_batch_at": "2024-10-20T12:00:00Z"
}
```

## Integration Points

### Record Round-up from Transaction

```typescript
// In PaymentService or similar
const roundup = await this.roundupService.recordRoundup(
  userId,
  configId,
  BigInt(transactionAmount),
  RoundupTriggerSource.TRANSACTION,
  transactionId,
  transactionDate
);
```

### External Trigger (Webhook)

```typescript
// In WebhookController
const roundup = await this.roundupService.triggerExternalRoundup(
  userId,
  configId,
  BigInt(specifiedAmount) // Optional
);
```

### Scheduled Processing

```typescript
// In CronService
@Cron('0 0 * * *')
async processDailyRoundups() {
  const users = await this.userRepository.find();
  for (const user of users) {
    await this.roundupService.processRecordsForUser(user.id);
  }
}
```

## Configuration Examples

### Conservative (Lowest Rounding)

```json
{
  "name": "Conservative Rounding",
  "method": "nearest_cent",
  "frequency": "daily",
  "min_roundup_amount": 1000,
  "max_roundup_per_transaction": 10000
}
```
- Rounds to nearest penny
- Only deposits if accumulated to 1000 stroops (~$0.10)
- Maximum roundup per transaction: 10000 stroops (~$0.001)

### Moderate (Balanced)

```json
{
  "name": "Balanced Rounding",
  "method": "nearest_quarter",
  "frequency": "weekly",
  "min_roundup_amount": 100000,
  "max_roundup_per_transaction": 500000
}
```
- Rounds to nearest quarter
- Processes once per week
- Minimum 100k stroops (~$0.01) to trigger
- Max per transaction 500k stroops (~$0.05)

### Aggressive (Maximum Rounding)

```json
{
  "name": "Maximum Savings",
  "method": "nearest_dollar",
  "frequency": "immediate",
  "min_roundup_amount": 10000,
  "max_roundup_per_transaction": 100000000
}
```
- Rounds to nearest dollar
- Processes immediately
- Even small roundups ($0.001) trigger deposit
- Can roundup up to 100M stroops (~$10)

### Percentage-Based

```json
{
  "name": "1% Roundup",
  "method": "percentage",
  "frequency": "daily",
  "method_parameter": 1,
  "min_roundup_amount": 10000,
  "max_roundup_per_transaction": 100000000
}
```
- Rounds by 1% of transaction amount
- Daily accumulation and deposit

## Trigger Sources

| Source | Description | Example |
|--------|-------------|---------|
| TRANSACTION | From actual purchase | User buys item for $12.34 |
| EXTERNAL | Manual trigger | Admin or partner trigger |
| WEBHOOK | From webhook | Payment processor notification |
| API | Direct API call | Mobile app trigger |
| SCHEDULED | Cron job | Daily batch job |

## Statuses

### Record Statuses
- **PENDING**: Accumulated, waiting to process
- **PROCESSING**: Currently being deposited
- **COMPLETED**: Successfully deposited
- **FAILED**: Deposit failed
- **CANCELLED**: User cancelled

### Batch Statuses
- **PENDING**: Created, waiting to process
- **PROCESSING**: Deposit in progress
- **COMPLETED**: All records processed successfully
- **PARTIAL**: Some failed, some succeeded
- **FAILED**: All records failed
- **CANCELLED**: Batch cancelled

## Calculations

### Stroop Values

```
1 XLM = 10,000,000 stroops
$1.00 (USD) ≈ 10,000,000 stroops (at ~$0.10 XLM rate)
$0.01 (USD) ≈ 100,000 stroops
$0.001 (USD) ≈ 10,000 stroops
```

### Nearest Dollar Example

```
Transaction: $12.34 = 123,400,000 stroops
Stroop per dollar: 10,000,000
Remainder: 123,400,000 % 10,000,000 = 3,400,000
Roundup needed: 10,000,000 - 3,400,000 = 6,600,000 stroops ($0.66)
New total: 123,400,000 + 6,600,000 = 130,000,000 stroops ($13.00)
```

## Performance

- **Calculation**: O(1) - pure math
- **Record creation**: O(1) - single insert
- **Batch processing**: O(n) where n = records in batch
- **Database queries**: Indexed for fast lookups

## Setup

### 1. Run Migration

```bash
npm run migration:run
```

Creates three tables with proper indexes and foreign keys.

### 2. Seed Sample Configurations (Optional)

```bash
psql $DATABASE_URL < backend/roundup-seed.sql
```

### 3. Test Endpoints

```bash
# Create configuration
curl -X POST http://localhost:3000/savings/roundup/config \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "name": "My Roundup",
    "method": "nearest_dollar",
    "frequency": "daily"
  }'

# Get statistics
curl http://localhost:3000/savings/roundup/stats \
  -H "Authorization: Bearer YOUR_JWT"
```

## Testing

### Unit Tests

```typescript
const calculator = new RoundupCalculatorService();

// Test nearest dollar
const amount = BigInt(13340000); // $1.334
const roundup = calculator.calculateRoundup(
  amount,
  RoundupMethod.NEAREST_DOLLAR
);
// Returns 6600000 (to reach $13.00)
```

### Integration Tests

1. Create configuration
2. Record round-ups
3. Verify accumulation
4. Process batch
5. Confirm balance updated

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Round-ups not recording | Config paused/inactive | Resume config |
| Below minimum threshold | Roundup too small | Lower min_roundup_amount |
| Batch fails | Soroban contract error | Check logs, retry manually |
| Duplicate deposits | Race condition | Verify idempotency handling |

## Future Enhancements

1. **AI-powered suggestions** - Recommend configs based on spending
2. **Social goals** - Group round-ups for shared goals
3. **Charity donations** - Round-ups to charities
4. **Gamification** - Achievements and streaks
5. **Advanced analytics** - Spending patterns and trends
6. **Mobile app integration** - Native app notifications

## File Structure

```
backend/src/savings-roundup/
├── entities/
│   ├── roundup-config.entity.ts      ← Configuration
│   ├── roundup-record.entity.ts      ← Audit trail
│   └── roundup-batch.entity.ts       ← Batch processing
├── services/
│   ├── roundup-calculator.service.ts ← Calculation engine
│   └── roundup.service.ts            ← Core logic
├── dto/
│   ├── roundup-config.dto.ts         ← Input validation
│   └── roundup-responses.dto.ts      ← Response models
├── roundup.controller.ts             ← API endpoints
└── roundup.module.ts                 ← Module setup

backend/
├── SAVINGS_ROUNDUP_GUIDE.md          ← This file
├── SAVINGS_ROUNDUP_README.md         ← Quick start
└── src/migrations/...                ← Database setup
```

## Summary

A production-ready savings round-up system with:
- ✅ 5 rounding methods
- ✅ 5 frequency options
- ✅ 5 trigger sources
- ✅ Batch processing
- ✅ Complete audit trail
- ✅ Full error handling
- ✅ Comprehensive statistics
