import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InterestRateConfig } from '../entities/interest-rate-config.entity';
import { InterestRateHistory } from '../entities/interest-rate-history.entity';
import { OracleData } from '../entities/oracle-data.entity';
import { Balance } from '../../savings/entities/balance.entity';
import { RateCalculatorService } from './rate-calculator.service';
import { CurrentInterestRateDto, InterestRateHistoryDto, UtilizationMetricsDto } from '../dto/interest-rate-response.dto';

/**
 * Manages interest rate configurations and calculations.
 * Integrates utilization data, oracle prices, and rate smoothing.
 */
@Injectable()
export class InterestRateService {
  private readonly logger = new Logger(InterestRateService.name);

  constructor(
    @InjectRepository(InterestRateConfig)
    private readonly configRepository: Repository<InterestRateConfig>,
    @InjectRepository(InterestRateHistory)
    private readonly historyRepository: Repository<InterestRateHistory>,
    @InjectRepository(OracleData)
    private readonly oracleDataRepository: Repository<OracleData>,
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    private readonly rateCalculator: RateCalculatorService,
  ) {}

  /**
   * Gets the current active interest rate configuration.
   */
  async getActiveConfig(): Promise<InterestRateConfig> {
    const config = await this.configRepository.findOne({
      where: { is_active: true },
    });

    if (!config) {
      throw new NotFoundException('No active interest rate configuration found');
    }

    return config;
  }

  /**
   * Gets a specific configuration by ID.
   */
  async getConfig(configId: string): Promise<InterestRateConfig> {
    const config = await this.configRepository.findOne({
      where: { id: configId },
    });

    if (!config) {
      throw new NotFoundException(`Configuration ${configId} not found`);
    }

    return config;
  }

  /**
   * Lists all configurations, optionally filtered by active status.
   */
  async listConfigs(activeOnly: boolean = false): Promise<InterestRateConfig[]> {
    const query = this.configRepository.createQueryBuilder('config');

    if (activeOnly) {
      query.where('config.is_active = :active', { active: true });
    }

    return query.orderBy('config.created_at', 'DESC').getMany();
  }

  /**
   * Creates a new interest rate configuration.
   */
  async createConfig(data: any): Promise<InterestRateConfig> {
    const config = this.configRepository.create({
      name: data.name,
      description: data.description,
      asset: data.asset || 'USDC',
      base_rate: data.base_rate.toString(),
      min_rate: data.min_rate.toString(),
      max_rate: data.max_rate.toString(),
      optimal_utilization: data.optimal_utilization.toString(),
      slope_up: data.slope_up.toString(),
      slope_down: data.slope_down.toString(),
      smoothing_factor: data.smoothing_factor.toString(),
      notes: data.notes,
    });

    return this.configRepository.save(config);
  }

