-- Savings Round-up Seed Data
-- Run this after migrations to populate example configurations

-- Dollar Rounding Configuration (Daily)
INSERT INTO roundup_configs (
  user_id, name, description, method, frequency,
  min_roundup_amount, max_roundup_per_transaction,
  target_vault, is_active, is_paused, created_at, updated_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000', -- Sample user ID
  'Daily Dollar Rounding',
  'Automatically round up purchases to the nearest dollar, processed daily',
  'nearest_dollar',
  'daily',
  '10000', -- 0.001 XLM (~$0.0001)
  '100000000', -- 10 XLM (~$1.00)
  'flexible',
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  '550e8400-e29b-41d4-a716-446655440000',
  'Percentage Savings',
  'Automatically save 2% of each purchase, deposited immediately',
  'percentage',
  'immediate',
  '100000', -- 0.01 XLM (~$0.001)
  '500000000', -- 50 XLM (~$5.00)
  'locked',
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Quarter Rounding Configuration (Weekly)
INSERT INTO roundup_configs (
  user_id, name, description, method, method_parameter,
  frequency, min_roundup_amount, max_roundup_per_transaction,
  target_vault, is_active, is_paused, created_at, updated_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000',
  'Weekly Quarter Rounding',
  'Round up purchases to nearest quarter ($0.25), accumulated weekly',
  'nearest_quarter',
  NULL,
  'weekly',
  '100000', -- 0.01 XLM
  '2500000', -- 0.25 XLM (~$0.025)
  'flexible',
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Fixed Amount Configuration (Monthly Batch)
INSERT INTO roundup_configs (
  user_id, name, description, method, method_parameter,
  frequency, min_roundup_amount, max_roundup_per_transaction,
  target_vault, is_active, is_paused, created_at, updated_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000',
  'Monthly Fixed Savings',
  'Save 0.01 XLM per transaction, processed monthly',
  'fixed_amount',
  '1000000', -- 0.1 XLM (~$0.01)
  'monthly',
  '500000', -- 0.05 XLM
  'flexible',
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Aggressive Rounding Configuration (Batch)
INSERT INTO roundup_configs (
  user_id, name, description, method,
  frequency, min_roundup_amount, max_roundup_per_transaction,
  target_vault, is_active, is_paused, created_at, updated_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000',
  'Aggressive Dollar Rounding',
  'Round up to nearest dollar with no per-transaction cap, processed via batch',
  'nearest_dollar',
  'batch',
  '1000', -- 0.0001 XLM (very low minimum)
  '999999999', -- 99.9999 XLM (high cap)
  'locked',
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Example Round-up Records (Pending)
INSERT INTO roundup_records (
  user_id, config_id, status, trigger_source,
  roundup_amount, original_amount, method_applied,
  transaction_reference, trigger_timestamp, metadata,
  created_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM roundup_configs WHERE name = 'Daily Dollar Rounding' LIMIT 1),
  'pending',
  'transaction',
  '660000', -- 0.066 XLM ($0.66)
  '13340000', -- 1.334 XLM ($12.34)
  'nearest_dollar',
  'txn_20241020_001',
  CURRENT_TIMESTAMP - INTERVAL '2 hours',
  '{"platform": "card_swipe", "merchant": "coffee_shop"}',
  CURRENT_TIMESTAMP - INTERVAL '2 hours'
),
(
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM roundup_configs WHERE name = 'Daily Dollar Rounding' LIMIT 1),
  'pending',
  'transaction',
  '1000000', -- 0.1 XLM ($1.00)
  '24000000', -- 2.4 XLM ($24.00)
  'nearest_dollar',
  'txn_20241020_002',
  CURRENT_TIMESTAMP - INTERVAL '1 hour',
  '{"platform": "debit_card", "merchant": "grocery_store"}',
  CURRENT_TIMESTAMP - INTERVAL '1 hour'
),
(
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM roundup_configs WHERE name = 'Percentage Savings' LIMIT 1),
  'pending',
  'transaction',
  '500000', -- 0.05 XLM (2% of $5.00)
  '25000000', -- 2.5 XLM ($25.00)
  'percentage',
  'txn_20241020_003',
  CURRENT_TIMESTAMP - INTERVAL '30 minutes',
  '{"platform": "mobile_pay", "merchant": "restaurant", "percentage": 2}',
  CURRENT_TIMESTAMP - INTERVAL '30 minutes'
);

-- Example Completed Round-up Record
INSERT INTO roundup_records (
  user_id, config_id, status, trigger_source,
  roundup_amount, original_amount, method_applied,
  transaction_reference, trigger_timestamp,
  deposit_tx_hash, deposit_ledger, metadata,
  created_at, processed_at
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM roundup_configs WHERE name = 'Weekly Quarter Rounding' LIMIT 1),
  'completed',
  'transaction',
  '2500000', -- 0.25 XLM ($0.25)
  '12340000', -- 1.234 XLM ($12.34)
  'nearest_quarter',
  'txn_20241019_001',
  CURRENT_TIMESTAMP - INTERVAL '24 hours',
  'tx_1729432800_abc123def456',
  12345,
  '{"platform": "card_swipe", "merchant": "retail"}',
  CURRENT_TIMESTAMP - INTERVAL '24 hours',
  CURRENT_TIMESTAMP - INTERVAL '23 hours'
);

-- Example Completed Batch
INSERT INTO roundup_batches (
  record_count, total_amount, status,
  successful_count, failed_count,
  deposit_tx_hash, deposit_ledger, metadata,
  created_at, processing_started_at, processed_at, updated_at
) VALUES
(
  3,
  '2500000', -- 0.25 XLM total
  'completed',
  3,
  0,
  'tx_batch_1729432800_batch001',
  12345,
  '{"trigger": "daily_scheduler", "method": "nearest_dollar"}',
  CURRENT_TIMESTAMP - INTERVAL '24 hours',
  CURRENT_TIMESTAMP - INTERVAL '24 hours',
  CURRENT_TIMESTAMP - INTERVAL '23 hours',
  CURRENT_TIMESTAMP - INTERVAL '23 hours'
);

-- Notes:
-- 1. Replace user_id '550e8400-e29b-41d4-a716-446655440000' with actual test user IDs
-- 2. Run this seed file with: npm run typeorm migration:run -- --transaction false
-- 3. Or use: psql -U stow_user -d stow_db -f roundup-seed.sql
-- 4. To clear seed data: DELETE FROM roundup_batches; DELETE FROM roundup_records; DELETE FROM roundup_configs;
