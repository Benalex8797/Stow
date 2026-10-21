import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum MetricType {
  USER_ACTIVITY = 'user_activity',
  SAVINGS_VOLUME = 'savings_volume',
  TRANSACTION_COUNT = 'transaction_count',
  API_REQUEST = 'api_request',
  ERROR_RATE = 'error_rate',
  RESPONSE_TIME = 'response_time',
  USER_REGISTRATION = 'user_registration',
  GOAL_CREATION = 'goal_creation',
  WEBHOOK_DELIVERY = 'webhook_delivery',
}

export enum AggregationPeriod {
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Entity('analytics_metrics')
@Index(['metric_type', 'period', 'period_start'])
@Index(['user_id', 'metric_type'])
@Index(['period_start'])
export class AnalyticsMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: MetricType,
  })
  metric_type: MetricType;

  @Column({
    type: 'enum',
    enum: AggregationPeriod,
  })
  period: AggregationPeriod;

  @Column({ type: 'timestamp' })
  period_start: Date;

  @Column({ type: 'timestamp' })
  period_end: Date;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  value: string;

  @Column({ type: 'integer', default: 1 })
  count: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
