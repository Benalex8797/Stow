import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { RoundupService } from './services/roundup.service';
import {
  CreateRoundupConfigDto,
  UpdateRoundupConfigDto,
  RoundupConfigResponseDto,
} from './dto/roundup-config.dto';
import { RoundupStatsDto, RoundupRecordResponseDto } from './dto/roundup-responses.dto';

@ApiTags('Savings - Round-up')
@Controller('savings/roundup')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoundupController {
  constructor(private readonly roundupService: RoundupService) {}

  // ============= Configuration Management =============

  @Post('config')
  @ApiOperation({
    summary: 'Create round-up configuration',
    description: 'Create a new savings round-up configuration',
  })
  async createConfig(
    @CurrentUser() user: User,
    @Body() dto: CreateRoundupConfigDto,
  ): Promise<RoundupConfigResponseDto> {
    const config = await this.roundupService.createConfig(user.id, dto);
    return this.toConfigResponse(config);
  }

  @Get('config')
  @ApiOperation({
    summary: 'List round-up configurations',
    description: 'Get all configurations for the current user',
  })
  async listConfigs(
    @CurrentUser() user: User,
  ): Promise<RoundupConfigResponseDto[]> {
    const configs = await this.roundupService.listConfigs(user.id);
    return configs.map((c) => this.toConfigResponse(c));
  }

  @Get('config/:configId')
  @ApiOperation({
    summary: 'Get configuration details',
    description: 'Retrieve a specific round-up configuration',
  })
  async getConfig(
    @CurrentUser() user: User,
    @Param('configId') configId: string,
  ): Promise<RoundupConfigResponseDto> {
    const config = await this.roundupService.getConfig(configId);

    if (config.user_id !== user.id) {
      throw new BadRequestException('Configuration does not belong to you');
    }

    return this.toConfigResponse(config);
  }

  @Put('config/:configId')
  @ApiOperation({
    summary: 'Update configuration',
    description: 'Modify an existing round-up configuration',
  })
  async updateConfig(
    @CurrentUser() user: User,
    @Param('configId') configId: string,
    @Body() dto: UpdateRoundupConfigDto,
  ): Promise<RoundupConfigResponseDto> {
    const config = await this.roundupService.getConfig(configId);

    if (config.user_id !== user.id) {
      throw new BadRequestException('Configuration does not belong to you');
    }

    const updated = await this.roundupService.updateConfig(configId, dto);
    return this.toConfigResponse(updated);
  }

  @Post('config/:configId/pause')
  @ApiOperation({
    summary: 'Pause configuration',
    description: 'Temporarily pause a round-up configuration',
  })
  async pauseConfig(
    @CurrentUser() user: User,
    @Param('configId') configId: string,
    @Body('reason') reason?: string,
  ): Promise<RoundupConfigResponseDto> {
    const config = await this.roundupService.getConfig(configId);

    if (config.user_id !== user.id) {
      throw new BadRequestException('Configuration does not belong to you');
    }

    const updated = await this.roundupService.pauseConfig(configId, reason);
    return this.toConfigResponse(updated);
  }

  @Post('config/:configId/resume')
  @ApiOperation({
    summary: 'Resume configuration',
    description: 'Resume a paused round-up configuration',
  })
  async resumeConfig(
    @CurrentUser() user: User,
    @Param('configId') configId: string,
  ): Promise<RoundupConfigResponseDto> {
    const config = await this.roundupService.getConfig(configId);

    if (config.user_id !== user.id) {
      throw new BadRequestException('Configuration does not belong to you');
    }

    const updated = await this.roundupService.resumeConfig(configId);
    return this.toConfigResponse(updated);
  }

  // ============= Record Management =============

  @Get('records')
  @ApiOperation({
    summary: 'List round-up records',
    description: 'Get recent round-up records for the current user',
  })
  async listRecords(
    @CurrentUser() user: User,
  ): Promise<RoundupRecordResponseDto[]> {
    const records = await this.roundupService.listRecords(user.id);
    return records.map((r) => this.toRecordResponse(r));
  }

  @Get('records/pending')
  @ApiOperation({
    summary: 'List pending records',
    description: 'Get pending round-ups waiting to be processed',
  })
  async listPendingRecords(
    @CurrentUser() user: User,
  ): Promise<RoundupRecordResponseDto[]> {
    const records = await this.roundupService.listPendingRecords(user.id);
    return records.map((r) => this.toRecordResponse(r));
  }

  @Get('records/:recordId')
  @ApiOperation({
    summary: 'Get record details',
    description: 'Retrieve details of a specific round-up record',
  })
  async getRecord(
    @CurrentUser() user: User,
    @Param('recordId') recordId: string,
  ): Promise<RoundupRecordResponseDto> {
    const record = await this.roundupService.getRecord(recordId);

    if (record.user_id !== user.id) {
      throw new BadRequestException('Record does not belong to you');
    }

    return this.toRecordResponse(record);
  }

  // ============= Processing =============

  @Post('process')
  @ApiOperation({
    summary: 'Process pending round-ups',
    description: 'Manually trigger processing of accumulated round-ups',
  })
  async processRecords(
    @CurrentUser() user: User,
  ): Promise<{ success: boolean; message: string }> {
    const batches = await this.roundupService.processRecordsForUser(user.id);

    return {
      success: true,
      message: `Processed ${batches.length} batch(es)`,
    };
  }

  @Post('trigger/:configId')
  @ApiOperation({
    summary: 'Trigger external round-up',
    description: 'Manually trigger a round-up for a configuration',
  })
  async triggerRoundup(
    @CurrentUser() user: User,
    @Param('configId') configId: string,
  ): Promise<{ success: boolean; message: string }> {
    const config = await this.roundupService.getConfig(configId);

    if (config.user_id !== user.id) {
      throw new BadRequestException('Configuration does not belong to you');
    }

    await this.roundupService.triggerExternalRoundup(user.id, configId);

    return {
      success: true,
      message: 'Round-up triggered',
    };
  }

  // ============= Statistics =============

  @Get('stats')
  @ApiOperation({
    summary: 'Get round-up statistics',
    description: 'Get statistics on round-ups for the current user',
  })
  async getStats(@CurrentUser() user: User): Promise<RoundupStatsDto> {
    return this.roundupService.getStats(user.id);
  }

  // ============= Helpers =============

  private toConfigResponse(config: any): RoundupConfigResponseDto {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      method: config.method,
      method_parameter: config.method_parameter,
      frequency: config.frequency,
      min_roundup_amount: config.min_roundup_amount,
      max_roundup_per_transaction: config.max_roundup_per_transaction,
      target_vault: config.target_vault,
      is_active: config.is_active,
      is_paused: config.is_paused,
      last_processed_at: config.last_processed_at,
      next_scheduled_at: config.next_scheduled_at,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  private toRecordResponse(record: any): RoundupRecordResponseDto {
    return {
      id: record.id,
      status: record.status,
      trigger_source: record.trigger_source,
      roundup_amount: record.roundup_amount,
      original_amount: record.original_amount,
      method_applied: record.method_applied,
      transaction_reference: record.transaction_reference,
      trigger_timestamp: record.trigger_timestamp,
      deposit_tx_hash: record.deposit_tx_hash,
      error_message: record.error_message,
      created_at: record.created_at,
      processed_at: record.processed_at,
    };
  }
}
