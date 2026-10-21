import { IsEnum, IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MetricType, AggregationPeriod } from '../entities/analytics-metric.entity';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: MetricType,
    description: 'Type of metric to query',
  })
  @IsOptional()
  @IsEnum(MetricType)
  metric_type?: MetricType;

  @ApiPropertyOptional({
    enum: AggregationPeriod,
    description: 'Aggregation period for the metrics',
  })
  @IsOptional()
  @IsEnum(AggregationPeriod)
  period?: AggregationPeriod;

  @ApiPropertyOptional({
    description: 'Start date for the query (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'End date for the query (ISO 8601 format)',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({
    description: 'Filter metrics for a specific user',
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;
}
