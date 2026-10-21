import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AnalyticsMetric,
  MetricType,
  AggregationPeriod,
} from './entities/analytics-metric.entity';

interface AggregationResult {
  metric_type: MetricType;
  total_value: string;
  count: number;
  average_value: string;
}

/**
 * Service responsible for aggregating analytics metrics across different time periods.
 * 
 * This service:
 * - Aggregates raw metrics into hourly, daily, weekly, and monthly summaries
 * - Runs scheduled jobs to compute aggregations
 * - Provides methods to query aggregated data
 * - Handles metric collection and storage
 */
@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly metricsRepository: Repository<AnalyticsMetric>,
  ) {}

  /**
   * Record a new metric event
   */
  async recordMetric(
    metricType: MetricType,
    value: number,
    metadata?: Record<string, any>,
    userId?: string,
  ): Promise<AnalyticsMetric> {
    const metric = this.metricsRepository.create({
      metric_type: metricType,
      period: AggregationPeriod.HOURLY,
      period_start: this.getHourStart(new Date()),
      period_end: this.getHourEnd(new Date()),
      user_id: userId ?? null,
      value: value.toString(),
      count: 1,
      metadata: metadata ?? null,
    });

    return this.metricsRepository.save(metric);
  }

  /**
   * Aggregate metrics for a given period
   */
  async aggregateMetrics(
    period: AggregationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    this.logger.log(
      `Starting aggregation for period: ${period} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const metrics = await this.metricsRepository.find({
      where: {
        period_start: Between(startDate, endDate),
      },
    });

    // Group metrics by type and time window
    const grouped = this.groupMetricsByPeriod(metrics, period);

    // Save aggregated metrics
    for (const [key, values] of grouped.entries()) {
      const [metricType, periodStart, userId] = key.split('|');
      const totalValue = values.reduce((sum, m) => sum + parseFloat(m.value), 0);
      const count = values.reduce((sum, m) => sum + m.count, 0);

      const aggregated = this.metricsRepository.create({
        metric_type: metricType as MetricType,
        period,
        period_start: new Date(periodStart),
        period_end: this.getPeriodEnd(new Date(periodStart), period),
        user_id: userId === 'null' ? null : userId,
        value: totalValue.toString(),
        count,
        metadata: this.aggregateMetadata(values),
      });

      await this.metricsRepository.save(aggregated);
    }

    this.logger.log(`Completed aggregation for period: ${period}`);
  }

  /**
   * Get aggregated metrics for a date range
   */
  async getAggregatedMetrics(
    metricType: MetricType,
    period: AggregationPeriod,
    startDate: Date,
    endDate: Date,
    userId?: string,
  ): Promise<AnalyticsMetric[]> {
    const where: any = {
      metric_type: metricType,
      period,
      period_start: Between(startDate, endDate),
    };

    if (userId) {
      where.user_id = userId;
    }

    return this.metricsRepository.find({
      where,
      order: { period_start: 'ASC' },
    });
  }

  /**
   * Get summary statistics for a metric type
   */
  async getMetricSummary(
    metricType: MetricType,
    startDate: Date,
    endDate: Date,
    userId?: string,
  ): Promise<AggregationResult> {
    const queryBuilder = this.metricsRepository
      .createQueryBuilder('metric')
      .select('metric.metric_type', 'metric_type')
      .addSelect('SUM(CAST(metric.value AS DECIMAL))', 'total_value')
      .addSelect('SUM(metric.count)', 'count')
      .addSelect('AVG(CAST(metric.value AS DECIMAL))', 'average_value')
      .where('metric.metric_type = :metricType', { metricType })
      .andWhere('metric.period_start >= :startDate', { startDate })
      .andWhere('metric.period_start <= :endDate', { endDate })
      .groupBy('metric.metric_type');

    if (userId) {
      queryBuilder.andWhere('metric.user_id = :userId', { userId });
    }

    const result = await queryBuilder.getRawOne();

    return {
      metric_type: result?.metric_type ?? metricType,
      total_value: result?.total_value ?? '0',
      count: parseInt(result?.count ?? '0', 10),
      average_value: result?.average_value ?? '0',
    };
  }

  /**
   * Scheduled job: Aggregate hourly metrics (runs every hour)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async aggregateHourly(): Promise<void> {
    const now = new Date();
    const startDate = new Date(now.getTime() - 60 * 60 * 1000); // Last hour
    const endDate = now;

    try {
      await this.aggregateMetrics(AggregationPeriod.HOURLY, startDate, endDate);
    } catch (error) {
      this.logger.error('Error aggregating hourly metrics', error);
    }
  }

  /**
   * Scheduled job: Aggregate daily metrics (runs at midnight)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async aggregateDaily(): Promise<void> {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);

    try {
      await this.aggregateMetrics(AggregationPeriod.DAILY, startDate, endDate);
    } catch (error) {
      this.logger.error('Error aggregating daily metrics', error);
    }
  }

  /**
   * Scheduled job: Aggregate weekly metrics (runs every Monday)
   */
  @Cron(CronExpression.MONDAY_TO_FRIDAY_AT_1AM)
  async aggregateWeekly(): Promise<void> {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    try {
      await this.aggregateMetrics(AggregationPeriod.WEEKLY, startDate, endDate);
    } catch (error) {
      this.logger.error('Error aggregating weekly metrics', error);
    }
  }

  /**
   * Delete old metrics (data retention)
   */
  async cleanupOldMetrics(retentionDays: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.metricsRepository
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(`Deleted ${result.affected} old metric records`);
  }

  /**
   * Group metrics by period windows
   */
  private groupMetricsByPeriod(
    metrics: AnalyticsMetric[],
    period: AggregationPeriod,
  ): Map<string, AnalyticsMetric[]> {
    const grouped = new Map<string, AnalyticsMetric[]>();

    for (const metric of metrics) {
      const periodStart = this.getPeriodStart(metric.period_start, period);
      const key = `${metric.metric_type}|${periodStart.toISOString()}|${metric.user_id ?? 'null'}`;

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(metric);
    }

    return grouped;
  }

  /**
   * Get the start of a period for a given date
   */
  private getPeriodStart(date: Date, period: AggregationPeriod): Date {
    const result = new Date(date);

    switch (period) {
      case AggregationPeriod.HOURLY:
        result.setMinutes(0, 0, 0);
        break;
      case AggregationPeriod.DAILY:
        result.setHours(0, 0, 0, 0);
        break;
      case AggregationPeriod.WEEKLY:
        const day = result.getDay();
        const diff = result.getDate() - day + (day === 0 ? -6 : 1); // Monday
        result.setDate(diff);
        result.setHours(0, 0, 0, 0);
        break;
      case AggregationPeriod.MONTHLY:
        result.setDate(1);
        result.setHours(0, 0, 0, 0);
        break;
    }

    return result;
  }

  /**
   * Get the end of a period for a given start date
   */
  private getPeriodEnd(startDate: Date, period: AggregationPeriod): Date {
    const result = new Date(startDate);

    switch (period) {
      case AggregationPeriod.HOURLY:
        result.setHours(result.getHours() + 1);
        break;
      case AggregationPeriod.DAILY:
        result.setDate(result.getDate() + 1);
        break;
      case AggregationPeriod.WEEKLY:
        result.setDate(result.getDate() + 7);
        break;
      case AggregationPeriod.MONTHLY:
        result.setMonth(result.getMonth() + 1);
        break;
    }

    return result;
  }

  private getHourStart(date: Date): Date {
    const result = new Date(date);
    result.setMinutes(0, 0, 0);
    return result;
  }

  private getHourEnd(date: Date): Date {
    const result = new Date(date);
    result.setMinutes(59, 59, 999);
    return result;
  }

  /**
   * Aggregate metadata from multiple metrics
   */
  private aggregateMetadata(
    metrics: AnalyticsMetric[],
  ): Record<string, any> | null {
    const metadata: Record<string, any> = {};
    
    for (const metric of metrics) {
      if (metric.metadata) {
        Object.entries(metric.metadata).forEach(([key, value]) => {
          if (!metadata[key]) {
            metadata[key] = [];
          }
          if (!metadata[key].includes(value)) {
            metadata[key].push(value);
          }
        });
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }
}
