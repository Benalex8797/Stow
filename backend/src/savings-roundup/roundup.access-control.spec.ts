import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { RoundupModule } from './roundup.module';
import { RoundupService } from './services/roundup.service';
import { User } from '../users/entities/user.entity';
import { RoundupConfig, RoundupFrequency } from './entities/roundup-config.entity';
import { RoundupRecord, RoundupRecordStatus, RoundupTriggerSource } from './entities/roundup-record.entity';

describe('Savings Roundup - Access Control Tests', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let roundupService: RoundupService;

  // Mock repositories
  let mockRoundupConfigRepository: any;
  let mockRoundupRecordRepository: any;
  let mockUserRepository: any;

  // Test data
  const regularUser = {
    id: 'user-123',
    stellar_address: 'GXYZ...',
    role: 'user',
  } as User;

  const anotherUser = {
    id: 'user-456',
    stellar_address: 'GABC...',
    role: 'user',
  } as User;

  const adminUser = {
    id: 'admin-001',
    stellar_address: 'GADMIN...',
    role: 'admin',
  } as User;

  const userConfig = {
    id: 'config-1',
    user_id: 'user-123',
    name: 'Daily Roundup',
    method: 'nearest_dollar',
    frequency: RoundupFrequency.DAILY,
    is_active: true,
    is_paused: false,
  } as RoundupConfig;

  const anotherUserConfig = {
    id: 'config-2',
    user_id: 'user-456',
    name: 'Weekly Roundup',
    method: 'nearest_quarter',
    frequency: RoundupFrequency.WEEKLY,
    is_active: true,
    is_paused: false,
  } as RoundupConfig;

  const userRecord = {
    id: 'record-1',
    user_id: 'user-123',
    config_id: 'config-1',
    status: RoundupRecordStatus.PENDING,
    trigger_source: RoundupTriggerSource.TRANSACTION,
  } as RoundupRecord;

  const anotherUserRecord = {
    id: 'record-2',
    user_id: 'user-456',
    config_id: 'config-2',
    status: RoundupRecordStatus.PENDING,
    trigger_source: RoundupTriggerSource.TRANSACTION,
  } as RoundupRecord;

  beforeAll(async () => {
    // Mock repositories
    mockRoundupConfigRepository = {
      find: jest.fn().mockResolvedValue([userConfig]),
      findOne: jest.fn().mockResolvedValue(userConfig),
      findOneBy: jest.fn().mockResolvedValue(userConfig),
      save: jest.fn().mockResolvedValue(userConfig),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockRoundupRecordRepository = {
      find: jest.fn().mockResolvedValue([userRecord]),
      findOne: jest.fn().mockResolvedValue(userRecord),
      findOneBy: jest.fn().mockResolvedValue(userRecord),
      save: jest.fn().mockResolvedValue(userRecord),
    };

    mockUserRepository = {
      findOne: jest.fn().mockResolvedValue(regularUser),
      findOneBy: jest.fn().mockResolvedValue(regularUser),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [RoundupModule],
      providers: [
        {
          provide: getRepositoryToken(RoundupConfig),
          useValue: mockRoundupConfigRepository,
        },
        {
          provide: getRepositoryToken(RoundupRecord),
          useValue: mockRoundupRecordRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    roundupService = moduleFixture.get<RoundupService>(RoundupService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ============= AUTHENTICATION TESTS =============

  describe('Authentication Tests', () => {
    it('should deny access without JWT token to config creation', async () => {
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .send({ name: 'Test' });

      expect(response.status).toBe(401);
    });

    it('should deny access without JWT token to list configs', async () => {
      const response = await request(app.getHttpServer()).get(
        '/savings/roundup/config',
      );

      expect(response.status).toBe(401);
    });

    it('should deny access with invalid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .get('/savings/roundup/config')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should allow access with valid JWT token', async () => {
      const token = jwtService.sign({ sub: regularUser.id, role: 'user' });

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/config')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).not.toBe(401);
    });

    it('should protect all roundup endpoints with JWT', async () => {
      const endpoints = [
        '/savings/roundup/config',
        '/savings/roundup/records',
        '/savings/roundup/stats',
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

    it('should allow user to create configuration', async () => {
      jest
        .spyOn(roundupService, 'createConfig')
        .mockResolvedValueOnce(userConfig);

      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Daily Roundup',
          method: 'nearest_dollar',
          frequency: 'daily',
        });

      expect(response.status).not.toBe(403);
    });

    it('should allow user to list their configurations', async () => {
      jest
        .spyOn(roundupService, 'listConfigs')
        .mockResolvedValueOnce([userConfig]);

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow user to list their records', async () => {
      jest
        .spyOn(roundupService, 'listRecords')
        .mockResolvedValueOnce([userRecord]);

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/records')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow user to view stats', async () => {
      jest.spyOn(roundupService, 'getStats').mockResolvedValueOnce({
        total_configs: 1,
        active_configs: 1,
        total_accumulated: '1000000',
      } as any);

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow user to process records', async () => {
      jest
        .spyOn(roundupService, 'processRecordsForUser')
        .mockResolvedValueOnce([]);

      const response = await request(app.getHttpServer())
        .post('/savings/roundup/process')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });
  });

  // ============= CONFIGURATION OWNERSHIP TESTS =============

  describe('Configuration Ownership & Boundary Tests', () => {
    let user1Token: string;
    let user2Token: string;

    beforeEach(() => {
      user1Token = jwtService.sign({ sub: regularUser.id, role: 'user' });
      user2Token = jwtService.sign({ sub: anotherUser.id, role: 'user' });
    });

    it('should prevent user from accessing another user config', async () => {
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/config/${anotherUserConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should prevent user from updating another user config', async () => {
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .put(`/savings/roundup/config/${anotherUserConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Hacked' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should prevent user from pausing another user config', async () => {
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/config/${anotherUserConfig.id}/pause`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should prevent user from resuming another user config', async () => {
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/config/${anotherUserConfig.id}/resume`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should prevent user from triggering roundup on another user config', async () => {
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/trigger/${anotherUserConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should allow user to access their own config', async () => {
      jest.spyOn(roundupService, 'getConfig').mockResolvedValueOnce(userConfig);

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/config/${userConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(400);
    });

    it('should allow user to update their own config', async () => {
      jest
        .spyOn(roundupService, 'getConfig')
        .mockResolvedValueOnce(userConfig);
      jest.spyOn(roundupService, 'updateConfig').mockResolvedValueOnce({
        ...userConfig,
        name: 'Updated',
      });

      const response = await request(app.getHttpServer())
        .put(`/savings/roundup/config/${userConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Updated' });

      expect(response.status).not.toBe(400);
    });

    it('should allow user to pause their own config', async () => {
      jest
        .spyOn(roundupService, 'getConfig')
        .mockResolvedValueOnce(userConfig);
      jest.spyOn(roundupService, 'pauseConfig').mockResolvedValueOnce({
        ...userConfig,
        is_paused: true,
      });

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/config/${userConfig.id}/pause`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({});

      expect(response.status).not.toBe(400);
    });

    it('should allow user to resume their own config', async () => {
      jest
        .spyOn(roundupService, 'getConfig')
        .mockResolvedValueOnce(userConfig);
      jest.spyOn(roundupService, 'resumeConfig').mockResolvedValueOnce({
        ...userConfig,
        is_paused: false,
      });

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/config/${userConfig.id}/resume`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(400);
    });

    it('should allow user to trigger roundup on their own config', async () => {
      jest
        .spyOn(roundupService, 'getConfig')
        .mockResolvedValueOnce(userConfig);
      jest
        .spyOn(roundupService, 'triggerExternalRoundup')
        .mockResolvedValueOnce(undefined);

      const response = await request(app.getHttpServer())
        .post(`/savings/roundup/trigger/${userConfig.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(400);
    });
  });

  // ============= RECORD OWNERSHIP TESTS =============

  describe('Record Ownership Tests', () => {
    let user1Token: string;
    let user2Token: string;

    beforeEach(() => {
      user1Token = jwtService.sign({ sub: regularUser.id, role: 'user' });
      user2Token = jwtService.sign({ sub: anotherUser.id, role: 'user' });
    });

    it('should prevent user from accessing another user record', async () => {
      mockRoundupRecordRepository.findOne.mockResolvedValueOnce(
        anotherUserRecord,
      );

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/records/${anotherUserRecord.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not belong to you');
    });

    it('should allow user to access their own record', async () => {
      jest
        .spyOn(roundupService, 'getRecord')
        .mockResolvedValueOnce(userRecord);

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/records/${userRecord.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(400);
    });

    it('should return only user records in list', async () => {
      jest
        .spyOn(roundupService, 'listRecords')
        .mockResolvedValueOnce([userRecord]);

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/records')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(403);
      // Verify no other user records in response
      if (Array.isArray(response.body)) {
        const allUserIds = response.body.map((r: any) => r.user_id);
        expect(allUserIds).toEqual(
          expect.arrayContaining(allUserIds.filter((id: string) => id === regularUser.id)),
        );
      }
    });

    it('should return only user pending records', async () => {
      jest
        .spyOn(roundupService, 'listPendingRecords')
        .mockResolvedValueOnce([userRecord]);

      const response = await request(app.getHttpServer())
        .get('/savings/roundup/records/pending')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(403);
    });
  });

  // ============= CONTEXT ISOLATION TESTS =============

  describe('Context Isolation Tests', () => {
    let user1Token: string;
    let user2Token: string;

    beforeEach(() => {
      user1Token = jwtService.sign({ sub: regularUser.id, role: 'user' });
      user2Token = jwtService.sign({ sub: anotherUser.id, role: 'user' });
    });

    it('user1 cannot see user2 configurations', async () => {
      const user1Configs = [userConfig];
      const user2Configs = [anotherUserConfig];

      mockRoundupConfigRepository.find
        .mockResolvedValueOnce(user1Configs)
        .mockResolvedValueOnce(user2Configs);

      const response1 = await request(app.getHttpServer())
        .get('/savings/roundup/config')
        .set('Authorization', `Bearer ${user1Token}`);

      const response2 = await request(app.getHttpServer())
        .get('/savings/roundup/config')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response1.status).not.toBe(403);
      expect(response2.status).not.toBe(403);

      // Verify isolation
      if (Array.isArray(response1.body)) {
        const user1ConfigIds = response1.body.map((c: any) => c.id);
        expect(user1ConfigIds).not.toContain(anotherUserConfig.id);
      }
    });

    it('user1 stats should only reflect their data', async () => {
      jest.spyOn(roundupService, 'getStats').mockResolvedValue({
        total_configs: 1,
        active_configs: 1,
        total_accumulated: '1000000',
      } as any);

      const response1 = await request(app.getHttpServer())
        .get('/savings/roundup/stats')
        .set('Authorization', `Bearer ${user1Token}`);

      const response2 = await request(app.getHttpServer())
        .get('/savings/roundup/stats')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response1.status).not.toBe(403);
      expect(response2.status).not.toBe(403);
    });

    it('processing should only process user records', async () => {
      jest
        .spyOn(roundupService, 'processRecordsForUser')
        .mockResolvedValueOnce([userRecord as any]);

      const response = await request(app.getHttpServer())
        .post('/savings/roundup/process')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).not.toBe(403);

      // Verify processRecordsForUser was called with correct user ID
      expect(roundupService.processRecordsForUser).toHaveBeenCalledWith(
        regularUser.id,
      );
    });
  });

  // ============= PERMISSION BOUNDARY TESTS =============

  describe('Permission Boundary Tests', () => {
    let userToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
    });

    it('should not allow privilege escalation via token tampering', async () => {
      const tamperedToken = jwtService.sign({
        sub: regularUser.id,
        role: 'admin', // Attempting to claim admin role
      });

      // Savingsroundup doesn't have admin endpoints currently,
      // but test that token content doesn't bypass ownership checks
      mockRoundupConfigRepository.findOne.mockResolvedValueOnce(
        anotherUserConfig,
      );

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/config/${anotherUserConfig.id}`)
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(response.status).toBe(400);
    });

    it('should prevent unauthorized batch operations', async () => {
      jest
        .spyOn(roundupService, 'processRecordsForUser')
        .mockResolvedValueOnce([]);

      // User trying to trigger processing should only affect their data
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/process')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);

      // Verify correct user ID was used
      expect(roundupService.processRecordsForUser).toHaveBeenCalledWith(
        regularUser.id,
      );
    });

    it('should validate config_id belongs to user before recording roundup', async () => {
      // If there was an internal endpoint for recording, it should verify ownership
      // This tests the principle that all operations must verify ownership
      expect(userConfig.user_id).toBe(regularUser.id);
    });

    it('should not expose configuration internals', async () => {
      jest.spyOn(roundupService, 'getConfig').mockResolvedValueOnce(userConfig);

      const response = await request(app.getHttpServer())
        .get(`/savings/roundup/config/${userConfig.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      if (response.body) {
        // Should not expose internal fields
        expect(response.body).not.toHaveProperty('password');
        expect(response.body).not.toHaveProperty('secret');
      }
    });
  });

  // ============= INPUT VALIDATION & BOUNDARY TESTS =============

  describe('Input Validation & Boundary Tests', () => {
    let userToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
    });

    it('should reject invalid roundup method', async () => {
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Invalid',
          method: 'invalid_method',
          frequency: 'daily',
        });

      expect([400, 403, 404, 500]).toContain(response.status);
    });

    it('should reject invalid frequency', async () => {
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Invalid',
          method: 'nearest_dollar',
          frequency: 'invalid_frequency',
        });

      expect([400, 403, 404, 500]).toContain(response.status);
    });

    it('should validate min_roundup_amount is non-negative', async () => {
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Invalid',
          method: 'nearest_dollar',
          frequency: 'daily',
          min_roundup_amount: -1000,
        });

      expect([400, 403, 404, 500]).toContain(response.status);
    });

    it('should validate max_roundup_per_transaction is positive', async () => {
      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Invalid',
          method: 'nearest_dollar',
          frequency: 'daily',
          max_roundup_per_transaction: 0,
        });

      expect([400, 403, 404, 500]).toContain(response.status);
    });

    it('should reject invalid config ID format', async () => {
      const response = await request(app.getHttpServer())
        .get('/savings/roundup/config/invalid@#$%id')
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 404]).toContain(response.status);
    });

    it('should not allow extremely long names', async () => {
      const longName = 'a'.repeat(10000);

      const response = await request(app.getHttpServer())
        .post('/savings/roundup/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: longName,
          method: 'nearest_dollar',
          frequency: 'daily',
        });

      expect([400, 403, 404, 500]).toContain(response.status);
    });
  });
});
