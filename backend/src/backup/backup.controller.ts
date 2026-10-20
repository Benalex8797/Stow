import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  create() {
    return this.backupService.createBackup();
  }

  @Get()
  list() {
    return this.backupService.listBackups();
  }

  @Post(':id/verify')
  verify(@Param('id') id: string) {
    return this.backupService.verifyBackup(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Body('targetTime') targetTime?: string) {
    return this.backupService.restoreBackup(id, targetTime);
  }
}
