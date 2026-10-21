import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoundupConfig, RoundupMethod, RoundupFrequency } from '../entities/roundup-config.entity';
import { RoundupRecord, RoundupRecordStatus, RoundupTriggerSource } from '../entities/roundup-record.entity';
import { RoundupBatch, RoundupBatchStatus } from '../entities/roundup-batch.entity';
import { RoundupCalculatorService } from './roundup-calculator.service';
import { BalanceService } from '../../savings/balance.service';
import { CreateRoundupConfigDto, UpdateRoundupConfigDto } from '../dto/roundup-config.dto';
import { RoundupStatsDto, RoundupRecordResponseDto } from '../dto/roundup-responses.dto';

/**
 * Core round-up service managing configurations, calculations, and deposits.
 */
@Injectable()
export class RoundupService {
  private readonly logger = new Logger(RoundupService.name);

  constructor(
    @InjectRepository(RoundupConfig)
    private readonly configRepository: Repository<RoundupConfig>,
    @InjectRepository(RoundupRecord)
    private readonly recordRepository: Repository<RoundupRecord>,
    @InjectRepository(RoundupBatch)
    private readonly batchRepository: Repository<RoundupBatch>,
    private readonly calculator: RoundupCalculatorService,
    private readonly balanceService: BalanceService,
  ) {}

  // ============= Configuration Management =============

  /**
   * Creates a new roundup configuration for a user.
   */
  async createConfig(
    userId: string,
    dto: CreateRoundupConfigDto,
  ): Promise<RoundupConfig> {
    const config = this.configRepository.create({
      user_id: userId,
      name: dto.name,
      description: dto.description,
      method: dto.method,
      method_parameter: dto.method_parameter?.toString(),
      frequency: dto.frequency,
      min_roundup_amount: (dto.min_roundup_amount || 1000000).toString(),
      max_roundup_per_transaction: (dto.max_roundup_per_transaction || 100000000).toString(),
      target_vault: dto.target_vault || 'flexible',
      is_active: true,
    });

    return this.configRepository.save(config);
  }

  /**
   * Gets a configuration by ID.
   */
  async getConfig(configId: string): Promise<RoundupConfig> {
    const config = await this.configRepository.findOne({
      where: { id: configId },
    });

    if (!config) {
      throw new NotFoundException(`Configuration ${configId} not found`);
    }

    return config;
  }

  /**
   * Lists all configurations for a user.
   */
  async listConfigs(userId: string, activeOnly: boolean = false): Promise<RoundupConfig[]> {
    const query = this.configRepository
      .createQueryBuilder('config')
      .where('config.user_id = :userId', { userId });

    if (activeOnly) {
      query.andWhere('config.is_active = :active', { active: true });
    }

    return query.orderBy('config.created_at', 'DESC').getMany();
  }

