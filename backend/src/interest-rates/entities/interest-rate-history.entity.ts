import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { InterestRateConfig } from './interest-rate-config.entity';

/**
 * Historical record of computed interest rates.
 * Tracks rate calculations over time for analytics and auditing.
 */
@Entity('interest_rate_history')
@Index(['config_id', 'created_at'])
@Index(['created_at'])
export class InterestRateHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  config_id: string;

  @ManyToOne(() => InterestRateConfig, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'config_id' })
  config: InterestRateConfig;

  /**
   * Calculated APY rate at this point in time.
   * Stored as percentage: 5.25 = 5.25%
   */
  @Column({ type: 'numeric', precision: 10, scale: 4 })
  calculated_rate: string;

  /**
   * Utilization rate at time of calculation (0.0 - 1.0).
   * Stored as decimal: 0.75 = 75% utilization
   */
  @Column({ type: 'numeric', precision: 5, scale: 4 })
  utilization_ratio: string;

  /** Total available liquidity (stroops) at time of calculation */
  @Column({ type: 'varchar' })
  total_liquidity: string;

  /** Total borrowed/utilized amount (stroops) */
  @Column({ type: 'varchar' })
  total_utilization: string;

  /** Oracle price if applicable (stroops per asset) */
  @Column({ type: 'varchar', nullable: true })
  oracle_price: string | null;

  /** Previous rate before this calculation */
  @Column({ type: 'numeric', precision: 10, scale: 4 })
  previous_rate: string;

  /** Rate of change from previous rate */
  @Column({ type: 'numeric', precision: 10, scale: 4 })
  rate_delta: string;

  @CreateDateColumn()
  created_at: Date;
}
