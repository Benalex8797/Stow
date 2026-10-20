import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface BackupRecord {
  id: string;
  file: string;
  createdAt: string;
  sizeBytes: number;
  checksum: string;
  verified: boolean;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;
  private readonly databaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.backupDir =
      this.configService.get<string>('BACKUP_DIR') ?? join(process.cwd(), 'backups');
    this.databaseUrl = this.configService.get<string>('DATABASE_URL') ?? '';
  }

  @Cron(process.env.BACKUP_CRON ?? CronExpression.EVERY_DAY_AT_2AM)
  async runScheduledBackup(): Promise<void> {
    try {
      const record = await this.createBackup();
      this.logger.log(`Scheduled backup created: ${record.id}`);
    } catch (error) {
      this.logger.error(`Scheduled backup failed: ${(error as Error).message}`);
    }
  }

  async createBackup(): Promise<BackupRecord> {
    await fs.mkdir(this.backupDir, { recursive: true });
    const id = `backup-${Date.now()}`;
    const file = join(this.backupDir, `${id}.sql`);

    await execFileAsync('pg_dump', ['--dbname', this.databaseUrl, '--file', file]);

    const data = await fs.readFile(file);
    const checksum = createHash('sha256').update(data).digest('hex');
    const record: BackupRecord = {
      id,
      file,
      createdAt: new Date().toISOString(),
      sizeBytes: data.length,
      checksum,
      verified: false,
    };

    await fs.writeFile(`${file}.meta.json`, JSON.stringify(record, null, 2));
    return record;
  }

  async listBackups(): Promise<BackupRecord[]> {
    try {
      const entries = await fs.readdir(this.backupDir);
      const metas = entries.filter((e) => e.endsWith('.meta.json'));
      const records = await Promise.all(
        metas.map(async (meta) => {
          const raw = await fs.readFile(join(this.backupDir, meta), 'utf8');
          return JSON.parse(raw) as BackupRecord;
        }),
      );
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async verifyBackup(id: string): Promise<BackupRecord> {
    const record = await this.getBackup(id);
    const data = await fs.readFile(record.file);
    const checksum = createHash('sha256').update(data).digest('hex');
    const verified = checksum === record.checksum && data.length === record.sizeBytes;

    const updated: BackupRecord = { ...record, verified };
    await fs.writeFile(`${record.file}.meta.json`, JSON.stringify(updated, null, 2));

    if (!verified) {
      throw new Error(`Backup ${id} failed verification`);
    }
    return updated;
  }

  async restoreBackup(id: string, targetTime?: string): Promise<void> {
    const record = await this.getBackup(id);
    await this.verifyBackup(id);

    const args = ['--dbname', this.databaseUrl, '--file', record.file];
    await execFileAsync('psql', args);

    if (targetTime) {
      await this.recoverToPointInTime(targetTime);
    }
  }

  private async recoverToPointInTime(targetTime: string): Promise<void> {
    const target = new Date(targetTime);
    if (Number.isNaN(target.getTime())) {
      throw new Error(`Invalid point-in-time target: ${targetTime}`);
    }
    await execFileAsync('psql', [
      '--dbname',
      this.databaseUrl,
      '--command',
      `SELECT pg_create_restore_point('restore_${target.getTime()}');`,
    ]);
    this.logger.log(`Point-in-time recovery marker set for ${target.toISOString()}`);
  }

  private async getBackup(id: string): Promise<BackupRecord> {
    const metaPath = join(this.backupDir, `${id}.sql.meta.json`);
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      return JSON.parse(raw) as BackupRecord;
    } catch {
      throw new NotFoundException(`Backup ${id} not found`);
    }
  }
}
