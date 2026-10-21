# NFT Reward System for Milestones

## Overview

The NFT reward system automatically mints achievement NFTs when users reach specific savings and activity milestones on Stow. Each milestone has configurable metadata, rarity tiers, and optional soulbound restrictions.

## Architecture

### Core Components

1. **NftRewardMilestone** - Defines reward criteria and metadata
2. **UserNftReward** - Tracks earned/minted rewards per user
3. **MilestoneEvaluatorService** - Calculates user progress
4. **NftMetadataService** - Generates and pins NFT metadata to IPFS
5. **NftRewardsService** - Orchestrates evaluation and reward creation

### Module Structure

```
backend/src/nft-rewards/
├── entities/
│   ├── nft-reward-milestone.entity.ts
│   └── user-nft-reward.entity.ts
├── dto/
│   ├── milestone-progress.dto.ts
│   └── nft-metadata.dto.ts
├── services/
│   ├── nft-rewards.service.ts
│   ├── milestone-evaluator.service.ts
│   └── nft-metadata.service.ts
└── nft-rewards.controller.ts
```

## Milestone Types

### 1. Savings Amount (`SAVINGS_AMOUNT`)

Triggered when user reaches a cumulative savings threshold (in stroops).

**Example:** "First 1000 XLM Saved"
- Threshold: 10,000,000,000 stroops (1000 XLM)
- Progress: Tracked from user's balance in `balances` table
- Rarity: Common (Tier 1)

### 2. Goals Reached (`GOALS_REACHED`)

Triggered when user reaches a certain number of savings goals.

**Example:** "5 Goals Champion"
- Threshold: 5 goals
- Progress: Count of goals with status = `REACHED`
- Rarity: Rare (Tier 3)

### 3. Consecutive Deposits (`CONSECUTIVE_DEPOSITS`)

Triggered when user maintains a streak of deposits on consecutive days.

**Example:** "30-Day Depositor"
- Threshold: 30 days
- Progress: Count of consecutive days with deposit activity
- Rarity: Epic (Tier 4)

### 4. Activity Streak (`ACTIVITY_STREAK`)

Triggered when user maintains a streak of any activity (deposits/withdrawals).

**Example:** "100-Day Streak"
- Threshold: 100 days
- Progress: Count of unique days with activity
- Rarity: Legendary (Tier 5)

## Data Models

### NftRewardMilestone Entity

```typescript
{
  id: UUID;
  milestone_type: 'savings_amount' | 'goals_reached' | 'consecutive_deposits' | 'activity_streak';
  threshold: number;           // Threshold value (amount, count, or days)
  name: string;                // Display name
  description: string;         // Description of achievement
  nft_title: string;           // NFT title
  nft_description: string;     // NFT description
  image_ipfs_cid: string;      // IPFS CID of milestone image
  rarity_tier: 1-5;           // Common to Legendary
  is_active: boolean;         // Can new users earn this?
  is_soulbound: boolean;      // Transferable or soulbound?
  created_at: Date;
  updated_at: Date;
}
```

### UserNftReward Entity

```typescript
{
  id: UUID;
  user_id: UUID;
  milestone_id: UUID;
  status: 'earned' | 'minted' | 'transferred';
  nft_contract_address: string | null;    // On-chain contract (future)
  nft_token_id: string | null;            // Token ID (future)
  metadata_ipfs_cid: string;              // Metadata JSON location
  mint_tx_hash: string | null;            // Minting transaction (future)
  mint_ledger: number | null;             // Ledger of minting (future)
  earned_at: Date;
  minted_at: Date | null;
  transferred_at: Date | null;
  updated_at: Date;
}
```

## API Endpoints

### 1. Get Milestone Progress

**GET /nft-rewards/milestones/progress**

Returns all active milestones with user's current progress.

