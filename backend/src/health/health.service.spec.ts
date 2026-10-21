import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthService } from './health.service';
import { IndexerService } from '../indexer/indexer.service';

describe('HealthService', () => {
  let service: HealthService;
  let indexerService: IndexerService;

  const mockCache = {
    set: jest.fn(),
    get: jest.fn(),
  };

  const mockHealth = {
    check: jest.fn(),
  };

  const mockDbIndicator = {
    pingCheck: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  const mockIndexerService = {
    getMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: HealthCheckService,
          useValue: mockHealth,
        },
        {
          provide: HttpHealthIndicator,
          useValue: { pingCheck: jest.fn() },
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: mockDbIndicator,
        },
        {
          provide: DiskHealthIndicator,
          useValue: { checkStorage: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
        {
          provide: IndexerService,
          useValue: mockIndexerService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    indexerService = module.get<IndexerService>(IndexerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkLiveness', () => {
    it('reports the process as alive without checking dependencies', () => {
      expect(service.checkLiveness()).toEqual(
        expect.objectContaining({ status: 'ok', type: 'liveness' }),
      );
      expect(mockHealth.check).not.toHaveBeenCalled();
    });
  });

  describe('checkReadiness', () => {
    it('checks the critical database dependency', async () => {
      const readinessResult = {
        status: 'ok' as const,
        details: { database: { status: 'up' } },
      };
      mockHealth.check.mockResolvedValue(readinessResult);
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });

      await expect(service.checkReadiness()).resolves.toEqual(readinessResult);
      expect(mockHealth.check).toHaveBeenCalledTimes(1);

      const [databaseCheck] = mockHealth.check.mock.calls[0][0];
      await databaseCheck();
      expect(mockDbIndicator.pingCheck).toHaveBeenCalledWith('database', {
        connection: mockDataSource,
      });
    });
  });

  describe('checkDetailed', () => {
    it('should return healthy status when indexer lag is within threshold', async () => {
      mockDataSource.query.mockResolvedValue([{ result: 1 }]);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.get.mockResolvedValue('ok');
      mockIndexerService.getMetrics.mockResolvedValue({
        lag_in_ledgers: 50,
        last_processed_ledger: 12000,
        latest_contract_ledger: 12050,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const result = await service.checkDetailed(true);

      expect(result.status).toBe('healthy');
      expect(result).toHaveProperty('indexer');
      expect((result as any).indexer.status).toBe('up');
      expect((result as any).indexer.lag_ledgers).toBe(50);
    });

    it('should return degraded status when indexer lag exceeds threshold', async () => {
      mockDataSource.query.mockResolvedValue([{ result: 1 }]);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.get.mockResolvedValue('ok');
      mockIndexerService.getMetrics.mockResolvedValue({
        lag_in_ledgers: 150,
        last_processed_ledger: 12000,
        latest_contract_ledger: 12150,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const result = await service.checkDetailed(true);

      expect(result.status).toBe('degraded');
      expect((result as any).indexer.status).toBe('down');
      expect((result as any).indexer.lag_ledgers).toBe(150);
    });

    it('should return compact summary when verbose is false', async () => {
      mockDataSource.query.mockResolvedValue([{ result: 1 }]);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.get.mockResolvedValue('ok');
      mockIndexerService.getMetrics.mockResolvedValue({
        lag_in_ledgers: 10,
        last_processed_ledger: 12000,
        latest_contract_ledger: 12010,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const result = await service.checkDetailed(false);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('uptime_seconds');
      expect(result).not.toHaveProperty('indexer');
    });

    it('should handle indexer service errors gracefully', async () => {
      mockDataSource.query.mockResolvedValue([{ result: 1 }]);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.get.mockResolvedValue('ok');
      mockIndexerService.getMetrics.mockRejectedValue(
        new Error('Indexer unavailable'),
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const result = await service.checkDetailed(true);

      expect(result.status).toBe('degraded');
      expect((result as any).indexer.status).toBe('down');
      expect((result as any).indexer.lag_ledgers).toBe(-1);
    });
  });
});
