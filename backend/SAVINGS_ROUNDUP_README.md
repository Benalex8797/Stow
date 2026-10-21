# Savings Round-up - Quick Start

## What Is It?

Automatically round up purchases to the nearest dollar (or other amount) and deposit the difference to savings accounts.

**Example:**
- You buy coffee for $3.67
- Round-up system adds $0.33
- $4.00 total saved in savings account

## Quick Setup

### 1. Run Migration

```bash
npm run migration:run
```

### 2. Create Your First Round-up

```bash
curl -X POST http://localhost:3000/savings/roundup/config \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dollar Roundups",
    "description": "Round up purchases to nearest dollar",
    "method": "nearest_dollar",
    "frequency": "daily",
    "min_roundup_amount": 10000,
    "max_roundup_per_transaction": 100000000,
    "target_vault": "flexible"
  }'
```

### 3. Check Your Stats

```bash
curl http://localhost:3000/savings/roundup/stats \
  -H "Authorization: Bearer YOUR_JWT"
```

## Rounding Methods

| Method | What It Does | Example |
|--------|------------|---------|
| **Nearest Dollar** | Rounds up to next $1.00 | $12.34 → $13.00 (+$0.66) |
| **Nearest Cent** | Rounds up to next $0.01 | $12.342 → $12.35 (+$0.008) |
| **Nearest Quarter** | Rounds up to next $0.25 | $12.34 → $12.50 (+$0.16) |
| **Percentage** | Percentage of purchase | 1% of $100 = +$1.00 |
| **Fixed Amount** | Same amount always | Every purchase +$0.01 |

## Processing Frequency

| Frequency | When It Deposits |
|-----------|-----------------|
| **IMMEDIATE** | Instantly after each roundup |
| **DAILY** | Once per day with accumulated amount |
| **WEEKLY** | Once per week with accumulated amount |
| **MONTHLY** | Once per month with accumulated amount |
| **BATCH** | Manual trigger via API or scheduled job |

## API Endpoints

### Configuration

```
POST   /savings/roundup/config              Create configuration
GET    /savings/roundup/config              List my configurations
GET    /savings/roundup/config/:id          Get configuration details
PUT    /savings/roundup/config/:id          Update configuration
POST   /savings/roundup/config/:id/pause    Pause configuration
POST   /savings/roundup/config/:id/resume   Resume configuration
```

### Records

```
GET    /savings/roundup/records             List all records
GET    /savings/roundup/records/pending     List pending roundups
GET    /savings/roundup/records/:id         Get record details
```

### Processing

```
POST   /savings/roundup/process             Process pending roundups
POST   /savings/roundup/trigger/:configId   Manual trigger
```

### Stats

```
GET    /savings/roundup/stats               Get my statistics
```

## Common Scenarios

### Scenario 1: Daily Dollar Rounding

**Goal:** Automatically save by rounding to nearest dollar daily

**Setup:**
```json
{
  "name": "Daily Dollar Rounding",
  "method": "nearest_dollar",
  "frequency": "daily",
  "min_roundup_amount": 10000,
  "target_vault": "flexible"
}
```

**How it works:**
- Every purchase rounds up to nearest dollar
- Accumulated throughout the day
- Deposited to savings at midnight (or scheduled time)

### Scenario 2: Percentage Saving

**Goal:** Automatically save 2% of each purchase

**Setup:**
```json
{
  "name": "2% Savings",
  "method": "percentage",
  "frequency": "immediate",
  "method_parameter": 2,
  "min_roundup_amount": 1000
}
```

**How it works:**
- Every purchase contributes 2%
- If roundup is ≥ 1000 stroops (~$0.10), deposit immediately
- Otherwise accumulated

### Scenario 3: Quarter Rounding (Weekly)

**Goal:** Save by rounding to nearest quarter, deposited weekly

**Setup:**
```json
{
  "name": "Weekly Quarter Roundup",
  "method": "nearest_quarter",
  "frequency": "weekly",
  "max_roundup_per_transaction": 2500000
}
```

**How it works:**
- Each purchase rounds to nearest $0.25
- Max $0.25 per transaction (capped)
- Accumulated throughout the week
- Deposited on Sunday (or specified day)

## Response Examples

