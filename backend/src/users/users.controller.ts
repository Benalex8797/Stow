import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { ReferralService } from './referral.service';
import { PublicUserDto } from './dto/public-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserPreferencesDto,
  UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import {
  PaginationDto,
  FollowersListDto,
  FollowingListDto,
  FollowActionResponseDto,
  FollowStatsResponseDto,
} from './dto/user-follow.dto';
import { User } from './entities/user.entity';
import { ApiBearerAuth } from '@nestjs/swagger';
import {
  ClaimReferralDto,
  ClaimReferralResponseDto,
  MyReferralsResponseDto,
} from './dto/referral.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly referralService: ReferralService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Fetch own profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getOwnProfile(@CurrentUser() user: User) {
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }

  @Get('me/referrals')
  @ApiOperation({
    summary: "Get the current user's referral code, counts, and statuses",
  })
  @ApiResponse({
    status: 200,
    description: 'Referral counts and statuses retrieved successfully',
    type: MyReferralsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyReferrals(@CurrentUser() user: User) {
    return this.referralService.getMyReferrals(user.id);
  }

  @Post('me/referrals/claim')
  @UsePipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  )
  @ApiOperation({
    summary: 'Record that the current user was referred by another user',
  })
  @ApiResponse({
    status: 201,
    description: 'Referral recorded successfully',
    type: ClaimReferralResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Self-referral is not allowed' })
  @ApiResponse({ status: 404, description: 'Referrer not found' })
  @ApiResponse({ status: 409, description: 'A referral has already been recorded for this account' })
  async claimReferral(
    @CurrentUser() user: User,
    @Body() dto: ClaimReferralDto,
  ): Promise<ClaimReferralResponseDto> {
    await this.referralService.claimReferral(user.id, dto.referrer_id);
    return { success: true, message: 'Referral recorded successfully' };
  }

  @Get('me/referrals/rewards')
  @ApiOperation({ summary: 'Paginated list of rewards earned through referrals' })
  @ApiResponse({ status: 200, description: 'Rewards list' })
  async getMyReferralRewards(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    return this.referralService.getMyRewards(user.id, query);
  }

  @Patch('me')
  @UsePipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  )
  @ApiOperation({ summary: 'Update own profile (username, avatar_url)' })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateOwnProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ) {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return plainToInstance(UserResponseDto, updated, {
      excludeExtraneousValues: true,
    });
  }

  @Get(':address')
  @Public()
  async getPublicProfile(@Param('address') address: string) {
    const user = await this.usersService.findByAddress(address);
    return plainToInstance(PublicUserDto, user, {
      excludeExtraneousValues: true,
    });
  }

  @Get('me/export')
  @ApiOperation({ summary: 'Export all user data (GDPR)' })
  @ApiResponse({ status: 200, description: 'User data exported as JSON' })
  async exportData(@CurrentUser() user: User) {
    return await this.usersService.exportUserData(user.id);
  }

  @Patch('me/preferences')
  @UsePipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  )
  @ApiOperation({ summary: 'Update user notification preferences' })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
    type: UserPreferencesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePreferences(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    return this.usersService.updatePreferences(user.id, dto);
  }

  @Post(':address/follow')
  @ApiOperation({ summary: 'Follow a user' })
  @ApiResponse({
    status: 200,
    description: 'User followed successfully',
    type: FollowActionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async followUser(
    @CurrentUser() user: User,
    @Param('address') address: string,
  ): Promise<FollowActionResponseDto> {
    return this.usersService.followUser(user.id, address);
  }

  @Delete(':address/unfollow')
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiResponse({
    status: 200,
    description: 'User unfollowed successfully',
    type: FollowActionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Follow relationship not found' })
  async unfollowUser(
    @CurrentUser() user: User,
    @Param('address') address: string,
  ): Promise<FollowActionResponseDto> {
    return this.usersService.unfollowUser(user.id, address);
  }

  @Get(':address/followers')
  @Public()
  @UsePipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  )
  @ApiOperation({ summary: 'Get followers of a user' })
  @ApiResponse({
    status: 200,
    description: 'Paginated followers list',
    type: FollowersListDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getFollowers(
    @Param('address') address: string,
    @Query() query: PaginationDto,
  ): Promise<FollowersListDto> {
    return this.usersService.getFollowers(address, query);
  }

  @Get(':address/following')
  @Public()
  @UsePipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  )
  @ApiOperation({ summary: 'Get users that a user is following' })
  @ApiResponse({
    status: 200,
    description: 'Paginated following list',
    type: FollowingListDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getFollowing(
    @Param('address') address: string,
    @Query() query: PaginationDto,
  ): Promise<FollowingListDto> {
    return this.usersService.getFollowing(address, query);
  }

  @Get(':address/follow-stats')
  @Public()
  @ApiOperation({ summary: 'Get follower and following counts for a user' })
  @ApiResponse({
    status: 200,
    description: 'User follow statistics',
    type: FollowStatsResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getFollowStats(
    @Param('address') address: string,
  ): Promise<FollowStatsResponseDto> {
    return this.usersService.getFollowStats(address);
  }
}
