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
import { NftRewardMilestone } from './nft-reward-milestone.entity';

export enum NftRewardStatus {
  EARNED = 'earned',
  MINTED = 'minted',
  TRANSFERRED = 'transferred',
}

/**
 * Tracks an NFT reward earned by a user upon reaching a milestone.
 * Associates the user with a milestone and stores metadata for the minted NFT.
 */
@Entity('user_nft_rewards')
@Index(['user_id'])
@Index(['milestone_id'])
@Index(['status'])
@Index(['created_at'])
@Unique('UQ_user_milestone_reward', ['user_id', 'milestone_id'])
export class UserNftReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  milestone_id: string;

  @ManyToOne(() => NftRewardMilestone, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'milestone_id' })
  milestone: NftRewardMilestone;

  /** Current status of the reward (earned→minted→transferred) */
  @Column({
    type: 'enum',
    enum: NftRewardStatus,
    default: NftRewardStatus.EARNED,
  })
  status: NftRewardStatus;

  /** On-chain NFT contract address (once minted) */
  @Column({ type: 'varchar', length: 56, nullable: true })
  nft_contract_address: string | null;

  /** NFT token ID (once minted) */
  @Column({ type: 'varchar', nullable: true })
  nft_token_id: string | null;

  /** IPFS CID for the generated NFT metadata JSON */
  @Column({ type: 'varchar', length: 255, nullable: true })
  metadata_ipfs_cid: string | null;

  /** Transaction hash of the minting transaction */
  @Column({ type: 'varchar', length: 255, nullable: true })
  mint_tx_hash: string | null;

  /** Ledger number when NFT was minted */
  @Column({ type: 'bigint', nullable: true })
  mint_ledger: number | null;

  /** Timestamp when reward was earned */
  @CreateDateColumn()
  earned_at: Date;

  /** Timestamp when NFT was minted */
  @Column({ type: 'timestamptz', nullable: true })
  minted_at: Date | null;

  /** Timestamp when NFT was transferred off-chain */
  @Column({ type: 'timestamptz', nullable: true })
  transferred_at: Date | null;

  @UpdateDateColumn()
  updated_at: Date;
}
