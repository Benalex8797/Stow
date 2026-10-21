-- NFT Rewards Milestone Seed Data
-- Run this after migrations to populate initial milestones

-- Savings Amount Milestones
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound, is_active
) VALUES
(
  'savings_amount', 100000000, 'First 10 XLM',
  'Reach your first 10 XLM in savings',
  'First Saver',
  'You have saved your first 10 XLM! Welcome to the Stow journey.',
  'QmXXXXXXXXXXXX_savings_10xlm',
  1, false, true
),
(
  'savings_amount', 1000000000, 'Century Achiever (100 XLM)',
  'Reach 100 XLM in total savings',
  'Century Achiever',
  'You have accumulated 100 XLM. Your savings are growing!',
  'QmXXXXXXXXXXXX_savings_100xlm',
  1, false, true
),
(
  'savings_amount', 10000000000, 'Millennium Milestone (1000 XLM)',
  'Reach 1000 XLM in total savings',
  'Millennium Saver',
  'Congratulations! You have reached 1000 XLM in savings. A remarkable achievement!',
  'QmXXXXXXXXXXXX_savings_1000xlm',
  3, true, true
),
(
  'savings_amount', 100000000000, 'Crypto Whale (10000 XLM)',
  'Reach 10,000 XLM in total savings',
  'Whale Saver',
  'You have become a major saver with 10,000 XLM. Extraordinary dedication!',
  'QmXXXXXXXXXXXX_savings_10k_xlm',
  4, true, true
);

-- Goals Reached Milestones
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound, is_active
) VALUES
(
  'goals_reached', 1, 'First Goal',
  'Create and reach your first savings goal',
  'Goal Pioneer',
  'You achieved your first savings goal! This is just the beginning.',
  'QmXXXXXXXXXXXX_goals_1st',
  1, false, true
),
(
  'goals_reached', 5, 'Goal Master (5 Goals)',
  'Reach 5 savings goals',
  'Goal Master',
  'Five goals achieved! You are a master of goal-setting and completion.',
  'QmXXXXXXXXXXXX_goals_5',
  3, true, true
),
(
  'goals_reached', 10, 'Goal Legend (10 Goals)',
  'Reach 10 savings goals',
  'Goal Legend',
  'An incredible 10 goals completed! You are a savings legend.',
  'QmXXXXXXXXXXXX_goals_10',
  5, true, true
);

-- Consecutive Deposits Milestones
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound, is_active
) VALUES
(
  'consecutive_deposits', 7, 'Consistent Saver (7 Days)',
  'Make deposits for 7 consecutive days',
  'Week Warrior',
  'You have deposited for 7 consecutive days. Your consistency is admirable.',
  'QmXXXXXXXXXXXX_deposits_7days',
  2, false, true
),
(
  'consecutive_deposits', 30, '30-Day Depositor',
  'Make deposits for 30 consecutive days',
  'Monthly Champion',
  'Thirty consecutive days of deposits! You are a true savings champion.',
  'QmXXXXXXXXXXXX_deposits_30days',
  4, true, true
),
(
  'consecutive_deposits', 100, '100-Day Streak',
  'Make deposits for 100 consecutive days',
  'Centennial Saver',
  'One hundred consecutive days! You have transcended to savings excellence.',
  'QmXXXXXXXXXXXX_deposits_100days',
  5, true, true
);

-- Activity Streak Milestones
INSERT INTO nft_reward_milestones (
  milestone_type, threshold, name, description,
  nft_title, nft_description, image_ipfs_cid,
  rarity_tier, is_soulbound, is_active
) VALUES
(
  'activity_streak', 14, 'Active Participant (14 Days)',
  'Maintain a 14-day activity streak',
  'Two Week Warrior',
  'Fourteen days of consistent activity. You are engaged with Stow!',
  'QmXXXXXXXXXXXX_activity_14days',
  2, false, true
),
(
  'activity_streak', 60, '60-Day Active (2 Months)',
  'Maintain a 60-day activity streak',
  'Bimonthly Devotee',
  'Two months of consistent activity! Your dedication is inspiring.',
  'QmXXXXXXXXXXXX_activity_60days',
  3, true, true
),
(
  'activity_streak', 365, '365-Day Legend (1 Year)',
  'Maintain a 365-day activity streak',
  'Year-Long Legend',
  'A full year of consistent activity! You are a true Stow legend.',
  'QmXXXXXXXXXXXX_activity_365days',
  5, true, true
);

-- Verify seeding
SELECT 
  milestone_type,
  COUNT(*) as count,
  SUM(CASE WHEN is_soulbound THEN 1 ELSE 0 END) as soulbound_count
FROM nft_reward_milestones
GROUP BY milestone_type
ORDER BY milestone_type;

-- Show all milestones
SELECT 
  id,
  milestone_type,
  threshold,
  name,
  rarity_tier,
  is_soulbound,
  is_active,
  created_at
FROM nft_reward_milestones
ORDER BY rarity_tier ASC, threshold ASC;
