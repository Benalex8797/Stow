import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { DetailedHealthDto, HealthSummaryDto } from './dto/detailed-health.dto';
import { IndexerService } from '../indexer/indexer.service';

const START_TIME = Date.now();
const CACHE_PROBE_KEY = '__health_check_probe__';
const INDEXER_LAG_THRESHOLD_LEDGERS = 100;

type DependencyStatus = { status: string; latency_ms: number };
type IndexerHealthStatus = {
  status: string;
  lag_ledgers: number;
  last_processed_ledger: number;
  latest_contract_ledger: number;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly indexerService: IndexerService,
  ) {}

  /**
   * Run comprehensive health checks:
   * 1. HTTP check (self)
   * 2. Database connectivity (TypeORM)
   * 3. Disk storage availability
   *
   * Returns 200 OK when all checks pass
   * Returns 503 Service Unavailable when any check fails
   */
  @HealthCheck()
  async checkHealth(): Promise<HealthCheckResult> {
    const port = process.env.PORT ?? 3000;
    const baseUrl = `http://localhost:${port}/api/v1/health/ping`;

    return await this.health.check([
      () =>
        this.http.pingCheck('http', baseUrl, {
          timeout: 5000,
        }),
      () => this.db.pingCheck('database', { connection: this.dataSource }),
      () =>
        this.disk.checkStorage('storage', {
          path: os.tmpdir(),
          thresholdPercent: 90,
        }),
    ]);
  }

  /** Liveness only reports whether the application process can serve HTTP. */
  checkLiveness() {
    return {
      status: 'ok',
      type: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness depends on PostgreSQL, the critical dependency for API requests. */
  checkReadiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database', { connection: this.dataSource }),
    ]);
  }

  /**
   * Simple endpoint for HTTP health check (no recursion)
   * Used by the main health check to ping the service
   */
  checkPing() {
    return {
      status: 'ok',
      type: 'ping',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detailed health check with individual component status and latency for monitoring.
   * Probes the database, Soroban RPC, and cache independently and in parallel.
   *
   * The database is treated as a critical dependency: its failure brings the
   * overall status to 'down'. Soroban RPC and cache are non-critical: their
   * failure only degrades the overall status, since the API can still serve
   * most traffic without them.
   *
   * @param verbose When false (default), returns only the overall status and
   * uptime. When true, includes per-dependency status and latency.
   */
  async checkDetailed(
    verbose = false,
  ): Promise<DetailedHealthDto | HealthSummaryDto> {
    const [dbResult, sorobanResult, cacheResult, indexerResult] =
      await Promise.all([
        this.checkDatabase(),
        this.checkSoroban(),
        this.checkCache(),
        this.checkIndexer(),
      ]);

    const status = this.computeOverallStatus(
      dbResult,
      sorobanResult,
      cacheResult,
      indexerResult,
    );
    const uptime_seconds = Math.floor((Date.now() - START_TIME) / 1000);

    if (!verbose) {
      return { status, uptime_seconds };
    }

    return {
      status,
      database: dbResult,
      soroban: sorobanResult,
      cache: cacheResult,
      indexer: indexerResult,
      uptime_seconds,
    };
  }

  private computeOverallStatus(
    database: DependencyStatus,
    soroban: DependencyStatus,
    cache: DependencyStatus,
    indexer: IndexerHealthStatus,
  ): 'healthy' | 'degraded' | 'down' {
    if (database.status !== 'up') {
      return 'down';
    }
    if (
      soroban.status !== 'up' ||
      cache.status !== 'up' ||
      indexer.status !== 'up'
    ) {
      return 'degraded';
    }
    return 'healthy';
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up', latency_ms: Date.now() - start };
    } catch {
      return { status: 'down', latency_ms: Date.now() - start };
    }
  }

  private async checkSoroban(): Promise<DependencyStatus> {
    const rpcUrl =
      process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
          params: [],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latency = Date.now() - start;
      return { status: response.ok ? 'up' : 'degraded', latency_ms: latency };
    } catch {
      return { status: 'down', latency_ms: Date.now() - start };
    }
  }

  /** Round-trips a probe value through the cache to verify it is reachable. */
  private async checkCache(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      await this.cacheManager.set(CACHE_PROBE_KEY, 'ok', 5000);
      const value = await this.cacheManager.get(CACHE_PROBE_KEY);
      return {
        status: value === 'ok' ? 'up' : 'down',
        latency_ms: Date.now() - start,
      };
    } catch {
      return { status: 'down', latency_ms: Date.now() - start };
    }
  }

  /**
   * Checks indexer health by examining the lag between the last processed
   * ledger and the latest contract ledger. Marks unhealthy when lag exceeds
   * the threshold.
   */
  private async checkIndexer(): Promise<IndexerHealthStatus> {
    try {
      const metrics = await this.indexerService.getMetrics();
      const lag = metrics.lag_in_ledgers;
      const status = lag > INDEXER_LAG_THRESHOLD_LEDGERS ? 'down' : 'up';

      return {
        status,
        lag_ledgers: lag,
        last_processed_ledger: metrics.last_processed_ledger,
        latest_contract_ledger: metrics.latest_contract_ledger,
      };
    } catch {
      return {
        status: 'down',
        lag_ledgers: -1,
        last_processed_ledger: 0,
        latest_contract_ledger: 0,
      };
    }
  }
}
