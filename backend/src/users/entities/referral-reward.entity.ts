import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserReferral } from './user-referral.entity';

export enum RewardType {
  REFERRER_BONUS = 'referrer_bonus',
  REFEREE_BONUS = 'referee_bonus',
}

export enum RewardStatus {
  PENDING = 'pending',
  ISSUED = 'issued',
  CANCELLED = 'cancelled',
}

/**
 * Tracks a reward associated with a referral relationship.
 * Created when a referral qualifies (referred user completes a qualifying
 * action). One row per reward type per referral (at most two rows per
 * qualifying referral: one for the referrer, one for the referee).
 */
@Entity('referral_rewards')
@Index(['referral_id'])
@Index(['recipient_id'])
@Index(['status'])
export class ReferralReward {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty()
  referral_id: string;

  @ManyToOne(() => UserReferral, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referral_id' })
  referral: UserReferral;

  /** User who receives this reward (referrer or referee). */
  @Column({ type: 'uuid' })
  @ApiProperty()
  recipient_id: string;

  @Column({ type: 'enum', enum: RewardType })
  @ApiProperty({ enum: RewardType })
  type: RewardType;

  /**
   * Reward amount in the platform's smallest unit (e.g. stroops or basis
   * points). The concrete value is driven by REFERRAL_REWARD_AMOUNT_STROOPS
   * in config, defaulting to 1_000_000 (1 XLM equivalent).
   */
  @Column({ type: 'bigint' })
  @ApiProperty()
  amount: string;

  @Column({ type: 'varchar', length: 20, default: 'XLM' })
  @ApiProperty()
  asset_code: string;

  @Column({ type: 'enum', enum: RewardStatus, default: RewardStatus.PENDING })
  @ApiProperty({ enum: RewardStatus })
  status: RewardStatus;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional()
  issued_at: Date | null;

  /** Metadata for the payout (e.g. transaction hash once on-chain reward issued). */
  @Column({ type: 'jsonb', nullable: true })
  @ApiPropertyOptional()
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty()
  created_at: Date;
}
