import {
  Controller,
  Get,
  Post,
  Param,
  Patch,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { NftRewardsService } from './services/nft-rewards.service';
import { UserMilestonesResponseDto } from './dto/milestone-progress.dto';
import { UserNftReward, NftRewardStatus } from './entities/user-nft-reward.entity';

@ApiTags('NFT Rewards')
@Controller('nft-rewards')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NftRewardsController {
  constructor(private readonly nftRewardsService: NftRewardsService) {}

  @Get('milestones/progress')
  @ApiOperation({
    summary: 'Get user milestone progress',
    description:
      'Returns all active milestones with user progress and earned status',
  })
  async getMilestoneProgress(
    @CurrentUser() user: User,
  ): Promise<UserMilestonesResponseDto> {
    return this.nftRewardsService.getUserMilestoneProgress(user.id);
  }

  @Get('rewards')
  @ApiOperation({
    summary: 'Get user NFT rewards',
    description: 'Lists all NFT rewards earned by the user',
  })
  async getRewards(@CurrentUser() user: User): Promise<UserNftReward[]> {
    return this.nftRewardsService.getUserRewards(user.id);
  }

  @Get('rewards/:rewardId')
  @ApiOperation({
    summary: 'Get reward details',
    description: 'Get full details of a specific reward including NFT metadata',
  })
  async getReward(@Param('rewardId') rewardId: string): Promise<UserNftReward> {
    return this.nftRewardsService.getReward(rewardId);
  }

  @Post('evaluate')
  @ApiOperation({
    summary: 'Evaluate and mint pending rewards',
    description:
      'Checks all milestones and creates NFTs for newly earned achievements',
  })
  async evaluateRewards(@CurrentUser() user: User): Promise<{ status: string }> {
    await this.nftRewardsService.evaluateAndMintRewards(user.id);
    return { status: 'Evaluation complete' };
  }

  @Patch('rewards/:rewardId/transfer')
  @ApiOperation({
    summary: 'Mark reward as transferred',
    description:
      'Records that an NFT reward was transferred (fails if soulbound)',
  })
  async transferReward(
    @Param('rewardId') rewardId: string,
    @CurrentUser() user: User,
  ): Promise<UserNftReward> {
    const reward = await this.nftRewardsService.getReward(rewardId);

    // Ensure user owns this reward
    if (reward.user_id !== user.id) {
      throw new BadRequestException('You do not own this reward');
    }

    return this.nftRewardsService.updateRewardStatus(
      rewardId,
      NftRewardStatus.TRANSFERRED,
    );
  }
}
