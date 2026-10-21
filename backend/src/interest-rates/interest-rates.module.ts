import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InterestRateConfig } from './entities/interest-rate-config.entity';
import { InterestRateHistory } from './entities/interest-rate-history.entity';
import { OracleData } from './entities/oracle-data.entity';
import { Balance } from '../savings/entities/balance.entity';
import { InterestRateService } from './services/interest-rate.service';
import { RateCalculatorService } from './services/rate-calculator.service';
import { InterestRatesController } from './interest-rates.controller';
import { InterestRatesAdminController } from './admin/interest-rates-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InterestRateConfig,
      InterestRateHistory,
      OracleData,
      Balance,
    ]),
  ],
  controllers: [InterestRatesController, InterestRatesAdminController],
  providers: [InterestRateService, RateCalculatorService],
  exports: [InterestRateService, RateCalculatorService],
})
export class InterestRatesModule {}
