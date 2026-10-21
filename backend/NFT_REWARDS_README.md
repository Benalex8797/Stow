# NFT Reward System - Complete Implementation

## Quick Start

### 1. Run Migration

```bash
npm run migration:run
```

This creates:
- `nft_reward_milestones` table
- `user_nft_rewards` table
- All indexes and foreign keys

### 2. Seed Initial Milestones

Option A: Use SQL file directly
```bash
psql $DATABASE_URL < backend/nft-rewards-seed.sql
```

Option B: Use admin API
```bash
curl -X POST http://localhost:3000/admin/nft-rewards/milestones \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "milestone_type": "savings_amount",
    "threshold": 10000000000,
    "name": "First 1000 XLM",
    "description": "Reach 1000 XLM in savings",
    "nft_title": "Saver NFT",
    "nft_description": "You saved 1000 XLM!",
    "image_ipfs_cid": "Qm...",
    "rarity_tier": 1,
    "is_soulbound": false
  }'
```

### 3. Trigger Evaluation

After user actions (deposit, goal reached, etc.):

```typescript
import { NftRewardsService } from './nft-rewards/services/nft-rewards.service';

// In any service
await this.nftRewardsService.evaluateAndMintRewards(userId);
```

### 4. Check Progress

```bash
curl http://localhost:3000/nft-rewards/milestones/progress \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Directory Structure

```
backend/src/nft-rewards/
├── entities/                          # Database models
│   ├── nft-reward-milestone.entity.ts
│   └── user-nft-reward.entity.ts
├── dto/                               # Data Transfer Objects
│   ├── milestone-progress.dto.ts
│   └── nft-metadata.dto.ts
├── services/                          # Business logic
│   ├── nft-rewards.service.ts        (Orchestrator)
│   ├── milestone-evaluator.service.ts (Progress calculation)
│   └── nft-metadata.service.ts       (Metadata & IPFS)
├── admin/                             # Admin-only features
│   ├── nft-rewards-admin.controller.ts
│   └── nft-rewards-admin.service.ts
├── nft-rewards.controller.ts         # User endpoints
└── nft-rewards.module.ts             # Module definition

backend/
├── NFT_REWARDS_GUIDE.md              # Complete API reference
├── NFT_REWARDS_IMPLEMENTATION.md     # Technical details
├── NFT_REWARDS_README.md             # This file
├── nft-rewards-seed.sql              # Initial milestone data
└── src/migrations/
    └── 1729432800000-CreateNftRewardsEntities.ts
```

## Key Concepts

### Milestone Types

1. **Savings Amount** - Total cumulative balance
2. **Goals Reached** - Count of completed goals
3. **Consecutive Deposits** - Days in a row with deposits
4. **Activity Streak** - Unique days with any activity

### Rarity Tiers

- **1 - Common**: Entry-level achievements
- **2 - Uncommon**: More challenging
- **3 - Rare**: Significant accomplishments
- **4 - Epic**: Very difficult milestones
- **5 - Legendary**: Extraordinary achievements

### Status Flow

```
Milestone Reached
      ↓
evaluateAndMintRewards()
      ↓
UserNftReward Created (status: EARNED)
      ↓
Metadata Generated & Pinned to IPFS
      ↓
Status Updated to MINTED
      ↓
User Can View/Transfer (if not soulbound)
```

## API Overview

### User Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/nft-rewards/milestones/progress` | GET | View progress on all milestones |
| `/nft-rewards/rewards` | GET | List earned rewards |
| `/nft-rewards/rewards/:rewardId` | GET | Get reward details |
| `/nft-rewards/evaluate` | POST | Evaluate & mint pending rewards |
| `/nft-rewards/rewards/:rewardId/transfer` | PATCH | Mark as transferred |

### Admin Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/nft-rewards/milestones` | GET | List milestones |
| `/admin/nft-rewards/milestones/:id` | GET | Milestone details |
| `/admin/nft-rewards/milestones` | POST | Create milestone |
| `/admin/nft-rewards/milestones/:id` | PUT | Update milestone |
| `/admin/nft-rewards/milestones/:id/deactivate` | POST | Deactivate milestone |
| `/admin/nft-rewards/stats` | GET | System statistics |
| `/admin/nft-rewards/user-rewards/:userId` | GET | User reward history |

## Environment Configuration

Optional (for IPFS/Pinata integration):

```bash
# .env
PINATA_API_KEY=your_key
PINATA_SECRET_KEY=your_secret
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/
```

If not set, the system uses mock IPFS for development.

## Integration Examples

### After User Makes a Deposit

```typescript
// In SavingsService or similar
async deposit(userId: string, amount: bigint): Promise<void> {
  // ... deposit logic ...
  
  // Evaluate milestone progress
  await this.nftRewardsService.evaluateAndMintRewards(userId);
}
```

### After Goal is Reached

```typescript
// In GoalsService
async markReached(onChainId: string): Promise<Goal> {
  const { goal, changed } = await this.goalRepository.markReached(onChainId);
  
  if (changed) {
    // User reached a new goal - check milestones
    const owner = goal.owner;
    const userId = await this.getUserIdByAddress(owner);
    await this.nftRewardsService.evaluateAndMintRewards(userId);
  }
  
  return goal;
}
```

### Daily Evaluation Job

```typescript
// In a scheduled service
@Cron('0 0 * * *') // Daily at midnight
async evaluateDailyMilestones(): Promise<void> {
  const users = await this.userRepository.find();
  
  for (const user of users) {
    try {
      await this.nftRewardsService.evaluateAndMintRewards(user.id);
    } catch (error) {
      this.logger.error(`Failed to evaluate milestones for user ${user.id}`, error);
    }
  }
}
```

