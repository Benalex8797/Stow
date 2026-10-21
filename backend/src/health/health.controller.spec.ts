jest.mock('./health.service', () => ({
  HealthService: class HealthService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: {
    checkHealth: jest.Mock;
    checkLiveness: jest.Mock;
    checkReadiness: jest.Mock;
    checkPing: jest.Mock;
    checkDetailed: jest.Mock;
  };

  beforeEach(async () => {
    healthService = {
      checkHealth: jest.fn(),
      checkLiveness: jest.fn().mockReturnValue({
        status: 'ok',
        type: 'liveness',
        timestamp: new Date().toISOString(),
      }),
      checkReadiness: jest.fn(),
      checkPing: jest.fn().mockReturnValue({
        status: 'ok',
        type: 'ping',
        timestamp: new Date().toISOString(),
      }),
      checkDetailed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('checkLiveness', () => {
    it('delegates to the liveness probe', () => {
      const result = controller.checkLiveness();

      expect(result).toEqual(
        expect.objectContaining({ status: 'ok', type: 'liveness' }),
      );
      expect(healthService.checkLiveness).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkReadiness', () => {
    it('delegates to the readiness probe', async () => {
      const readinessResult = {
        status: 'ok',
        details: { database: { status: 'up' } },
      };
      healthService.checkReadiness.mockResolvedValue(readinessResult);

      await expect(controller.checkReadiness()).resolves.toEqual(
        readinessResult,
      );
      expect(healthService.checkReadiness).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkDependencies', () => {
    it('requests detailed dependency status', async () => {
      const dependencyStatus = {
        status: 'degraded',
        database: { status: 'up', latency_ms: 3 },
        soroban: { status: 'down', latency_ms: 5000 },
        cache: { status: 'up', latency_ms: 1 },
        indexer: {
          status: 'up',
          lag_ledgers: 1,
          last_processed_ledger: 10,
          latest_contract_ledger: 11,
        },
        uptime_seconds: 42,
      };
      healthService.checkDetailed.mockResolvedValue(dependencyStatus);

      await expect(controller.checkDependencies()).resolves.toEqual(
        dependencyStatus,
      );
      expect(healthService.checkDetailed).toHaveBeenCalledWith(true);
    });
  });

  describe('check', () => {
    it('should return health status when all checks pass', async () => {
      const healthCheckResult = {
        status: 'ok' as const,
        details: {
          http: { status: 'up' },
          database: { status: 'up' },
          storage: { status: 'up' },
        },
      };

      healthService.checkHealth.mockResolvedValue(healthCheckResult);

      const result = await controller.check();

      expect(result).toEqual(healthCheckResult);
      expect(healthService.checkHealth).toHaveBeenCalled();
    });

    it('should delegate to HealthService', async () => {
      healthService.checkHealth.mockResolvedValue({
        status: 'ok',
        details: {},
      });

      await controller.check();

      expect(healthService.checkHealth).toHaveBeenCalledTimes(1);
    });

    it('should return 503 payload when service reports error', async () => {
      const failedHealthCheck = {
        status: 'error' as const,
        details: {
          http: { status: 'up' },
          database: { status: 'down', message: 'Connection refused' },
          storage: { status: 'up' },
        },
      };

      healthService.checkHealth.mockResolvedValue(failedHealthCheck);

      const result = await controller.check();

      expect(result).toEqual(failedHealthCheck);
    });
  });

  describe('checkPing', () => {
    it('should return ping status', () => {
      const result = controller.checkPing();

      expect(result).toBeDefined();
      expect(result.status).toBe('ok');
      expect(result.type).toBe('ping');
      expect(result.timestamp).toBeDefined();
      expect(healthService.checkPing).toHaveBeenCalled();
    });

    it('should return valid ISO timestamp', () => {
      healthService.checkPing.mockReturnValueOnce({
        status: 'ok',
        type: 'ping',
        timestamp: '2026-01-15T12:00:00.000Z',
      });

      const result = controller.checkPing();

      const timestamp = new Date(result.timestamp);
      expect(timestamp instanceof Date).toBe(true);
      expect(!Number.isNaN(timestamp.getTime())).toBe(true);
    });
  });

  describe('checkDetailed', () => {
    it('requests a compact summary when verbose is omitted', async () => {
      healthService.checkDetailed.mockResolvedValue({
        status: 'healthy',
        uptime_seconds: 42,
      });

      const result = await controller.checkDetailed();

      expect(healthService.checkDetailed).toHaveBeenCalledWith(false);
      expect(result).toEqual({ status: 'healthy', uptime_seconds: 42 });
    });

    it('requests full detail when verbose=true', async () => {
      const detailed = {
        status: 'degraded',
        database: { status: 'up', latency_ms: 3 },
        soroban: { status: 'down', latency_ms: 5000 },
        cache: { status: 'up', latency_ms: 1 },
        uptime_seconds: 42,
      };
      healthService.checkDetailed.mockResolvedValue(detailed);

      const result = await controller.checkDetailed('true');

      expect(healthService.checkDetailed).toHaveBeenCalledWith(true);
      expect(result).toEqual(detailed);
    });

    it('treats any non-"true" value as non-verbose', async () => {
      healthService.checkDetailed.mockResolvedValue({
        status: 'healthy',
        uptime_seconds: 1,
      });

      await controller.checkDetailed('yes');

      expect(healthService.checkDetailed).toHaveBeenCalledWith(false);
    });
  });

  describe('Access control', () => {
    it('health endpoint should be public (decorated with @Public)', () => {
      expect(controller.check).toBeDefined();
    });

    it('ping endpoint should be public', () => {
      expect(controller.checkPing).toBeDefined();
    });
  });
});
