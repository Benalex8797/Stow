-- Dynamic Interest Rates - Initial Configuration Seed Data
-- Run this to populate initial rate configurations

-- Conservative Configuration
INSERT INTO interest_rate_configs (
  name, description, asset,
  base_rate, min_rate, max_rate,
  optimal_utilization, slope_up, slope_down,
  smoothing_factor, is_active
) VALUES (
  'Conservative Vault',
  'Low-risk configuration with gradual rate increases',
  'USDC',
  2.0, 0.5, 25.0,
  0.80, 0.03, 0.15,
  0.15, false
);

-- Main Vault Configuration (Active)
INSERT INTO interest_rate_configs (
  name, description, asset,
  base_rate, min_rate, max_rate,
  optimal_utilization, slope_up, slope_down,
  smoothing_factor, is_active
) VALUES (
  'Main Vault',
  'Standard interest rate configuration for primary vault',
  'USDC',
  2.5, 0.25, 40.0,
  0.85, 0.05, 0.25,
  0.1, true
);

-- Growth Configuration
INSERT INTO interest_rate_configs (
  name, description, asset,
  base_rate, min_rate, max_rate,
  optimal_utilization, slope_up, slope_down,
  smoothing_factor, is_active
) VALUES (
  'Growth Vault',
  'Aggressive configuration with steep rate increases',
  'USDC',
  3.0, 0.1, 75.0,
  0.90, 0.10, 0.50,
  0.05, false
);

-- Premium Locked Plans
INSERT INTO interest_rate_configs (
  name, description, asset,
  base_rate, min_rate, max_rate,
  optimal_utilization, slope_up, slope_down,
  smoothing_factor, is_active
) VALUES (
  'Premium Locked Plans',
  'Higher base rate for locked positions',
  'USDC',
  4.0, 1.0, 50.0,
  0.80, 0.04, 0.20,
  0.12, false
);

-- Yield Adapter Configuration
INSERT INTO interest_rate_configs (
  name, description, asset,
  base_rate, min_rate, max_rate,
  optimal_utilization, slope_up, slope_down,
  smoothing_factor, is_active
) VALUES (
  'Yield Adapter',
  'Configuration for yield adapter protocol integration',
  'USDC',
  3.5, 0.5, 60.0,
  0.85, 0.07, 0.35,
  0.08, false
);

-- Verify seeding
SELECT 
  name,
  base_rate,
  max_rate,
  optimal_utilization,
  is_active,
  created_at
FROM interest_rate_configs
ORDER BY is_active DESC, created_at DESC;