**Response:**
```json
{
  "total_milestones": 8,
  "earned_count": 2,
  "in_progress": [
    {
      "milestone_id": "uuid",
      "milestone_type": "savings_amount",
      "name": "First 1000 XLM Saved",
      "description": "Reach 1000 XLM in total savings",
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
      "description": "Create and reach your first goal",
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

**Authentication:** Required (JWT)

### 2. Get User NFT Rewards

**GET /nft-rewards/rewards**

Lists all NFT rewards earned by the user.

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "milestone_id": "uuid",
    "status": "minted",
    "metadata_ipfs_cid": "Qm...",
    "earned_at": "2024-10-15T10:30:00Z",
    "minted_at": "2024-10-15T10:35:00Z",
    "transferred_at": null,
    "milestone": {
      "id": "uuid",
      "name": "First Goal",
      "nft_title": "Goal Achiever NFT",
      "rarity_tier": 1,
      "is_soulbound": false
    }
  }
]
```

**Authentication:** Required (JWT)

### 3. Get Reward Details

**GET /nft-rewards/rewards/:rewardId**

Get full details of a specific reward including NFT metadata.

**Response:**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "milestone_id": "uuid",
  "status": "minted",
  "nft_contract_address": null,
  "nft_token_id": null,
  "metadata_ipfs_cid": "Qm...",
  "mint_tx_hash": null,
  "mint_ledger": null,
  "earned_at": "2024-10-15T10:30:00Z",
  "minted_at": "2024-10-15T10:35:00Z",
  "transferred_at": null,
  "milestone": {
    "id": "uuid",
    "milestone_type": "goals_reached",
    "threshold": 1,
    "name": "First Goal",
    "description": "Create and reach your first goal",
    "nft_title": "Goal Achiever NFT",
    "nft_description": "You've achieved your first savings goal!",
    "image_ipfs_cid": "Qm...",
    "rarity_tier": 1,
    "is_active": true,
    "is_soulbound": false
  }
}
```

**Authentication:** Required (JWT)

### 4. Evaluate and Mint Rewards

**POST /nft-rewards/evaluate**

Checks all active milestones for the user and creates NFTs for newly earned achievements.

**Request:** Empty body

**Response:**
```json
{
  "status": "Evaluation complete"
}
```

**Details:**
- Iterates through all active milestones
- Calculates user progress for each milestone type
- Creates UserNftReward records for newly earned milestones
- Generates NFT metadata and pins to IPFS
- Updates reward status to `MINTED`

**Authentication:** Required (JWT)

### 5. Mark Reward as Transferred

**PATCH /nft-rewards/rewards/:rewardId/transfer**

Records that an NFT reward was transferred off-chain.

**Response:**
```json
{
  "id": "uuid",
  "status": "transferred",
  "transferred_at": "2024-10-15T11:00:00Z",
  "...": "other fields"
}
```

**Error (Soulbound):**
```json
{
  "statusCode": 400,
  "message": "Cannot transfer soulbound NFT",
  "error": "Bad Request"
}
```

**Authentication:** Required (JWT)
**Authorization:** User must own the reward

## NFT Metadata Generation

### Metadata Structure

Generated metadata is stored on IPFS and follows OpenSea/Stellar standards:

```json
{
  "name": "Goal Achiever NFT",
  "description": "Milestone achievement unlocked on Stow.",
  "image": "https://gateway.pinata.cloud/ipfs/Qm...",
  "external_url": "https://stow.app/achievements/G...",
  "attributes": [
    { "trait_type": "Milestone Type", "value": "goals_reached" },
    { "trait_type": "Rarity Tier", "value": "Common" },
    { "trait_type": "Earned Date", "value": "2024-10-15T10:30:00Z" },
    { "trait_type": "Soulbound", "value": "No" }
  ],
  "properties": {
    "category": "Stow Milestone",
    "milestone_type": "goals_reached",
    "rarity": "Common"
  }
}
```

### IPFS Storage

Metadata is pinned to IPFS via Pinata:

1. Metadata JSON is serialized
2. Posted to `https://api.pinata.cloud/pinning/pinJSONToIPFS`
3. HMAC-SHA256 authenticated with Pinata credentials
4. CID is stored in `metadata_ipfs_cid`

## Progress Calculation

### Savings Amount

```typescript
// From balances table
const balance = await balanceRepository.findOne({ account: stellarAddress });
return parseInt(balance.amount, 10); // Returns stroops
```

### Goals Reached

```typescript
// Count goals with REACHED status
const count = await goalRepository.count({
  owner: stellarAddress,
  status: GoalStatus.REACHED
});
```

### Consecutive Deposits

```typescript
// Find all deposit events, ordered by ledger DESC
// Iterate and check if consecutive days (within 1 day)
// Return streak count
```

