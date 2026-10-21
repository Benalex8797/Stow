import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum MilestoneType {
  SAVINGS_AMOUNT = 'savings_amount',
  GOALS_REACHED = 'goals_reached',
  CONSECUTIVE_DEPOSITS = 'consecutive_deposits',
  ACTIVITY_STREAK = 'activity_streak',
}

/**
 * Defines an NFT reward milestone that triggers when a user reaches
 * a specific achievement threshold. Each milestone has associated
 * metadata for NFT generation.
 */
@Entity('nft_reward_milestones')
@Index(['milestone_type'])
@Index(['threshold'])
export class NftRewardMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: MilestoneType,
  })
  milestone_type: MilestoneType;

  /** Threshold value (e.g., amount in stroops, count of goals, days of streak) */
  @Column({ type: 'bigint' })
  threshold: number;

  /** Human-readable name (e.g., "First 1000 XLM Saved") */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Description of the achievement */
  @Column({ type: 'text' })
  description: string;

  /** NFT metadata: title for the NFT */
  @Column({ type: 'varchar', length: 255 })
  nft_title: string;

  /** NFT metadata: description for the NFT */
  @Column({ type: 'text' })
  nft_description: string;

  /** IPFS CID for the base image */
  @Column({ type: 'varchar', length: 255 })
  image_ipfs_cid: string;

  /** Rarity/tier level (1-5) */
  @Column({ type: 'int', default: 1 })
  rarity_tier: number;

  /** Whether new users can still earn this milestone */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Marks if NFT transfer is restricted (soulbound) */
  @Column({ type: 'boolean', default: false })
  is_soulbound: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