  /**
   * Updates a configuration.
   */
  async updateConfig(
    configId: string,
    dto: UpdateRoundupConfigDto,
  ): Promise<RoundupConfig> {
    const config = await this.getConfig(configId);

    Object.assign(config, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.method && { method: dto.method }),
      ...(dto.method_parameter !== undefined && {
        method_parameter: dto.method_parameter.toString(),
      }),
      ...(dto.frequency && { frequency: dto.frequency }),
      ...(dto.min_roundup_amount !== undefined && {
        min_roundup_amount: dto.min_roundup_amount.toString(),
      }),
      ...(dto.max_roundup_per_transaction !== undefined && {
        max_roundup_per_transaction: dto.max_roundup_per_transaction.toString(),
      }),
      ...(dto.target_vault && { target_vault: dto.target_vault }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.is_paused !== undefined && { is_paused: dto.is_paused }),
      ...(dto.pause_reason !== undefined && { pause_reason: dto.pause_reason }),
    });

    return this.configRepository.save(config);
  }

  /**
   * Pauses a configuration temporarily.
   */
  async pauseConfig(configId: string, reason?: string): Promise<RoundupConfig> {
    const config = await this.getConfig(configId);
    config.is_paused = true;
    config.pause_reason = reason;
    return this.configRepository.save(config);
  }

  /**
   * Resumes a paused configuration.
   */
  async resumeConfig(configId: string): Promise<RoundupConfig> {
    const config = await this.getConfig(configId);
    config.is_paused = false;
    config.pause_reason = null;
    return this.configRepository.save(config);
  }

  // ============= Round-up Calculation & Recording =============

  /**
   * Records a round-up for a transaction.
   * Called when a transaction occurs and roundup is enabled.
   */
  async recordRoundup(
    userId: string,
    configId: string,
    amount: bigint,
    trigger: RoundupTriggerSource,
    reference?: string,
    triggerTimestamp?: Date,
  ): Promise<RoundupRecord> {
    const config = await this.getConfig(configId);

    if (config.user_id !== userId) {
      throw new BadRequestException('Configuration does not belong to user');
    }

    if (config.is_paused || !config.is_active) {
      this.logger.warn(
        `Roundup skipped: config ${configId} is paused or inactive`,
      );
      return null;
    }

    // Calculate roundup
    const roundupAmount = this.calculator.calculateRoundup(
      amount,
      config.method,
      config.method_parameter,
      BigInt(config.max_roundup_per_transaction),
    );

    // Skip if below minimum
    if (roundupAmount < BigInt(config.min_roundup_amount)) {
      this.logger.debug(
        `Roundup skipped: ${roundupAmount} < ${config.min_roundup_amount}`,
      );
      return null;
    }

    // Create record
    const record = this.recordRepository.create({
      user_id: userId,
      config_id: configId,
      status: RoundupRecordStatus.PENDING,
      trigger_source: trigger,
      roundup_amount: roundupAmount.toString(),
      original_amount: amount.toString(),
      method_applied: config.method,
      transaction_reference: reference,
      trigger_timestamp: triggerTimestamp || new Date(),
      metadata: {
        method_parameter: config.method_parameter,
        frequency: config.frequency,
      },
    });

    const saved = await this.recordRepository.save(record);
    this.logger.log(
      `Roundup recorded: ${roundupAmount} stroops for user ${userId}`,
    );

    // Schedule processing if IMMEDIATE frequency
    if (config.frequency === RoundupFrequency.IMMEDIATE) {
      await this.processRecordsForConfig(configId);
    }

    return saved;
  }

  /**
   * External trigger for round-ups (webhook, API call, etc.)
   */
  async triggerExternalRoundup(
    userId: string,
    configId: string,
    amount?: bigint,
  ): Promise<RoundupRecord> {
    const config = await this.getConfig(configId);

    if (config.user_id !== userId) {
      throw new BadRequestException('Configuration does not belong to user');
    }

    // Use provided amount or fetch from balance
    let triggerAmount = amount;
    if (!triggerAmount) {
      const balance = await this.balanceService.get(config.user_id);
      triggerAmount = BigInt(balance.amount);
    }

    return this.recordRoundup(
      userId,
      configId,
      triggerAmount,
      RoundupTriggerSource.EXTERNAL,
      `external-${Date.now()}`,
    );
  }

  // ============= Record Management =============

  /**
   * Gets a roundup record.
   */
  async getRecord(recordId: string): Promise<RoundupRecord> {
    const record = await this.recordRepository.findOne({
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException(`Record ${recordId} not found`);
    }

    return record;
  }

  /**
   * Lists pending roundup records for a user.
   */
  async listPendingRecords(userId: string): Promise<RoundupRecord[]> {
    return this.recordRepository.find({
      where: {
        user_id: userId,
        status: RoundupRecordStatus.PENDING,
      },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Lists all records for a user.
   */
  async listRecords(
    userId: string,
    limit: number = 100,
  ): Promise<RoundupRecord[]> {
    return this.recordRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  // ============= Batch Processing =============

  /**
   * Processes pending records for a specific configuration.
   */
  async processRecordsForConfig(configId: string): Promise<RoundupBatch> {
    const config = await this.getConfig(configId);

    const pending = await this.recordRepository.find({
      where: {
        config_id: configId,
        status: RoundupRecordStatus.PENDING,
      },
    });

    if (pending.length === 0) {
      this.logger.debug(`No pending records for config ${configId}`);
      return null;
    }

    return this.processBatch(pending, configId);
  }

  /**
   * Processes pending records for a user's active configurations.
   */
  async processRecordsForUser(userId: string): Promise<RoundupBatch[]> {
    const configs = await this.listConfigs(userId, true);
    const batches: RoundupBatch[] = [];

    for (const config of configs) {
      const batch = await this.processRecordsForConfig(config.id);
      if (batch) batches.push(batch);
    }

    return batches;
  }

  /**
   * Processes a batch of roundup records.
   * In production, this would trigger actual on-chain deposits.
   */
  private async processBatch(
    records: RoundupRecord[],
    configId: string,
  ): Promise<RoundupBatch> {
    const config = await this.getConfig(configId);
    const totalAmount = records.reduce(
      (sum, r) => sum + BigInt(r.roundup_amount),
      0n,
    );

    // Create batch record
    const batch = this.batchRepository.create({
      record_count: records.length,
      total_amount: totalAmount.toString(),
      status: RoundupBatchStatus.PROCESSING,
      processing_started_at: new Date(),
    });

    const savedBatch = await this.batchRepository.save(batch);

    // Update records to reference batch
    await Promise.all(
      records.map((r) =>
        this.recordRepository.update(r.id, {
          batch_id: savedBatch.id,
          status: RoundupRecordStatus.PROCESSING,
        }),
      ),
    );

    try {
      // TODO: Submit actual deposit transaction to Soroban
      // For now, simulate success
      await this.simulateDepositSuccess(records, savedBatch, config);

      // Mark batch complete
      savedBatch.status = RoundupBatchStatus.COMPLETED;
      savedBatch.processed_at = new Date();
      savedBatch.successful_count = records.length;
    } catch (error) {
      this.logger.error(`Batch processing failed: ${error.message}`);
      savedBatch.status = RoundupBatchStatus.FAILED;
      savedBatch.error_message = error.message;
      savedBatch.processed_at = new Date();

      // Mark records as failed
      await Promise.all(
        records.map((r) =>
          this.recordRepository.update(r.id, {
            status: RoundupRecordStatus.FAILED,
            error_message: error.message,
            processed_at: new Date(),
          }),
        ),
      );
    }

    return this.batchRepository.save(savedBatch);
  }

  /**
   * Simulates successful deposit (placeholder for actual Soroban integration).
   */
  private async simulateDepositSuccess(
    records: RoundupRecord[],
    batch: RoundupBatch,
    config: RoundupConfig,
  ): Promise<void> {
    // Mark all records as completed
    await Promise.all(
      records.map((r) =>
        this.recordRepository.update(r.id, {
          status: RoundupRecordStatus.COMPLETED,
          deposit_tx_hash: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          deposit_ledger: 12345, // Placeholder ledger
          processed_at: new Date(),
        }),
      ),
    );

    // Credit user's balance
    const totalAmount = records.reduce(
      (sum, r) => sum + BigInt(r.roundup_amount),
      0n,
    );

    await this.balanceService.credit(
      records[0].user_id,
      totalAmount.toString(),
    );

    this.logger.log(
      `Batch ${batch.id}: ${records.length} records processed, ${totalAmount} stroops deposited`,
    );
  }

  // ============= Statistics =============

  /**
   * Gets round-up statistics for a user.
   */
  async getStats(userId: string): Promise<RoundupStatsDto> {
    const configs = await this.listConfigs(userId);
    const activeConfigs = configs.filter((c) => c.is_active && !c.is_paused);
    const pausedConfigs = configs.filter((c) => c.is_paused);

    const records = await this.recordRepository.find({
      where: { user_id: userId },
    });

    const pending = records.filter((r) => r.status === RoundupRecordStatus.PENDING);
    const completed = records.filter((r) => r.status === RoundupRecordStatus.COMPLETED);
    const failed = records.filter((r) => r.status === RoundupRecordStatus.FAILED);

    const totalAccumulated = pending.reduce(
      (sum, r) => sum + BigInt(r.roundup_amount),
      0n,
    );

    const totalProcessed = completed.reduce(
      (sum, r) => sum + BigInt(r.roundup_amount),
      0n,
    );

    const batches = await this.batchRepository.find({
      order: { created_at: 'DESC' },
      take: 1,
    });

    return {
      total_configs: configs.length,
      active_configs: activeConfigs.length,
      paused_configs: pausedConfigs.length,
      total_accumulated: totalAccumulated.toString(),
      total_processed: totalProcessed.toString(),
      pending_records: pending.length,
      completed_records: completed.length,
      failed_records: failed.length,
      last_batch_at: batches[0]?.created_at || null,
    };
  }
}
