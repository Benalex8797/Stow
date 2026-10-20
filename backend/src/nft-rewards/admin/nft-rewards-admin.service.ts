import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NftRewardMilestone } from '../entities/nft-reward-milestone.entity';
import { UserNftReward, NftRewardStatus } from '../entities/user-nft-reward.entity';
import { CreateMilestoneDto, UpdateMilestoneDto } from './nft-rewards-admin.controller';

/**
 * Admin service for milestone configuration and statistics.
 */
@Injectable()
export class NftRewardsAdminService {
  constructor(
    @InjectRepository(NftRewardMilestone)
    private readonly milestoneRepository: Repository<NftRewardMilestone>,
    @InjectRepository(UserNftReward)
    private readonly rewardRepository: Repository<UserNftReward>,
  ) {}

  async listMilestones(active?: boolean): Promise<NftRewardMilestone[]> {
    const query = this.milestoneRepository.createQueryBuilder('milestone');

    if (active !== undefined) {
      query.where('milestone.is_active = :active', { active });
    }

    return query.orderBy('milestone.rarity_tier', 'ASC')
      .addOrderBy('milestone.threshold', 'ASC')
      .getMany();
  }

  async getMilestone(milestoneId: string): Promise<NftRewardMilestone> {
    const milestone = await this.milestoneRepository.findOne({
      where: { id: milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone ${milestoneId} not found`);
    }

    return milestone;
  }

  async createMilestone(data: CreateMilestoneDto): Promise<NftRewardMilestone> {
    const milestone = this.milestoneRepository.create({
      milestone_type: data.milestone_type,
      threshold: data.threshold,
      name: data.name,
      description: data.description,
      nft_title: data.nft_title,
      nft_description: data.nft_description,
      image_ipfs_cid: data.image_ipfs_cid,
      rarity_tier: data.rarity_tier ?? 1,
      is_soulbound: data.is_soulbound ?? false,
      is_active: true,
    });

    return this.milestoneRepository.save(milestone);
  }

  async updateMilestone(
    milestoneId: string,
    data: UpdateMilestoneDto,
  ): Promise<NftRewardMilestone> {
    const milestone = await this.getMilestone(milestoneId);

    Object.assign(milestone, data);

    return this.milestoneRepository.save(milestone);
  }

  async getStats(): Promise<{
    total_milestones: number;
    active_milestones: number;
    total_rewards_earned: number;
    total_rewards_minted: number;
    rewards_by_rarity: Record<number, number>;
  }> {
    const [milestones, rewards] = await Promise.all([
      this.milestoneRepository.find(),
      this.rewardRepository.find({ relations: ['milestone'] }),
    ]);

    const activeMilestones = milestones.filter((m) => m.is_active).length;

    const rewardsByStatus = {
      earned: rewards.filter((r) => r.status === NftRewardStatus.EARNED).length,
      minted: rewards.filter((r) => r.status === NftRewardStatus.MINTED).length,
      transferred: rewards.filter((r) => r.status === NftRewardStatus.TRANSFERRED)
        .length,
    };

    const rewardsByRarity: Record<number, number> = {};
    for (const reward of rewards) {
      const tier = reward.milestone.rarity_tier;
      rewardsByRarity[tier] = (rewardsByRarity[tier] ?? 0) + 1;
    }

    return {
      total_milestones: milestones.length,
      active_milestones: activeMilestones,
      total_rewards_earned: rewards.length,
      total_rewards_minted: rewardsByStatus.minted,
      rewards_by_rarity: rewardsByRarity,
    };
  }

  async getUserRewardsAdmin(userId: string) {
    const rewards = await this.rewardRepository.find({
      where: { user_id: userId },
      relations: ['milestone', 'user'],
      order: { earned_at: 'DESC' },
    });

    return {
      user_id: userId,
      total_rewards: rewards.length,
      by_status: {
        earned: rewards.filter((r) => r.status === NftRewardStatus.EARNED).length,
        minted: rewards.filter((r) => r.status === NftRewardStatus.MINTED).length,
        transferred: rewards.filter((r) => r.status === NftRewardStatus.TRANSFERRED)
          .length,
      },
      rewards,
    };
  }
}
