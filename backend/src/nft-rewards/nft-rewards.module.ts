import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NftRewardMilestone } from './entities/nft-reward-milestone.entity';
import { UserNftReward } from './entities/user-nft-reward.entity';
import { NftRewardsService } from './services/nft-rewards.service';
import { NftRewardsController } from './nft-rewards.controller';
import { MilestoneEvaluatorService } from './services/milestone-evaluator.service';
import { NftMetadataService } from './services/nft-metadata.service';
import { NftRewardsAdminController } from './admin/nft-rewards-admin.controller';
import { NftRewardsAdminService } from './admin/nft-rewards-admin.service';
import { User } from '../users/entities/user.entity';
import { Balance } from '../savings/entities/balance.entity';
import { Goal } from '../goals/entities/goal.entity';
import { ContractEvent } from '../indexer/entities/contract-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NftRewardMilestone,
      UserNftReward,
      User,
      Balance,
      Goal,
      ContractEvent,
    ]),
  ],
  controllers: [NftRewardsController, NftRewardsAdminController],
  providers: [
    NftRewardsService,
    NftRewardsAdminService,
    MilestoneEvaluatorService,
    NftMetadataService,
  ],
  exports: [NftRewardsService],
})
export class NftRewardsModule {}
