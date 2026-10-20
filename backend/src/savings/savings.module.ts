import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsModule } from '../goals/goals.module';
import { AnchorController } from './anchor.controller';
import { AnchorCallbackController } from './anchor-callback.controller';
import { AnchorService } from './anchor.service';
import { AnchorDeposit } from './entities/anchor-deposit.entity';
import { Balance } from './entities/balance.entity';
import { Group } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { BalanceService } from './balance.service';
import { GroupsService } from './groups.service';
import { LockedPlansService } from './locked-plans.service';
import { BalanceController } from './balance.controller';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { YieldPosition } from './entities/yield-position.entity';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnchorDeposit, Balance, Group, GroupMember, YieldPosition]),
    CacheModule.register({ ttl: 10_000 }),
    GoalsModule,
    ReferralModule,
  ],
  controllers: [AnchorController, AnchorCallbackController, BalanceController, SavingsController],
  providers: [
    AnchorService,
    BalanceService,
    GroupsService,
    LockedPlansService,
    SavingsService,
  ],
  exports: [AnchorService, BalanceService, GroupsService, LockedPlansService],
})
export class SavingsModule {}