  /**
   * Updates an existing configuration.
   */
  async updateConfig(configId: string, data: any): Promise<InterestRateConfig> {
    const config = await this.getConfig(configId);

    Object.assign(config, {
      ...(data.name && { name: data.name }),
      ...(data.description && { description: data.description }),
      ...(data.base_rate !== undefined && {
        base_rate: data.base_rate.toString(),
      }),
      ...(data.min_rate !== undefined && { min_rate: data.min_rate.toString() }),
      ...(data.max_rate !== undefined && { max_rate: data.max_rate.toString() }),
      ...(data.optimal_utilization !== undefined && {
        optimal_utilization: data.optimal_utilization.toString(),
      }),
      ...(data.slope_up !== undefined && { slope_up: data.slope_up.toString() }),
      ...(data.slope_down !== undefined && {
        slope_down: data.slope_down.toString(),
      }),
      ...(data.smoothing_factor !== undefined && {
        smoothing_factor: data.smoothing_factor.toString(),
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    });

    return this.configRepository.save(config);
  }

  /**
   * Calculates the current interest rate for a configuration.
   */
  async calculateCurrentRate(
    configId: string,
  ): Promise<CurrentInterestRateDto> {
    const config = await this.getConfig(configId);

    // Calculate utilization from total deposits
    const totalDeposits = await this.getTotalDeposits();
    const totalBorrowed = await this.getTotalBorrowed();

    const utilization = this.rateCalculator.calculateUtilization(
      totalDeposits,
      totalBorrowed,
    );

    // Get previous rate for smoothing
    const lastHistory = await this.historyRepository.findOne({
      where: { config_id: configId },
      order: { created_at: 'DESC' },
    });

    const previousRate = lastHistory?.calculated_rate;

    // Calculate new rate
    const newRate = this.rateCalculator.calculateRate(
      utilization,
      config,
      previousRate,
    );

    // Save to history
    const history = this.historyRepository.create({
      config_id: configId,
      calculated_rate: newRate,
      utilization_ratio: utilization.toString(),
      total_liquidity: totalDeposits.toString(),
      total_utilization: totalBorrowed.toString(),
      previous_rate: previousRate || '0',
      rate_delta: (Number(newRate) - Number(previousRate || '0')).toFixed(4),
      oracle_price: null, // Could integrate oracle data here
    });

    await this.historyRepository.save(history);

    return {
      apy: newRate,
      utilization: utilization.toFixed(4),
      total_liquidity: totalDeposits.toString(),
      total_utilization: totalBorrowed.toString(),
      config_id: configId,
      config_name: config.name,
      calculated_at: new Date(),
    };
  }

  /**
   * Gets the current rate for the active configuration.
   */
  async getCurrentRate(): Promise<CurrentInterestRateDto> {
    const config = await this.getActiveConfig();
    return this.calculateCurrentRate(config.id);
  }

  /**
   * Gets utilization metrics for the system.
   */
  async getUtilizationMetrics(): Promise<UtilizationMetricsDto> {
    const config = await this.getActiveConfig();
    const totalDeposits = await this.getTotalDeposits();
    const totalBorrowed = await this.getTotalBorrowed();

    const utilization = this.rateCalculator.calculateUtilization(
      totalDeposits,
      totalBorrowed,
    );

    const optimalUtil = Number(config.optimal_utilization);
    const utilizationAboveOptimal =
      utilization > optimalUtil ? utilization - optimalUtil : null;
    const headroomToMax =
      (1 - utilization) * 100; /* percentage */

    return {
      current_utilization: utilization.toFixed(4),
      available_liquidity: totalDeposits.toString(),
      borrowed_amount: totalBorrowed.toString(),
      optimal_utilization: optimalUtil.toFixed(4),
      utilization_above_optimal: utilizationAboveOptimal
        ? utilizationAboveOptimal.toFixed(4)
        : null,
      headroom_to_max: headroomToMax.toFixed(2),
    };
  }

  /**
   * Gets historical rate data for a configuration.
   */
  async getRateHistory(
    configId: string,
    limit: number = 100,
  ): Promise<InterestRateHistoryDto[]> {
    const config = await this.getConfig(configId);

    const history = await this.historyRepository.find({
      where: { config_id: configId },
      order: { created_at: 'DESC' },
      take: limit,
    });

    return history.map((h) => ({
      id: h.id,
      calculated_rate: h.calculated_rate,
      utilization_ratio: h.utilization_ratio,
      previous_rate: h.previous_rate,
      rate_delta: h.rate_delta,
      created_at: h.created_at,
      config_name: config.name,
    }));
  }

  /**
   * Projects rate for different utilization levels.
   */
  async projectRate(configId: string, utilization: number): Promise<string> {
    const config = await this.getConfig(configId);
    return this.rateCalculator.projectRate(utilization, config);
  }

  /**
   * Stores oracle price data.
   */
  async updateOraclePrice(data: any): Promise<OracleData> {
    const oracle = this.oracleDataRepository.create({
      asset: data.asset,
      source_type: data.source_type,
      price_usd: data.price_usd,
      price_base: data.price_base,
      confidence: data.confidence,
      price_timestamp: new Date(data.price_timestamp),
      is_valid: true,
      notes: data.notes,
    });

    return this.oracleDataRepository.save(oracle);
  }

  /**
   * Gets the latest valid oracle price for an asset.
   */
  async getLatestOraclePrice(asset: string): Promise<OracleData | null> {
    return this.oracleDataRepository.findOne({
      where: { asset, is_valid: true },
      order: { updated_at: 'DESC' },
    });
  }

  /**
   * Gets total deposits across all users.
   */
  private async getTotalDeposits(): Promise<bigint> {
    const result = await this.balanceRepository
      .createQueryBuilder('balance')
      .select('SUM(CAST(balance.amount AS NUMERIC))', 'total')
      .getRawOne();

    return BigInt(result?.total || 0);
  }

  /**
   * Gets total borrowed/utilized amount.
   * For now, uses a placeholder - would come from yield adapter contracts.
   */
  private async getTotalBorrowed(): Promise<bigint> {
    // TODO: Integrate with YieldPosition or contract data
    // For now, assume a fixed utilization for demonstration
    const totalDeposits = await this.getTotalDeposits();
    return (totalDeposits * 35n) / 100n; // 35% utilization baseline
  }
}
