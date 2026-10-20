import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum OracleSourceType {
  STELLAR_QUEST = 'stellar_quest',
  CHAINLINK = 'chainlink',
  BAND_PROTOCOL = 'band_protocol',
  ANCHOR = 'anchor',
  MANUAL = 'manual',
}

/**
 * Caches oracle price data for various assets.
 * Used to factor external market conditions into interest rate calculations.
 */
@Entity('oracle_data')
@Index(['asset', 'source_type'])
@Index(['updated_at'])
export class OracleData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Asset symbol (e.g., "USDC", "XLM", "BTC") */
  @Column({ type: 'varchar', length: 12 })
  asset: string;

  /** Source of this price data */
  @Column({ type: 'enum', enum: OracleSourceType })
  source_type: OracleSourceType;

  /**
   * Price in USD (if available) or reference currency.
   * Stored as string for precision: "1.00", "0.10", etc.
   */
  @Column({ type: 'varchar', nullable: true })
  price_usd: string | null;

  /**
   * Price relative to base asset (e.g., stroops per USDC).
   * Stored as string to avoid precision loss.
   */
  @Column({ type: 'varchar', nullable: true })
  price_base: string | null;

  /** Confidence score (0-1) for this price if available */
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  confidence: string | null;

  /** Timestamp when this price was observed on-chain/off-chain */
  @Column({ type: 'timestamptz' })
  price_timestamp: Date;

  /** Whether this price is still considered valid */
  @Column({ type: 'boolean', default: true })
  is_valid: boolean;

  /** Optional note about data quality or source */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
