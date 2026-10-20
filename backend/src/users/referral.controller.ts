import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { ReferralService } from './referral.service';
import { ClaimReferralDto } from './dto/referral.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('claim')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Attribute the current user to a referrer' })
  @ApiResponse({ status: 201, description: 'Referral recorded' })
  @ApiResponse({ status: 400, description: 'Self-referral not allowed' })
  @ApiResponse({ status: 404, description: 'Referral code invalid' })
  @ApiResponse({ status: 409, description: 'Already referred' })
  async claim(@CurrentUser() user: User, @Body() dto: ClaimReferralDto) {
    return this.referralService.claimReferral(user.id, dto.referrer_id);
  }

  @Get('me')
  @ApiOperation({ summary: "My referrals — code, counts, and referral list" })
  @ApiResponse({ status: 200, description: 'Referral stats and list' })
  async getMyReferrals(@CurrentUser() user: User) {
    return this.referralService.getMyReferrals(user.id);
  }

  @Get('me/rewards')
  @ApiOperation({ summary: 'My earned rewards (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated rewards list' })
  async getMyRewards(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    return this.referralService.getMyRewards(user.id, query);
  }
}
