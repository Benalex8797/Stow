import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminService } from './admin.service';
import { BanUserDto } from './dto/ban-user.dto';
import {
  BulkUserActionDto,
  BulkUserActionResponseDto,
} from './dto/bulk-user-action.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListVerifiedAddressesQueryDto } from './dto/list-verified-addresses-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { SavingsOverviewDto } from './dto/savings-overview.dto';
import { YieldAdminOverviewResponseDto } from '../savings/dto/yield-admin-overview-response.dto';
import { AdminAuditInterceptor } from './interceptors/admin-audit.interceptor';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

type RequestUser = Request & { user: { id: string } };

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get('verified-addresses')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(120)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all verified addresses' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of verified addresses',
  })
  async listVerifiedAddresses(@Query() query: ListVerifiedAddressesQueryDto) {
    return this.adminService.listVerifiedAddresses(query);
  }

  @Get('savings/overview')
  @Roles(Role.Admin, Role.Moderator)
  @UseInterceptors(AdminAuditInterceptor)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Aggregate savings metrics (deposits, accounts, status breakdown)',
  })
  @ApiResponse({
    status: 200,
    description: 'Savings overview metrics',
    type: SavingsOverviewDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin or moderator role required',
  })
  async getSavingsOverview(): Promise<SavingsOverviewDto> {
    return this.adminService.getSavingsOverview();
  }

  @Get('savings/yield/overview')
  @Roles(Role.Admin, Role.Moderator)
  @UseInterceptors(AdminAuditInterceptor)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Aggregate yield-adapter metrics (strategy, assets, fees, harvest history)',
  })
  @ApiResponse({
    status: 200,
    description: 'Yield adapter overview metrics',
    type: YieldAdminOverviewResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin or moderator role required',
  })
  async getYieldOverview(): Promise<YieldAdminOverviewResponseDto> {
    return this.adminService.getYieldOverview();
  }

  @Patch('users/:id/ban')
  async banUser(
    @Param('id') id: string,
    @Body() dto: BanUserDto,
    @Request() req: RequestUser,
  ) {
    return this.adminService.banUser(
      id,
      dto.reason,
      (req as { user: { id: string } }).user.id,
    );
  }

  @Patch('users/:id/unban')
  async unbanUser(@Param('id') id: string, @Request() req: RequestUser) {
    return this.adminService.unbanUser(
      id,
      (req as { user: { id: string } }).user.id,
    );
  }

  @Post('users/bulk-action')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AdminAuditInterceptor)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Apply a moderation action (ban/unban/flag) to multiple users',
    description:
      'Each user is processed independently. Failures for individual users ' +
      'are reported per-user and do not roll back or abort the rest of the batch.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-user result report for the bulk action',
    type: BulkUserActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async bulkUserAction(
    @Body() dto: BulkUserActionDto,
    @Request() req: RequestUser,
  ): Promise<BulkUserActionResponseDto> {
    return this.adminService.bulkUserAction(
      dto,
      (req as { user: { id: string } }).user.id,
    );
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @Request() req: RequestUser,
  ) {
    return this.adminService.updateUserRole(
      id,
      dto,
      (req as { user: { id: string } }).user.id,
    );
  }

  @Get('dashboard/stats')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get comprehensive dashboard statistics' })
  @ApiResponse({
    status: 200,
    description:
      'Dashboard statistics including users, transactions, and system health',
  })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('dashboard/activity')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent system activity and events' })
  @ApiResponse({
    status: 200,
    description: 'Recent activity timeline',
  })
  async getRecentActivity(@Query() query: any) {
    return this.adminService.getRecentActivity(query);
  }

  @Get('dashboard/analytics')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform analytics and trends' })
  @ApiResponse({
    status: 200,
    description: 'Analytics data including growth metrics and trends',
  })
  async getAnalytics(@Query() query: any) {
    return this.adminService.getAnalytics(query);
  }

  @Get('notifications/overview')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(120)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get notification system overview and metrics' })
  @ApiResponse({
    status: 200,
    description:
      'Notification metrics including delivery rates and channel performance',
  })
  async getNotificationOverview() {
    return this.adminService.getNotificationOverview();
  }

  @Get('system/health')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed system health metrics' })
  @ApiResponse({
    status: 200,
    description:
      'System health including database, cache, and external services',
  })
  async getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @Get('audit-logs')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin audit logs with filtering' })
  @ApiResponse({ status: 200, description: 'Paginated audit logs' })
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLogs(query);
  }

  @Get('audit-logs/integrity')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify tamper-proof integrity of the audit log chain' })
  @ApiResponse({ status: 200, description: 'Integrity check report' })
  async verifyAuditIntegrity() {
    return this.adminService.verifyAuditIntegrity();
  }

  @Get('referrals/overview')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform-wide referral stats overview' })
  @ApiResponse({ status: 200, description: 'Referral overview metrics' })
  async getReferralOverview() {
    return this.adminService.getReferralOverview();
  }

  @Get('referrals')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated list of all referrals (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated referral list' })
  async listReferrals(@Query() query: any) {
    return this.adminService.listReferrals(query);
  }

  @Get('reports/export')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export admin reports in various formats' })
  @ApiResponse({
    status: 200,
    description: 'Generated report file',
  })
  async exportReport(@Query() query: any) {
    return this.adminService.exportReport(query);
  }
}