### Create Configuration Response

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Dollar Roundups",
  "description": "Round up purchases to nearest dollar",
  "method": "nearest_dollar",
  "method_parameter": null,
  "frequency": "daily",
  "min_roundup_amount": "10000",
  "max_roundup_per_transaction": "100000000",
  "target_vault": "flexible",
  "is_active": true,
  "is_paused": false,
  "last_processed_at": null,
  "next_scheduled_at": "2024-10-21T00:00:00Z",
  "created_at": "2024-10-20T12:00:00Z",
  "updated_at": "2024-10-20T12:00:00Z"
}
```

### Get Statistics Response

```json
{
  "total_configs": 3,
  "active_configs": 2,
  "paused_configs": 1,
  "total_accumulated": "1500000000",
  "total_processed": "8500000000",
  "pending_records": 15,
  "completed_records": 127,
  "failed_records": 2,
  "last_batch_at": "2024-10-20T12:00:00Z"
}
```

### List Pending Records Response

```json
[
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "status": "pending",
    "trigger_source": "transaction",
    "roundup_amount": "660000",
    "original_amount": "13340000",
    "method_applied": "nearest_dollar",
    "transaction_reference": "txn_12345",
    "trigger_timestamp": "2024-10-20T12:30:00Z",
    "created_at": "2024-10-20T12:30:00Z",
    "processed_at": null
  }
]
```

## Integration

### Record a Roundup from Purchase

```typescript
// When user makes a purchase
await this.roundupService.recordRoundup(
  userId,
  configId,
  BigInt(purchaseAmount), // Amount in stroops
  RoundupTriggerSource.TRANSACTION,
  transactionId,
  transactionTime
);
```

### Trigger Externally

```typescript
// From webhook or external trigger
await this.roundupService.triggerExternalRoundup(
  userId,
  configId,
  optionalAmountOverride
);
```

### Scheduled Batch Processing

```typescript
// In CronService
@Cron('0 0 * * *') // Daily at midnight
async processDailyRoundups() {
  const users = await this.userRepository.find();
  for (const user of users) {
    await this.roundupService.processRecordsForUser(user.id);
  }
}
```

## Pause/Resume

### Pause Temporarily

```bash
curl -X POST http://localhost:3000/savings/roundup/config/:configId/pause \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Going on vacation"}'
```

### Resume Later

```bash
curl -X POST http://localhost:3000/savings/roundup/config/:configId/resume \
  -H "Authorization: Bearer YOUR_JWT"
```

## Monitor & Adjust

### Check Accumulated Amount

```bash
curl http://localhost:3000/savings/roundup/stats \
  -H "Authorization: Bearer YOUR_JWT"
# Look at "total_accumulated" field
```

### View Recent Activity

```bash
curl http://localhost:3000/savings/roundup/records \
  -H "Authorization: Bearer YOUR_JWT"
```

### Manual Trigger

```bash
curl -X POST http://localhost:3000/savings/roundup/trigger/:configId \
  -H "Authorization: Bearer YOUR_JWT"
```

## Transaction Flow

```
1. User makes purchase ($12.34)
   ↓
2. System calculates roundup ($0.66)
   ↓
3. Roundup recorded as PENDING
   ↓
4. Check frequency:
   - IMMEDIATE: Go to step 5
   - DAILY/WEEKLY/MONTHLY: Accumulate and wait
   - BATCH: Wait for manual trigger
   ↓
5. Process batch:
   - Mark all as PROCESSING
   - Submit on-chain deposit
   - Update with tx hash & ledger
   ↓
6. Mark all as COMPLETED
   ↓
7. Credit user's balance
```

## Calculations

### Stroops Reference
```
1 XLM = 10,000,000 stroops
$1.00 USD ≈ 10,000,000 stroops (at ~$0.10 XLM)
$0.01 USD ≈ 100,000 stroops
$0.001 USD ≈ 10,000 stroops
```

### Nearest Dollar Calculation
```
Transaction: $12.34 (123,400,000 stroops)
Stroop per dollar: 10,000,000
Next dollar: 130,000,000 stroops ($13.00)
Roundup: 130,000,000 - 123,400,000 = 6,600,000 stroops ($0.66)
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "Round-up not recording" | Config is paused or inactive | Resume it with `/resume` endpoint |
| "Below minimum amount" | Roundup too small | Lower `min_roundup_amount` |
| "Nothing accumulated" | No transactions or all below min | Check stats and pending records |
| "Batch failed" | On-chain deposit error | Check logs, retry manually |

## Best Practices

1. **Start small** - Begin with conservative settings, adjust over time
2. **Monitor regularly** - Check stats weekly to see progress
3. **Set realistic minimums** - Don't make threshold too high
4. **Use daily frequency** - More frequent processing = more deposits
5. **Multiple configs** - Create different configs for different goals

## Support

- **Complete Reference**: See `SAVINGS_ROUNDUP_GUIDE.md`
- **API Documentation**: Use Swagger/OpenAPI docs
- **Examples**: See response examples above
- **Issues**: Check troubleshooting section

---

**Status:** ✅ Production-ready

**Next Steps:**
1. Run migration: `npm run migration:run`
2. Create first configuration: See "Create Your First Round-up" above
3. Monitor with: `GET /savings/roundup/stats`
4. Integrate into transaction flow