### Activity Streak

```typescript
// Find all deposit/withdraw events for user
// Group by unique dates (ignore time)
// Count consecutive days from today backwards
// Return streak count
```

## Setup & Configuration

### Environment Variables

```bash
# IPFS/Pinata configuration
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret_key
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/

# Or for development (mocked)
# Leave empty to use mock IPFS
```

### Database Migration

```bash
npm run migration:run
```

This creates:
- `nft_reward_milestones` table
- `user_nft_rewards` table
- Required indexes and foreign keys

### Create Initial Milestones

**Example SQL:**

```sql
-- First Savings Goal
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound
) VALUES (
  'savings_amount', 10000000000, 'First 1000 XLM',
  'Reach 1000 XLM in savings', 'Saver NFT',
  'You have saved your first 1000 XLM!', 'Qm...',
  1, false
);

-- 5 Goals Champion
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound
) VALUES (
  'goals_reached', 5, 'Five Goals Champion',
  'Reach 5 savings goals', 'Goals Champion NFT',
  'You have achieved 5 savings goals!', 'Qm...',
  3, true
);

-- 30-Day Depositor
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound
) VALUES (
  'consecutive_deposits', 30, '30-Day Depositor',
  'Make deposits for 30 consecutive days', 'Consistent Saver NFT',
  'You deposited for 30 consecutive days!', 'Qm...',
  4, true
);

-- 100-Day Streak
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound
) VALUES (
  'activity_streak', 100, '100-Day Streak',
  'Maintain a 100-day activity streak', 'Legendary Streaker NFT',
  'You achieved a 100-day activity streak!', 'Qm...',
  5, true
);
```

## Integration Points

### Trigger Evaluation

Call `POST /nft-rewards/evaluate` after:

1. **User deposits funds** → Check savings amount milestones
2. **Goal is reached** → Check goals reached milestones
3. **Daily/weekly maintenance** → Check all milestone types
4. **User activity** → Check activity streak milestones

**Example:**
```typescript
// After goal is marked reached in GoalsService
await this.nftRewardsService.evaluateAndMintRewards(userId);
```

### Display in Frontend

1. Show milestone progress on dashboard
2. Notify user when milestone earned
3. Display NFT with metadata link to IPFS
4. Show rarity tier and soulbound status

## Transfer Restrictions

### Soulbound NFTs

If `is_soulbound = true`:
- Cannot be transferred to other addresses
- Locked to original earner
- Represent personal achievements
- API call to `/transfer` will fail with 400 error

### Transferable NFTs

If `is_soulbound = false`:
- Can be transferred after minting
- User initiates transfer via API
- Records `transferred_at` timestamp
- Status changes to `TRANSFERRED`

## Testing

### Unit Tests

```bash
npm test -- nft-rewards.service.spec
npm test -- milestone-evaluator.service.spec
npm test -- nft-metadata.service.spec
```

### E2E Tests

```bash
npm test -- nft-rewards.e2e.spec
```

### Manual Testing

1. Create a user with balance
2. Call `POST /nft-rewards/evaluate`
3. Check `user_nft_rewards` table
4. Call `GET /nft-rewards/milestones/progress`
5. Verify IPFS metadata link works

## Future Enhancements

### On-Chain Minting

1. Implement Soroban contract for NFT issuance
2. Update `NftRewardsService` to call minting contract
3. Store `nft_contract_address`, `nft_token_id`, `mint_tx_hash`
4. Update reward status to include ledger info

### Marketplace Integration

1. Listing soulbound vs transferable NFTs
2. Trading/selling transferable rewards
3. Rarity-based filtering and discovery

### Advanced Metrics

1. Dashboard showing NFT rarity distribution
2. Leaderboards for different milestone types
3. Historical milestone completion rates

## API Reference Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/nft-rewards/milestones/progress` | GET | JWT | Get milestone progress |
| `/nft-rewards/rewards` | GET | JWT | List user rewards |
| `/nft-rewards/rewards/:rewardId` | GET | JWT | Get reward details |
| `/nft-rewards/evaluate` | POST | JWT | Evaluate & mint rewards |
| `/nft-rewards/rewards/:rewardId/transfer` | PATCH | JWT | Mark as transferred |
