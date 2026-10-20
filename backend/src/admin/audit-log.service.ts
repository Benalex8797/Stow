import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface CreateAuditLogDto {
  actor_id: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogPage {
  data: AdminAuditLog[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  broken_at: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly repo: Repository<AdminAuditLog>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persist a new audit log entry and compute its chain checksum.
   * The checksum covers: (prev_checksum | actor_id | action | created_at),
   * keyed with AUDIT_LOG_HMAC_SECRET so an attacker without the key cannot
   * forge a valid chain.
   */
  async log(dto: CreateAuditLogDto): Promise<AdminAuditLog> {
    const entry = this.repo.create({
      actor_id: dto.actor_id,
      action: dto.action,
      target_type: dto.target_type ?? null,
      target_id: dto.target_id ?? null,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.repo.save(entry);

    // Compute chain checksum after the row has a stable id + created_at.
    saved.checksum = await this.computeChecksum(saved);
    await this.repo.save(saved);

    return saved;
  }

  /** Query audit logs with filtering and pagination. */
  async query(dto: AuditLogQueryDto): Promise<AuditLogPage> {
    const { page = 1, limit = 20, actor_id, action, from, to } = dto;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('log')
      .orderBy('log.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    if (actor_id) qb.andWhere('log.actor_id = :actor_id', { actor_id });
    if (action) qb.andWhere('log.action = :action', { action });
    if (from) qb.andWhere('log.created_at >= :from', { from: new Date(from) });
    if (to) qb.andWhere('log.created_at <= :to', { to: new Date(to) });

    const [data, total] = await qb.getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Walk all rows in insertion order and verify each checksum matches the
   * expected hash of its predecessor.  Returns the id of the first broken
   * link, or null if the chain is intact.
   *
   * Complexity: O(n) — call sparingly (e.g. scheduled job, not per-request).
   */
  async verifyIntegrity(): Promise<IntegrityReport> {
    const rows = await this.repo.find({ order: { created_at: 'ASC' } });

    let prevChecksum = '';
    for (const row of rows) {
      const expected = this.computeChecksumSync(row, prevChecksum);
      if (row.checksum !== expected) {
        this.logger.warn(`Audit log integrity violation at row ${row.id}`);
        return { ok: false, checked: rows.indexOf(row) + 1, broken_at: row.id };
      }
      prevChecksum = row.checksum!;
    }

    return { ok: true, checked: rows.length, broken_at: null };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async computeChecksum(row: AdminAuditLog): Promise<string> {
    // Resolve prev checksum from the row immediately before this one.
    const prev = await this.repo
      .createQueryBuilder('log')
      .select('log.checksum')
      .where('log.created_at < :ts', { ts: row.created_at })
      .orWhere('log.created_at = :ts AND log.id < :id', { ts: row.created_at, id: row.id })
      .orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .getOne();

    return this.computeChecksumSync(row, prev?.checksum ?? '');
  }

  private computeChecksumSync(row: AdminAuditLog, prevChecksum: string): string {
    const secret = this.config.get<string>('AUDIT_LOG_HMAC_SECRET') ?? 'default-dev-secret';
    const payload = [prevChecksum, row.id, row.actor_id, row.action, row.created_at.toISOString()].join('|');
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