## Data Models Overview

### NftRewardMilestone

```typescript
{
  id: UUID;
  milestone_type: 'savings_amount' | 'goals_reached' | 'consecutive_deposits' | 'activity_streak';
  threshold: number;              // When to trigger
  name: string;                   // Display name
  description: string;            // What user needs to do
  nft_title: string;             // NFT title
  nft_description: string;       // NFT description
  image_ipfs_cid: string;        // Image location on IPFS
  rarity_tier: 1-5;              // Rarity level
  is_active: boolean;            // Can new users earn this?
  is_soulbound: boolean;         // Locked to owner?
  created_at: Date;
  updated_at: Date;
}
```

### UserNftReward

```typescript
{
  id: UUID;
  user_id: UUID;                 // Who earned it
  milestone_id: UUID;            // Which milestone
  status: 'earned' | 'minted' | 'transferred';
  metadata_ipfs_cid: string;     // NFT metadata location
  nft_contract_address?: string; // Future: on-chain address
  nft_token_id?: string;         // Future: on-chain token ID
  mint_tx_hash?: string;         // Future: minting tx
  earned_at: Date;               // When earned
  minted_at?: Date;              // When metadata generated
  transferred_at?: Date;         // When transferred
  updated_at: Date;
}
```

## Response Examples

### Get Milestone Progress (50% Complete)

```json
{
  "total_milestones": 4,
  "earned_count": 2,
  "in_progress": [
    {
      "milestone_id": "uuid",
      "milestone_type": "savings_amount",
      "name": "First 1000 XLM",
      "threshold": 10000000000,
      "current_value": 5000000000,
      "progress_percentage": 50,
      "is_earned": false,
      "rarity_tier": 1,
      "is_soulbound": false
    }
  ],
  "completed": [
    {
      "milestone_id": "uuid",
      "milestone_type": "goals_reached",
      "name": "First Goal",
      "threshold": 1,
      "current_value": 5,
      "progress_percentage": 100,
      "is_earned": true,
      "earned_at": "2024-10-15T10:30:00Z",
      "rarity_tier": 1,
      "is_soulbound": false
    }
  ]
}
```

### Get User Rewards

```json
[
  {
    "id": "uuid",
    "status": "minted",
    "metadata_ipfs_cid": "Qm...",
    "earned_at": "2024-10-15T10:30:00Z",
    "minted_at": "2024-10-15T10:35:00Z",
    "milestone": {
      "name": "First Goal",
      "nft_title": "Goal Achiever NFT",
      "rarity_tier": 1,
      "is_soulbound": false
    }
  }
]
```

## Troubleshooting

### Migration Fails

```bash
# Check current migrations
npm run migration:show

# Reset to specific migration
npm run migration:revert -- --step 1

# Run pending migrations
npm run migration:run
```

### Evaluation Not Working

1. Check user exists in database
2. Verify milestone is active (`is_active = true`)
3. Ensure progress calculation returns correct value
4. Check PINATA env vars if IPFS pinning fails

### IPFS Pinning Errors

```
Environment: PINATA_API_KEY, PINATA_SECRET_KEY not set
Solution: Either configure credentials or use mock IPFS (for dev)
```

### User Blocked From Transfer

```json
{
  "statusCode": 400,
  "message": "Cannot transfer soulbound NFT",
  "error": "Bad Request"
}
```

This is expected - the milestone is soulbound. Check `is_soulbound` field on the milestone.

## Testing

### Unit Tests

```bash
npm test -- nft-rewards.service
npm test -- milestone-evaluator.service
npm test -- nft-metadata.service
```

### Integration Tests

```bash
npm test -- nft-rewards.e2e
```

### Manual Test Flow

1. Create user via auth endpoint
2. Create savings goal or deposit funds
3. Call `POST /nft-rewards/evaluate`
4. Call `GET /nft-rewards/milestones/progress`
5. Verify rewards appear in response
6. Check IPFS metadata link (if configured)

## Performance

- **Evaluation**: ~100-500ms per user (depends on user history size)
- **Metadata Generation**: ~100-500ms (includes IPFS pinning)
- **Progress Queries**: 
  - Savings: O(1) - single index lookup
  - Goals: O(n) where n = user's goals
  - Deposits/Activity: O(365) max - 1 year of data

## Security

- All user endpoints require JWT authentication
- Admin endpoints require JWT + role='admin'
- No exposed secrets in responses
- Soulbound transfer restriction enforced server-side
- Unique constraint prevents duplicate rewards
- Foreign key constraints maintain data integrity

## Roadmap

### Phase 2: On-Chain Minting
- Deploy Stellar NFT contract
- Mint NFTs on Soroban
- Store contract addresses and token IDs

### Phase 3: Marketplace
- Transferable NFT listing
- Trading mechanics
- Rarity-based discovery

### Phase 4: Analytics
- Leaderboards
- Historical adoption curves
- User engagement metrics

## Support Files

- **NFT_REWARDS_GUIDE.md** - Complete API documentation
- **NFT_REWARDS_IMPLEMENTATION.md** - Technical deep dive
- **nft-rewards-seed.sql** - Initial milestone data
- Database migration - Schema creation

## Next Steps

1. ✅ Run migration to create tables
2. ✅ Seed initial milestones (SQL or API)
3. ✅ Configure PINATA env vars (optional)
4. ✅ Call `evaluateAndMintRewards()` after user actions
5. ✅ Display milestone progress in frontend
6. ✅ Notify users of earned rewards

## Questions?

Refer to:
- **API Details** → NFT_REWARDS_GUIDE.md
- **Architecture** → NFT_REWARDS_IMPLEMENTATION.md
- **Setup Issues** → This README
