import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UserReferral } from '../users/entities/user-referral.entity';
import { ReferralReward } from '../users/entities/referral-reward.entity';
import { ReferralService } from '../users/referral.service';
import { ReferralController } from '../users/referral.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserReferral, ReferralReward]),
  ],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
