import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InterestRateService } from '../services/interest-rate.service';
import {
  CreateInterestRateConfigDto,
  UpdateInterestRateConfigDto,
} from '../dto/interest-rate-config.dto';
import { InterestRateConfig } from '../entities/interest-rate-config.entity';

@ApiTags('Admin - Interest Rates')
@Controller('admin/interest-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth()
export class InterestRatesAdminController {
  constructor(private readonly interestRateService: InterestRateService) {}

  @Get('configs')
  @ApiOperation({
    summary: 'List all rate configurations',
    description: 'Admin endpoint to view all configurations',
  })
  async listConfigs(): Promise<InterestRateConfig[]> {
    return this.interestRateService.listConfigs();
  }

  @Get('configs/active')
  @ApiOperation({
    summary: 'Get active configuration',
    description: 'Retrieve the currently active rate configuration',
  })
  async getActiveConfig(): Promise<InterestRateConfig> {
    return this.interestRateService.getActiveConfig();
  }

  @Get('configs/:configId')
  @ApiOperation({
    summary: 'Get configuration details',
    description: 'Retrieve a specific configuration with all parameters',
  })
  async getConfig(
    @Param('configId') configId: string,
  ): Promise<InterestRateConfig> {
    return this.interestRateService.getConfig(configId);
  }

  @Post('configs')
  @ApiOperation({
    summary: 'Create new rate configuration',
    description: 'Create a new interest rate configuration',
  })
  async createConfig(
    @Body() dto: CreateInterestRateConfigDto,
  ): Promise<InterestRateConfig> {
    return this.interestRateService.createConfig(dto);
  }

  @Put('configs/:configId')
  @ApiOperation({
    summary: 'Update rate configuration',
    description: 'Modify an existing configuration',
  })
  async updateConfig(
    @Param('configId') configId: string,
    @Body() dto: UpdateInterestRateConfigDto,
  ): Promise<InterestRateConfig> {
    return this.interestRateService.updateConfig(configId, dto);
  }

  @Post('configs/:configId/activate')
  @ApiOperation({
    summary: 'Activate configuration',
    description: 'Set this configuration as the active one',
  })
  async activateConfig(
    @Param('configId') configId: string,
  ): Promise<{ message: string; config: InterestRateConfig }> {
    // Deactivate all others
    const configs = await this.interestRateService.listConfigs();
    for (const cfg of configs) {
      if (cfg.id !== configId && cfg.is_active) {
        await this.interestRateService.updateConfig(cfg.id, {
          is_active: false,
        });
      }
    }

    // Activate this one
    const updated = await this.interestRateService.updateConfig(configId, {
      is_active: true,
    });

    return {
      message: `Configuration ${configId} is now active`,
      config: updated,
    };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get rate system statistics',
    description: 'Returns statistics about rate calculations',
  })
  async getStats(): Promise<{
    active_config: InterestRateConfig;
    total_configs: number;
    recent_rate_changes: number;
  }> {
    const activeConfig = await this.interestRateService.getActiveConfig();
    const allConfigs = await this.interestRateService.listConfigs();

    return {
      active_config: activeConfig,
      total_configs: allConfigs.length,
      recent_rate_changes: 0, // Could track rate change frequency
    };
  }
}
