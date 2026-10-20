import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum RoundupMethod {
  NEAREST_DOLLAR = 'nearest_dollar',     // $12.34 → $13.00
  NEAREST_CENT = 'nearest_cent',         // $12.34 → $12.35
  NEAREST_QUARTER = 'nearest_quarter',   // $12.34 → $12.50
  PERCENTAGE = 'percentage',             // Deposit percentage of transaction
  FIXED_AMOUNT = 'fixed_amount',         // Fixed stroop amount per transaction
}

export enum RoundupFrequency {
  IMMEDIATE = 'immediate',    // Process on trigger
  DAILY = 'daily',            // Once per day
  WEEKLY = 'weekly',          // Once per week
  MONTHLY = 'monthly',        // Once per month
  BATCH = 'batch',            // Batch periodically
}

/**
 * User's savings round-up configuration.
 * Defines how much to round up and when to deposit it.
 */
@Entity('roundup_configs')
@Index(['user_id'])
@Index(['is_active'])
@Unique('UQ_user_active_config', ['user_id', 'is_active'])
export class RoundupConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Display name for this configuration (e.g., "Daily Round-ups") */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Description of what this roundup does */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Which method to use for rounding */
  @Column({ type: 'enum', enum: RoundupMethod })
  method: RoundupMethod;

  /** Method-specific parameter (e.g., percentage for PERCENTAGE method) */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  method_parameter: string | null;

  /** How often to process accumulated round-ups */
  @Column({ type: 'enum', enum: RoundupFrequency })
  frequency: RoundupFrequency;

  /** Minimum round-up amount to process (stroops) */
  @Column({ type: 'varchar', default: '1000000' })
  min_roundup_amount: string;

  /** Maximum round-up amount per transaction (stroops) */
  @Column({ type: 'varchar', default: '100000000' })
  max_roundup_per_transaction: string;

  /** Target vault for deposits (flexible, locked, goals, etc.) */
  @Column({ type: 'varchar', default: 'flexible' })
  target_vault: string;

  /** Whether this configuration is active */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Pause the roundup temporarily without deleting config */
  @Column({ type: 'boolean', default: false })
  is_paused: boolean;

  /** Pause reason/notes */
  @Column({ type: 'text', nullable: true })
  pause_reason: string | null;

  /** Last time a round-up was processed */
  @Column({ type: 'timestamptz', nullable: true })
  last_processed_at: Date | null;

  /** Next time a round-up is scheduled (for DAILY, WEEKLY, MONTHLY) */
  @Column({ type: 'timestamptz', nullable: true })
  next_scheduled_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
