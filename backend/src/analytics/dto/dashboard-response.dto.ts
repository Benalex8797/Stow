import { ApiProperty } from '@nestjs/swagger';

export class DashboardKpiDto {
  @ApiProperty({ description: 'Total number of predictions made', example: 128 })
  total_predictions: number;

  @ApiProperty({ description: 'Accuracy rate as a percentage', example: '68.8' })
  accuracy_rate: string;

  @ApiProperty({ description: 'Current leaderboard rank', example: 24 })
  current_rank: number;

  @ApiProperty({
    description: 'Total rewards earned in stroops',
    example: '1240000000',
  })
  total_rewards_earned_stroops: string;

  @ApiProperty({ description: 'Number of active predictions', example: 5 })
  active_predictions_count: number;

  @ApiProperty({ description: 'Current correct prediction streak', example: 4 })
  current_streak: number;

  @ApiProperty({ description: 'User reputation score', example: 840 })
  reputation_score: number;

  @ApiProperty({ description: 'User tier based on reputation', example: 'Gold Predictor' })
  tier: string;
}

export class MetricSummaryDto {
  @ApiProperty({ description: 'Metric type' })
  metric_type: string;

  @ApiProperty({ description: 'Total value aggregated' })
  total_value: string;

  @ApiProperty({ description: 'Number of data points' })
  count: number;

  @ApiProperty({ description: 'Average value' })
  average_value: string;

  @ApiProperty({ description: 'Period of aggregation' })
  period: string;
}

export class AnalyticsTrendDto {
  @ApiProperty({ description: 'Date/time of the data point' })
  timestamp: Date;

  @ApiProperty({ description: 'Value at this point in time' })
  value: string;

  @ApiProperty({ description: 'Count of events at this point' })
  count: number;
}
