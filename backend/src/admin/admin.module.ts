import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UserFlag } from './entities/user-flag.entity';
import { VerifiedAddress } from './entities/verified-address.entity';
import { AnchorDeposit } from '../savings/entities/anchor-deposit.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditLogService } from './audit-log.service';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminAuditInterceptor } from './interceptors/admin-audit.interceptor';
import { ContractEvent } from '../indexer/entities/contract-event.entity';
import { SorobanModule } from '../soroban/soroban.module';
import { CsvImportService } from './csv-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserFlag,
      VerifiedAddress,
      AnchorDeposit,
      AdminAuditLog,
      ContractEvent,
    ]),
    CacheModule.register(),
    SorobanModule,
    ReferralModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuditInterceptor, CsvImportService],
  exports: [AdminService, CsvImportService],
})
export class AdminModule {}
