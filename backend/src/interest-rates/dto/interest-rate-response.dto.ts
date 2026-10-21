export class CurrentInterestRateDto {
  /** Current APY rate as percentage (e.g., 5.25) */
  apy: string;

  /** Current utilization ratio (0-1) */
  utilization: string;

  /** Total liquidity in stroops */
  total_liquidity: string;

  /** Total utilized/borrowed in stroops */
  total_utilization: string;

  /** Rate configuration being used */
  config_id: string;
  config_name: string;

  /** When this rate was calculated */
  calculated_at: Date;

  /** Next scheduled recalculation time */
  next_update_at?: Date;
}

export class InterestRateHistoryDto {
  id: string;
  calculated_rate: string;
  utilization_ratio: string;
  previous_rate: string;
  rate_delta: string;
  created_at: Date;
  config_name: string;
}

export class RateProjectionDto {
  /** Projected APY at given utilization (0-1) */
  projected_rate: string;

  /** Utilization scenario */
  utilization: string;

  /** Config used for projection */
  config: {
    id: string;
    name: string;
    base_rate: string;
    max_rate: string;
    optimal_utilization: string;
  };
}

export class UtilizationMetricsDto {
  /** Current utilization (0-1) */
  current_utilization: string;

  /** Total available liquidity */
  available_liquidity: string;

  /** Total borrowed */
  borrowed_amount: string;

  /** Threshold at which utilization triggers rate increase */
  optimal_utilization: string;

  /** How far above/below optimal (positive = above) */
  utilization_above_optimal: string | null;

  /** Percentage of max before rates hit ceiling */
  headroom_to_max: string;
}
