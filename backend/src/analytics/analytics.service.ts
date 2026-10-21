import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { DashboardKpiDto } from './dto/dashboard-response.dto';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { MetricType, AggregationPeriod } from './entities/analytics-metric.entity';

/**
 * Service for providing analytics and dashboard data.
 * Works in conjunction with AnalyticsAggregationService to provide
 * real-time and historical analytics.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly aggregationService: AnalyticsAggregationService,
  ) {}

  /**
   * Get dashboard KPIs for a user
   * This matches the expected format from the e2e test
   */
  async getDashboardKpis(userId: string): Promise<DashboardKpiDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Calculate accuracy rate
    const accuracyRate =
      user.total_predictions > 0
        ? ((user.correct_predictions / user.total_predictions) * 100).toFixed(1)
        : '0.0';

    // Determine tier based on reputation score
    const tier = this.determineTier(user.reputation_score);

    // Get current streak (this would need to be implemented based on your prediction logic)
    const currentStreak = await this.calculateCurrentStreak(userId);

    // Get active predictions count
    const activePredictions = await this.getActivePredictionsCount(userId);

    // Get current rank (you may need to adjust this based on your leaderboard implementation)
    const currentRank = await this.getCurrentRank(userId);

    return {
      total_predictions: user.total_predictions,
      accuracy_rate: accuracyRate,
      current_rank: currentRank,
      total_rewards_earned_stroops: user.total_winnings_stroops,
      active_predictions_count: activePredictions,
      current_streak: currentStreak,
      reputation_score: user.reputation_score,
      tier,
    };
  }

  /**
   * Track an API request for analytics
   */
  async trackApiRequest(
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    userId?: string,
  ): Promise<void> {
    await this.aggregationService.recordMetric(
      MetricType.API_REQUEST,
      1,
      {
        endpoint,
        method,
        statusCode,
        responseTime,
      },
      userId,
    );

    // Also track response time separately
    await this.aggregationService.recordMetric(
      MetricType.RESPONSE_TIME,
      responseTime,
      {
        endpoint,
        method,
      },
      userId,
    );

    // Track errors if status code is 4xx or 5xx
    if (statusCode >= 400) {
      await this.aggregationService.recordMetric(
        MetricType.ERROR_RATE,
        1,
        {
          endpoint,
          method,
          statusCode,
        },
        userId,
      );
    }
  }

  /**
   * Track user activity
   */
  async trackUserActivity(
    userId: string,
    activityType: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.aggregationService.recordMetric(
      MetricType.USER_ACTIVITY,
      1,
      {
        activityType,
        ...metadata,
      },
      userId,
    );
  }

  /**
   * Get metrics for a specific type and period
   */
  async getMetrics(
    metricType: MetricType,
    period: AggregationPeriod,
    startDate: Date,
    endDate: Date,
    userId?: string,
  ) {
    return this.aggregationService.getAggregatedMetrics(
      metricType,
      period,
      startDate,
      endDate,
      userId,
    );
  }

  /**
   * Get summary of a specific metric
   */
  async getMetricSummary(
    metricType: MetricType,
    startDate: Date,
    endDate: Date,
    userId?: string,
  ) {
    return this.aggregationService.getMetricSummary(
      metricType,
      startDate,
      endDate,
      userId,
    );
  }

  /**
   * Determine user tier based on reputation score
   */
  private determineTier(reputationScore: number): string {
    if (reputationScore >= 1000) return 'Diamond Predictor';
    if (reputationScore >= 750) return 'Gold Predictor';
    if (reputationScore >= 500) return 'Silver Predictor';
    if (reputationScore >= 250) return 'Bronze Predictor';
    return 'Novice Predictor';
  }

  /**
   * Calculate current streak for a user
   * This is a placeholder - implement based on your prediction logic
   */
  private async calculateCurrentStreak(userId: string): Promise<number> {
    // TODO: Implement streak calculation based on consecutive correct predictions
    // For now, return 0 as placeholder
    this.logger.debug(`Calculating streak for user ${userId}`);
    return 0;
  }

  /**
   * Get count of active predictions for a user
   * This is a placeholder - implement based on your prediction logic
   */
  private async getActivePredictionsCount(userId: string): Promise<number> {
    // TODO: Query predictions table for active predictions
    this.logger.debug(`Getting active predictions for user ${userId}`);
    return 0;
  }

  /**
   * Get current leaderboard rank for a user
   * This is a placeholder - implement based on your leaderboard logic
   */
  private async getCurrentRank(userId: string): Promise<number> {
    // TODO: Query leaderboard for user's current rank
    this.logger.debug(`Getting rank for user ${userId}`);
    return 0;
  }
}
