import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { RoundupConfig } from './roundup-config.entity';

export enum RoundupRecordStatus {
  PENDING = 'pending',        // Accumulated, waiting to process
  PROCESSING = 'processing',  // Currently being processed
  COMPLETED = 'completed',    // Successfully deposited
  FAILED = 'failed',          // Failed to deposit
  CANCELLED = 'cancelled',    // User cancelled
}

export enum RoundupTriggerSource {
  TRANSACTION = 'transaction',      // From transaction round-up
  EXTERNAL = 'external',            // From external trigger
  WEBHOOK = 'webhook',              // From webhook
  API = 'api',                       // Direct API call
  SCHEDULED = 'scheduled',          // Scheduled job
}

/**
 * Audit trail of round-up events.
 * Records each time a round-up is accumulated or processed.
 */
@Entity('roundup_records')
@Index(['user_id', 'created_at'])
@Index(['config_id'])
@Index(['status'])
@Index(['created_at'])
export class RoundupRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  config_id: string;

  @ManyToOne(() => RoundupConfig, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'config_id' })
  config: RoundupConfig;

  /** Current status of this roundup */
  @Column({ type: 'enum', enum: RoundupRecordStatus })
  status: RoundupRecordStatus;

  /** How this roundup was triggered */
  @Column({ type: 'enum', enum: RoundupTriggerSource })
  trigger_source: RoundupTriggerSource;

  /** Amount rounded up (stroops) */
  @Column({ type: 'varchar' })
  roundup_amount: string;

  /** Original transaction amount (stroops, if from transaction) */
  @Column({ type: 'varchar', nullable: true })
  original_amount: string | null;

  /** Rounding method applied */
  @Column({ type: 'varchar', nullable: true })
  method_applied: string | null;

  /** Transaction reference (hash, order ID, etc.) */
  @Column({ type: 'varchar', nullable: true })
  transaction_reference: string | null;

  /** Timestamp of the triggering transaction/event */
  @Column({ type: 'timestamptz', nullable: true })
  trigger_timestamp: Date | null;

  /** On-chain deposit transaction hash (once completed) */
  @Column({ type: 'varchar', nullable: true })
  deposit_tx_hash: string | null;

  /** Ledger number of completion */
  @Column({ type: 'bigint', nullable: true })
  deposit_ledger: number | null;

  /** Error message if failed */
  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  /** Batch ID if part of batch processing */
  @Column({ type: 'uuid', nullable: true })
  batch_id: string | null;

  /** Processing metadata (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  /** When status changed to COMPLETED or FAILED */
  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;
}
