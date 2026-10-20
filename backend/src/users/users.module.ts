import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserPreferences } from './entities/user-preferences.entity';
import { UserFollow } from './entities/user-follow.entity';
import { UserReferral } from './entities/user-referral.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { Notification } from '../notifications/entities/notification.entity';
import { AnchorDeposit } from '../savings/entities/anchor-deposit.entity';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserPreferences,
      UserFollow,
      UserReferral,
      Notification,
      AnchorDeposit,
    ]),
    ReferralModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
