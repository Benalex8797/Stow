import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserNftReward, NftRewardStatus } from '../entities/user-nft-reward.entity';
import { NftRewardMilestone, MilestoneType } from '../entities/nft-reward-milestone.entity';
import { User } from '../../users/entities/user.entity';
import { MilestoneEvaluatorService } from './milestone-evaluator.service';
import { NftMetadataService } from './nft-metadata.service';
import {
  MilestoneProgressDto,
  UserMilestonesResponseDto,
} from '../dto/milestone-progress.dto';

/**
 * Orchestrates milestone tracking, evaluation, and NFT reward generation.
 * Evaluates user progress and checks for newly earned milestones.
 */
@Injectable()
export class NftRewardsService {
  private readonly logger = new Logger(NftRewardsService.name);

  constructor(
    @InjectRepository(UserNftReward)
    private readonly rewardRepository: Repository<UserNftReward>,
    @InjectRepository(NftRewardMilestone)
    private readonly milestoneRepository: Repository<NftRewardMilestone>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly milestoneEvaluatorService: MilestoneEvaluatorService,
    private readonly nftMetadataService: NftMetadataService,
  ) {}

  /**
   * Evaluates all active milestones for a user and returns progress on each.
   * Automatically mints NFTs for newly earned milestones.
   */
  async evaluateAndMintRewards(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const milestones = await this.milestoneRepository.find({
      where: { is_active: true },
    });

    for (const milestone of milestones) {
      // Check if user already has this reward
      const existing = await this.rewardRepository.findOne({
        where: {
          user_id: userId,
          milestone_id: milestone.id,
        },
      });

      if (existing) {
        continue; // Already earned or minted
      }

      // Evaluate progress
      const progress = await this.milestoneEvaluatorService.getProgress(
        user.stellar_address,
        milestone.milestone_type,
      );

      // Check if threshold reached
      if (progress >= milestone.threshold) {
        await this.createAndMintReward(userId, milestone);
      }
    }
  }

  /**
   * Creates a new reward record and generates its metadata.
   * In production, this would also trigger minting on-chain.
   */
  private async createAndMintReward(
    userId: string,
    milestone: NftRewardMilestone,
  ): Promise<UserNftReward> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const reward = this.rewardRepository.create({
      user_id: userId,
      milestone_id: milestone.id,
      status: NftRewardStatus.EARNED,
    });

    const saved = await this.rewardRepository.save(reward);

    // Generate metadata
    const { cid } = await this.nftMetadataService.generateAndPinMetadata({
      user_address: user.stellar_address,
      milestone_name: milestone.nft_title,
      milestone_type: milestone.milestone_type,
      image_ipfs_cid: milestone.image_ipfs_cid,
      earned_date: new Date(),
      rarity_tier: milestone.rarity_tier,
      is_soulbound: milestone.is_soulbound,
    });

    saved.metadata_ipfs_cid = cid;
    saved.status = NftRewardStatus.MINTED;
    saved.minted_at = new Date();

    await this.rewardRepository.save(saved);

    this.logger.log(
      `NFT reward minted for user ${userId}, milestone ${milestone.id}`,
    );

    return saved;
  }

  /**
   * Gets the user's milestone progress across all active milestones.
   */
  async getUserMilestoneProgress(
    userId: string,
  ): Promise<UserMilestonesResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const milestones = await this.milestoneRepository.find({
      where: { is_active: true },
      order: { threshold: 'ASC' },
    });

    const earnedRewards = await this.rewardRepository.find({
      where: { user_id: userId },
    });
    const earnedMilestoneIds = new Set(
      earnedRewards.map((r) => r.milestone_id),
    );

    const completed: MilestoneProgressDto[] = [];
    const inProgress: MilestoneProgressDto[] = [];

    for (const milestone of milestones) {
      const progress = await this.milestoneEvaluatorService.getProgress(
        user.stellar_address,
        milestone.milestone_type,
      );

      const isEarned = earnedMilestoneIds.has(milestone.id);
      const earnedReward = earnedRewards.find(
        (r) => r.milestone_id === milestone.id,
      );

      const progressDto: MilestoneProgressDto = {
        milestone_id: milestone.id,
        milestone_type: milestone.milestone_type,
        name: milestone.name,
        description: milestone.description,
        threshold: milestone.threshold,
        current_value: progress,
        progress_percentage: Math.min(
          100,
          Math.round((progress / milestone.threshold) * 100),
        ),
        is_earned: isEarned,
        earned_at: earnedReward?.earned_at,
        rarity_tier: milestone.rarity_tier,
        is_soulbound: milestone.is_soulbound,
      };

      if (isEarned) {
        completed.push(progressDto);
      } else {
        inProgress.push(progressDto);
      }
    }

    return {
      total_milestones: milestones.length,
      earned_count: completed.length,
      in_progress: inProgress,
      completed,
    };
  }

  /**
   * Gets a specific reward by ID with full details.
   */
  async getReward(rewardId: string): Promise<UserNftReward> {
    const reward = await this.rewardRepository.findOne({
      where: { id: rewardId },
      relations: ['milestone'],
    });

    if (!reward) {
      throw new NotFoundException(`Reward ${rewardId} not found`);
    }

    return reward;
  }

  /**
   * Lists all rewards for a user.
   */
  async getUserRewards(userId: string): Promise<UserNftReward[]> {
    return this.rewardRepository.find({
      where: { user_id: userId },
      relations: ['milestone'],
      order: { earned_at: 'DESC' },
    });
  }

  /**
   * Updates reward status (e.g., mark as transferred).
   * Prevents transfer if milestone is soulbound.
   */
  async updateRewardStatus(
    rewardId: string,
    newStatus: NftRewardStatus,
  ): Promise<UserNftReward> {
    const reward = await this.rewardRepository.findOne({
      where: { id: rewardId },
      relations: ['milestone'],
    });

    if (!reward) {
      throw new NotFoundException(`Reward ${rewardId} not found`);
    }

    // Check soulbound restriction
    if (
      newStatus === NftRewardStatus.TRANSFERRED &&
      reward.milestone.is_soulbound
    ) {
      throw new Error('Cannot transfer soulbound NFT');
    }

    reward.status = newStatus;
    if (newStatus === NftRewardStatus.TRANSFERRED) {
      reward.transferred_at = new Date();
    }

    return this.rewardRepository.save(reward);
  }
}
