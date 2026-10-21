import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  DefaultValue,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { InterestRateService } from './services/interest-rate.service';
import {
  CurrentInterestRateDto,
  InterestRateHistoryDto,
  RateProjectionDto,
  UtilizationMetricsDto,
} from './dto/interest-rate-response.dto';

@ApiTags('Interest Rates')
@Controller('interest-rates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InterestRatesController {
  constructor(private readonly interestRateService: InterestRateService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Get current interest rate',
    description: 'Returns the current APY based on utilization',
  })
  async getCurrentRate(): Promise<CurrentInterestRateDto> {
    return this.interestRateService.getCurrentRate();
  }

  @Get('config/:configId/current')
  @ApiOperation({
    summary: 'Get rate for specific configuration',
    description: 'Calculate current rate for a given configuration',
  })
  async getRateForConfig(
    @Param('configId') configId: string,
  ): Promise<CurrentInterestRateDto> {
    return this.interestRateService.calculateCurrentRate(configId);
  }

  @Get('config')
  @ApiOperation({
    summary: 'List rate configurations',
    description: 'Get all interest rate configurations',
  })
  async listConfigs(
    @Query('active', new DefaultValue(false))
    active: boolean,
  ): Promise<any[]> {
    return this.interestRateService.listConfigs(active);
  }

  @Get('config/:configId')
  @ApiOperation({
    summary: 'Get configuration details',
    description: 'Retrieve details for a specific rate configuration',
  })
  async getConfig(@Param('configId') configId: string): Promise<any> {
    return this.interestRateService.getConfig(configId);
  }

  @Get('history/:configId')
  @ApiOperation({
    summary: 'Get rate calculation history',
    description: 'Retrieve historical rate calculations for a configuration',
  })
  async getRateHistory(
    @Param('configId') configId: string,
    @Query('limit', new DefaultValue(100), ParseIntPipe) limit: number,
  ): Promise<InterestRateHistoryDto[]> {
    return this.interestRateService.getRateHistory(configId, limit);
  }

  @Get('project/:configId')
  @ApiOperation({
    summary: 'Project rate at utilization level',
    description: 'Calculate what the rate would be at a given utilization',
  })
  async projectRate(
    @Param('configId') configId: string,
    @Query('utilization', ParseIntPipe) utilization: number,
  ): Promise<RateProjectionDto> {
    const config = await this.interestRateService.getConfig(configId);
    const util = utilization / 100; // Convert percentage to decimal

    const projectedRate = await this.interestRateService.projectRate(
      configId,
      util,
    );

    return {
      projected_rate: projectedRate,
      utilization: util.toFixed(4),
      config: {
        id: config.id,
        name: config.name,
        base_rate: config.base_rate,
        max_rate: config.max_rate,
        optimal_utilization: config.optimal_utilization,
      },
    };
  }

  @Get('utilization')
  @ApiOperation({
    summary: 'Get utilization metrics',
    description: 'Returns current utilization ratio and related metrics',
  })
  async getUtilizationMetrics(): Promise<UtilizationMetricsDto> {
    return this.interestRateService.getUtilizationMetrics();
  }
}
