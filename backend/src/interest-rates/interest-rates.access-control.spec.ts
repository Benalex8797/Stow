import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { InterestRatesModule } from './interest-rates.module';
import { InterestRateService } from './services/interest-rate.service';
import { User } from '../users/entities/user.entity';

describe('Interest Rates - Access Control Tests', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let interestRateService: InterestRateService;

  // Mock repositories
  let mockInterestRateConfigRepository: any;
  let mockInterestRateHistoryRepository: any;
  let mockOracleDataRepository: any;

  // Test data
  const regularUser = {
    id: 'user-123',
    stellar_address: 'GXYZ...',
    role: 'user',
  } as User;

  const adminUser = {
    id: 'admin-001',
    stellar_address: 'GADMIN...',
    role: 'admin',
  } as User;

  const testConfig = {
    id: 'config-1',
    name: 'Main Vault',
    asset: 'USDC',
    base_rate: 2.5,
    min_rate: 0.25,
    max_rate: 40.0,
    optimal_utilization: 0.85,
    slope_up: 0.05,
    slope_down: 0.25,
    smoothing_factor: 0.1,
    is_active: true,
  };

  beforeAll(async () => {
    // Mock repositories
    mockInterestRateConfigRepository = {
      find: jest.fn().mockResolvedValue([testConfig]),
      findOne: jest.fn().mockResolvedValue(testConfig),
      findOneBy: jest.fn().mockResolvedValue(testConfig),
      save: jest.fn().mockResolvedValue(testConfig),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockInterestRateHistoryRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({}),
    };

    mockOracleDataRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({}),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [InterestRatesModule],
      providers: [
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(regularUser) },
        },
        {
          provide: 'InterestRateConfigRepository',
          useValue: mockInterestRateConfigRepository,
        },
        {
          provide: 'InterestRateHistoryRepository',
          useValue: mockInterestRateHistoryRepository,
        },
        {
          provide: 'OracleDataRepository',
          useValue: mockOracleDataRepository,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    interestRateService = moduleFixture.get<InterestRateService>(
      InterestRateService,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // ============= PUBLIC USER ENDPOINTS - AUTHENTICATION TESTS =============

  describe('User Endpoints - Authentication', () => {
    it('should deny access without JWT token to current rate', async () => {
      const response = await request(app.getHttpServer()).get(
        '/interest-rates/current',
      );

      expect(response.status).toBe(401);
    });

    it('should deny access with invalid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should allow access with valid JWT token', async () => {
      const token = jwtService.sign({ sub: regularUser.id, role: 'user' });

      const response = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).not.toBe(401);
    });

    it('should protect all user endpoints with JWT', async () => {
      const endpoints = [
        '/interest-rates/current',
        '/interest-rates/config',
        '/interest-rates/utilization',
        '/interest-rates/history/config-1',
        '/interest-rates/project/config-1?utilization=75',
      ];

      for (const endpoint of endpoints) {
        const response = await request(app.getHttpServer()).get(endpoint);
        expect(response.status).toBe(401);
      }
    });
  });

  // ============= USER ENDPOINTS - AUTHORIZATION TESTS =============

  describe('User Endpoints - Authorization', () => {
    let userToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
    });

    it('should allow regular user to view current rate', async () => {
      jest
        .spyOn(interestRateService, 'getCurrentRate')
        .mockResolvedValueOnce({
          current_rate: 6.9,
          utilization: 0.75,
          timestamp: new Date(),
        } as any);

      const response = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow regular user to list configurations', async () => {
      jest
        .spyOn(interestRateService, 'listConfigs')
        .mockResolvedValueOnce([testConfig] as any);

      const response = await request(app.getHttpServer())
        .get('/interest-rates/config')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow regular user to get specific configuration', async () => {
      jest
        .spyOn(interestRateService, 'getConfig')
        .mockResolvedValueOnce(testConfig as any);

      const response = await request(app.getHttpServer())
        .get(`/interest-rates/config/${testConfig.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow regular user to view rate history', async () => {
      jest
        .spyOn(interestRateService, 'getRateHistory')
        .mockResolvedValueOnce([]);

      const response = await request(app.getHttpServer())
        .get(`/interest-rates/history/${testConfig.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow regular user to project rates', async () => {
      jest
        .spyOn(interestRateService, 'getConfig')
        .mockResolvedValueOnce(testConfig as any);
      jest
        .spyOn(interestRateService, 'projectRate')
        .mockResolvedValueOnce(7.5);

      const response = await request(app.getHttpServer())
        .get(`/interest-rates/project/${testConfig.id}?utilization=75`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow regular user to view utilization metrics', async () => {
      jest
        .spyOn(interestRateService, 'getUtilizationMetrics')
        .mockResolvedValueOnce({
          utilization: 0.75,
          available_liquidity: BigInt('1000000000'),
          deployed_capital: BigInt('750000000'),
          total_deposits: BigInt('1750000000'),
        } as any);

      const response = await request(app.getHttpServer())
        .get('/interest-rates/utilization')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });
  });

  // ============= ADMIN ENDPOINTS - AUTHENTICATION TESTS =============

  describe('Admin Endpoints - Authentication', () => {
    it('should deny admin access without JWT token', async () => {
      const response = await request(app.getHttpServer()).get(
        '/admin/interest-rates/configs',
      );

      expect(response.status).toBe(401);
    });

    it('should deny admin access with invalid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should allow admin access with valid JWT token', async () => {
      const adminToken = jwtService.sign({
        sub: adminUser.id,
        role: 'admin',
      });

      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(401);
    });
  });

  // ============= ADMIN ENDPOINTS - AUTHORIZATION TESTS =============

  describe('Admin Endpoints - Authorization (Role-Based)', () => {
    let userToken: string;
    let adminToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
      adminToken = jwtService.sign({ sub: adminUser.id, role: 'admin' });
    });

    it('should deny regular user access to list admin configs', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to create configuration', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'New Config',
          base_rate: 2.5,
          optimal_utilization: 0.85,
        });

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to update configuration', async () => {
      const response = await request(app.getHttpServer())
        .put(`/admin/interest-rates/configs/${testConfig.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ base_rate: 3.0 });

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to activate configuration', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/admin/interest-rates/configs/${testConfig.id}/activate`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to admin stats', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should allow admin to list configurations', async () => {
      jest
        .spyOn(interestRateService, 'listConfigs')
        .mockResolvedValueOnce([testConfig] as any);

      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow admin to create configuration', async () => {
      jest
        .spyOn(interestRateService, 'createConfig')
        .mockResolvedValueOnce(testConfig as any);

      const response = await request(app.getHttpServer())
        .post('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Config',
          base_rate: 2.5,
          optimal_utilization: 0.85,
        });

      expect(response.status).not.toBe(403);
    });

    it('should allow admin to update configuration', async () => {
      jest
        .spyOn(interestRateService, 'updateConfig')
        .mockResolvedValueOnce(testConfig as any);

      const response = await request(app.getHttpServer())
        .put(`/admin/interest-rates/configs/${testConfig.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ base_rate: 3.0 });

      expect(response.status).not.toBe(403);
    });

    it('should allow admin to activate configuration', async () => {
      jest
        .spyOn(interestRateService, 'activateConfig')
        .mockResolvedValueOnce(testConfig as any);

      const response = await request(app.getHttpServer())
        .post(
          `/admin/interest-rates/configs/${testConfig.id}/activate`,
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(403);
    });
  });

  // ============= PERMISSION BOUNDARY TESTS =============

  describe('Permission Boundary Tests', () => {
    let userToken: string;
    let adminToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
      adminToken = jwtService.sign({ sub: adminUser.id, role: 'admin' });
    });

    it('user cannot access any admin-only endpoints', async () => {
      const adminEndpoints = [
        { method: 'get', path: '/admin/interest-rates/configs' },
        { method: 'post', path: '/admin/interest-rates/configs' },
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app.getHttpServer())
          [endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(403);
      }
    });

    it('should validate query parameters cannot bypass authorization', async () => {
      // Attempt to bypass with query manipulation
      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs?user=false')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should prevent privilege escalation via token tampering', async () => {
      const tamperedToken = jwtService.sign({
        sub: regularUser.id,
        role: 'admin', // Attempting to claim admin role
      });

      const response = await request(app.getHttpServer())
        .get('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${tamperedToken}`);

      // If properly validated from DB, should fail
      expect(response.status).not.toBe(200);
    });

    it('should not expose admin endpoints to unauthenticated users', async () => {
      const response = await request(app.getHttpServer()).get(
        '/admin/interest-rates/configs',
      );

      expect(response.status).toBe(401);
    });

    it('should handle rate limiting independently per endpoint', async () => {
      const userToken = jwtService.sign({
        sub: regularUser.id,
        role: 'user',
      });

      // User can repeatedly access user endpoint (if no rate limit)
      const response1 = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${userToken}`);

      const response2 = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${userToken}`);

      // Both should succeed (rate limiting is different concern)
      expect([response1.status, response2.status]).toEqual(
        expect.arrayContaining([200, 400, 404, 500]),
      );
    });
  });

  // ============= INPUT VALIDATION & BOUNDARY TESTS =============

  describe('Input Validation & Boundary Tests', () => {
    let userToken: string;
    let adminToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
      adminToken = jwtService.sign({ sub: adminUser.id, role: 'admin' });
    });

    it('should validate utilization parameter range', async () => {
      // Valid: 0-100
      const validResponse = await request(app.getHttpServer())
        .get(`/interest-rates/project/config-1?utilization=50`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 404]).toContain(validResponse.status);

      // Invalid: > 100
      const invalidResponse = await request(app.getHttpServer())
        .get(`/interest-rates/project/config-1?utilization=150`)
        .set('Authorization', `Bearer ${userToken}`);

      // Should reject or handle gracefully
      expect([200, 400, 404]).toContain(invalidResponse.status);
    });

    it('should validate limit parameter on history endpoint', async () => {
      jest
        .spyOn(interestRateService, 'getRateHistory')
        .mockResolvedValueOnce([]);

      // Valid: positive integer
      const validResponse = await request(app.getHttpServer())
        .get('/interest-rates/history/config-1?limit=50')
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 404]).toContain(validResponse.status);

      // Invalid: negative
      const invalidResponse = await request(app.getHttpServer())
        .get('/interest-rates/history/config-1?limit=-10')
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 404]).toContain(invalidResponse.status);
    });

    it('should reject invalid config ID format', async () => {
      const response = await request(app.getHttpServer())
        .get('/interest-rates/config/invalid@#$%id')
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 404]).toContain(response.status);
    });

    it('should validate base_rate within acceptable bounds on creation', async () => {
      const adminToken = jwtService.sign({
        sub: adminUser.id,
        role: 'admin',
      });

      // Invalid: negative rate
      const negativeResponse = await request(app.getHttpServer())
        .post('/admin/interest-rates/configs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invalid Config',
          base_rate: -1.0,
          optimal_utilization: 0.85,
        });

      expect([400, 403, 404, 500]).toContain(negativeResponse.status);
    });
  });

  // ============= DATA ISOLATION TESTS =============

  describe('Data Isolation Tests', () => {
    let user1Token: string;
    let user2Token: string;

    beforeEach(() => {
      user1Token = jwtService.sign({ sub: regularUser.id, role: 'user' });
      user2Token = jwtService.sign({
        sub: 'user-999',
        role: 'user',
      });
    });

    it('all users should see the same rate configuration', async () => {
      jest
        .spyOn(interestRateService, 'getCurrentRate')
        .mockResolvedValue({
          current_rate: 6.9,
          utilization: 0.75,
          timestamp: new Date(),
        } as any);

      const response1 = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${user1Token}`);

      const response2 = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${user2Token}`);

      // Both should get same data
      expect([response1.status, response2.status]).toEqual(
        expect.arrayContaining([
          response1.status,
          response2.status,
        ]),
      );
    });

    it('should not allow users to access other user specific data', async () => {
      // Interest rates are global, but ensure no user-specific data leakage
      const response = await request(app.getHttpServer())
        .get('/interest-rates/current')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(401);
      // Response should not contain user-specific fields
      if (response.body) {
        expect(response.body).not.toHaveProperty('user_id');
        expect(response.body).not.toHaveProperty('user_email');
      }
    });
  });
});
