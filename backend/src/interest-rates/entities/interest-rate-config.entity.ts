import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Configuration for dynamic interest rate calculation.
 * Defines how rates are computed based on utilization and other factors.
 */
@Entity('interest_rate_configs')
@Index(['is_active'])
export class InterestRateConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Name of this rate configuration (e.g., "Main Vault", "Locked Plans") */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Description of the configuration */
  @Column({ type: 'text' })
  description: string;

  /** Asset this rate applies to (e.g., "USDC") */
  @Column({ type: 'varchar', length: 12, default: 'USDC' })
  asset: string;

  /** Base interest rate (APY) as percentage: 5.00 = 5% */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: '0' })
  base_rate: string;

  /** Minimum interest rate floor (APY percentage) */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: '0' })
  min_rate: string;

  /** Maximum interest rate ceiling (APY percentage) */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: '100' })
  max_rate: string;

  /**
   * Utilization rate at which rate curve peaks (0.0 - 1.0).
   * At this utilization, the rate is at its maximum.
   * Example: 0.85 = peak rate when 85% of deposits are utilized
   */
  @Column({ type: 'numeric', precision: 5, scale: 4, default: '0.85' })
  optimal_utilization: string;

  /**
   * Slope before optimal utilization.
   * Determines how quickly rates increase as utilization rises.
   * Example: 0.05 = 5% APY increase per 1% utilization
   */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: '0.05' })
  slope_up: string;

  /**
   * Slope after optimal utilization.
   * Determines how quickly rates increase after optimal is exceeded.
   * Usually steeper than slope_up to penalize high utilization.
   */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: '0.25' })
  slope_down: string;

  /**
   * Smoothing factor for rate changes (0-1).
   * 0 = no smoothing (instant updates), 1 = infinite smoothing
   * Typically 0.1-0.3 to dampen volatility
   */
  @Column({ type: 'numeric', precision: 5, scale: 4, default: '0.1' })
  smoothing_factor: string;

  /** Whether this configuration is currently active */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Optional note about when this config was last reviewed */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
