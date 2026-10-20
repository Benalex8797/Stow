import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum RoundupBatchStatus {
  PENDING = 'pending',        // Waiting to process
  PROCESSING = 'processing',  // Currently processing
  COMPLETED = 'completed',    // All records processed
  PARTIAL = 'partial',        // Some failed
  FAILED = 'failed',          // All failed
  CANCELLED = 'cancelled',    // User cancelled
}

/**
 * Represents a batch of round-ups to be processed together.
 * Used for efficient bulk deposit operations.
 */
@Entity('roundup_batches')
@Index(['status'])
@Index(['created_at'])
@Index(['processed_at'])
export class RoundupBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Number of individual roundups in this batch */
  @Column({ type: 'int', default: 0 })
  record_count: number;

  /** Total amount to be deposited (stroops) */
  @Column({ type: 'varchar' })
  total_amount: string;

  /** Current batch status */
  @Column({
    type: 'enum',
    enum: RoundupBatchStatus,
    default: RoundupBatchStatus.PENDING,
  })
  status: RoundupBatchStatus;

  /** Number of successfully processed records */
  @Column({ type: 'int', default: 0 })
  successful_count: number;

  /** Number of failed records */
  @Column({ type: 'int', default: 0 })
  failed_count: number;

  /** On-chain batch deposit transaction hash */
  @Column({ type: 'varchar', nullable: true })
  deposit_tx_hash: string | null;

  /** Ledger number of batch completion */
  @Column({ type: 'bigint', nullable: true })
  deposit_ledger: number | null;

  /** Error message if batch failed */
  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  /** Batch processing metadata */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  /** When batch processing started */
  @Column({ type: 'timestamptz', nullable: true })
  processing_started_at: Date | null;

  /** When batch processing completed */
  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @UpdateDateColumn()
  updated_at: Date;
}
