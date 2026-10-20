import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavingsModule } from '../savings/savings.module';
import { RoundupConfig } from './entities/roundup-config.entity';
import { RoundupRecord } from './entities/roundup-record.entity';
import { RoundupBatch } from './entities/roundup-batch.entity';
import { RoundupService } from './services/roundup.service';
import { RoundupCalculatorService } from './services/roundup-calculator.service';
import { RoundupController } from './roundup.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoundupConfig, RoundupRecord, RoundupBatch]),
    SavingsModule,
  ],
  controllers: [RoundupController],
  providers: [RoundupService, RoundupCalculatorService],
  exports: [RoundupService, RoundupCalculatorService],
})
export class RoundupModule {}
