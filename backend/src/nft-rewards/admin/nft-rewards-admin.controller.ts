import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NftRewardMilestone, MilestoneType } from '../entities/nft-reward-milestone.entity';
import { NftRewardsAdminService } from './nft-rewards-admin.service';

@ApiTags('Admin - NFT Rewards')
@Controller('admin/nft-rewards')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth()
export class NftRewardsAdminController {
  constructor(private readonly adminService: NftRewardsAdminService) {}

  @Get('milestones')
  @ApiOperation({
    summary: 'List all milestones',
    description: 'Admin endpoint to view all configured milestones',
  })
  async listMilestones(
    @Query('active') active?: boolean,
  ): Promise<NftRewardMilestone[]> {
    if (active !== undefined) {
      return this.adminService.listMilestones(active);
    }
    return this.adminService.listMilestones();
  }

  @Get('milestones/:milestoneId')
  @ApiOperation({ summary: 'Get milestone details' })
  async getMilestone(
    @Param('milestoneId') milestoneId: string,
  ): Promise<NftRewardMilestone> {
    return this.adminService.getMilestone(milestoneId);
  }

  @Post('milestones')
  @ApiOperation({
    summary: 'Create a new milestone',
    description: 'Creates a new NFT reward milestone',
  })
  async createMilestone(
    @Body() data: CreateMilestoneDto,
  ): Promise<NftRewardMilestone> {
    return this.adminService.createMilestone(data);
  }

  @Put('milestones/:milestoneId')
  @ApiOperation({
    summary: 'Update a milestone',
    description: 'Updates an existing milestone configuration',
  })
  async updateMilestone(
    @Param('milestoneId') milestoneId: string,
    @Body() data: UpdateMilestoneDto,
  ): Promise<NftRewardMilestone> {
    return this.adminService.updateMilestone(milestoneId, data);
  }

  @Post('milestones/:milestoneId/deactivate')
  @ApiOperation({
    summary: 'Deactivate a milestone',
    description: 'New users cannot earn this milestone, existing rewards unaffected',
  })
  async deactivateMilestone(
    @Param('milestoneId') milestoneId: string,
  ): Promise<NftRewardMilestone> {
    return this.adminService.updateMilestone(milestoneId, { is_active: false });
  }

  @Get('stats')
  @ApiOperation({
    summary: 'NFT rewards statistics',
    description: 'Overall stats on milestone distribution and rewards',
  })
  async getStats(): Promise<{
    total_milestones: number;
    active_milestones: number;
    total_rewards_earned: number;
    total_rewards_minted: number;
    rewards_by_rarity: Record<number, number>;
  }> {
    return this.adminService.getStats();
  }

  @Get('user-rewards/:userId')
  @ApiOperation({
    summary: 'Get all rewards for a user',
    description: 'Admin view of specific user rewards',
  })
  async getUserRewards(@Param('userId') userId: string) {
    return this.adminService.getUserRewardsAdmin(userId);
  }
}

export class CreateMilestoneDto {
  milestone_type: MilestoneType;
  threshold: number;
  name: string;
  description: string;
  nft_title: string;
  nft_description: string;
  image_ipfs_cid: string;
  rarity_tier?: number;
  is_soulbound?: boolean;
}

export class UpdateMilestoneDto {
  name?: string;
  description?: string;
  nft_title?: string;
  nft_description?: string;
  image_ipfs_cid?: string;
  rarity_tier?: number;
  is_soulbound?: boolean;
  is_active?: boolean;
}
