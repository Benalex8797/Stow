import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsMetric } from './entities/analytics-metric.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeatureAsync([
    {
      useFactory: () => User,
    },
    {
      useFactory: () => AnalyticsMetric,
    },
  ])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsAggregationService],
  exports: [AnalyticsService, AnalyticsAggregationService],
})
export class AnalyticsModule {}
