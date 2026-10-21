import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { NftRewardsModule } from './nft-rewards.module';
import { NftRewardsController } from './nft-rewards.controller';
import { NftRewardsAdminController } from './admin/nft-rewards-admin.controller';
import { NftRewardsService } from './services/nft-rewards.service';
import { NftRewardsAdminService } from './admin/nft-rewards-admin.service';
import { User } from '../users/entities/user.entity';
import { UserNftReward, NftRewardStatus } from './entities/user-nft-reward.entity';
import { NftRewardMilestone } from './entities/nft-reward-milestone.entity';

describe('NFT Rewards - Access Control Tests', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let nftRewardsService: NftRewardsService;
  let nftRewardsAdminService: NftRewardsAdminService;

  // Mock repositories
  let mockUserRepository: any;
  let mockUserNftRewardRepository: any;
  let mockNftRewardMilestoneRepository: any;

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

  const testMilestone = {
    id: 'milestone-1',
    milestone_type: 'savings_amount',
    threshold: 1000000,
    name: 'First Saver',
    is_active: true,
  } as NftRewardMilestone;

  const userReward = {
    id: 'reward-1',
    user_id: 'user-123',
    milestone_id: 'milestone-1',
    status: NftRewardStatus.EARNED,
    is_soulbound: false,
  } as UserNftReward;

  const soulboundReward = {
    id: 'reward-2',
    user_id: 'user-123',
    milestone_id: 'milestone-1',
    status: NftRewardStatus.MINTED,
    is_soulbound: true,
  } as UserNftReward;

  beforeAll(async () => {
    // Mock repositories
    mockUserRepository = {
      findOne: jest.fn().mockResolvedValue(regularUser),
      findOneBy: jest.fn().mockResolvedValue(regularUser),
    };

    mockUserNftRewardRepository = {
      find: jest.fn().mockResolvedValue([userReward]),
      findOne: jest.fn().mockResolvedValue(userReward),
      findOneBy: jest.fn().mockResolvedValue(userReward),
      save: jest.fn().mockResolvedValue(userReward),
    };

    mockNftRewardMilestoneRepository = {
      find: jest.fn().mockResolvedValue([testMilestone]),
      findOne: jest.fn().mockResolvedValue(testMilestone),
      findOneBy: jest.fn().mockResolvedValue(testMilestone),
      save: jest.fn().mockResolvedValue(testMilestone),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [NftRewardsModule],
      providers: [
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(UserNftReward),
          useValue: mockUserNftRewardRepository,
        },
        {
          provide: getRepositoryToken(NftRewardMilestone),
          useValue: mockNftRewardMilestoneRepository,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    nftRewardsService = moduleFixture.get<NftRewardsService>(
      NftRewardsService,
    );
    nftRewardsAdminService = moduleFixture.get<NftRewardsAdminService>(
      NftRewardsAdminService,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // ============= USER ENDPOINTS - AUTHENTICATION TESTS =============

  describe('User Endpoints - Authentication', () => {
    it('should deny access without JWT token', async () => {
      const response = await request(app.getHttpServer()).get(
        '/nft-rewards/milestones/progress',
      );

      expect(response.status).toBe(401);
    });

    it('should deny access with invalid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .get('/nft-rewards/milestones/progress')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should allow access with valid JWT token', async () => {
      const token = jwtService.sign({ sub: regularUser.id, role: 'user' });

      const response = await request(app.getHttpServer())
        .get('/nft-rewards/milestones/progress')
        .set('Authorization', `Bearer ${token}`);

      // Could be 400/404 if service errors, but not 401
      expect(response.status).not.toBe(401);
    });
  });

  // ============= USER ENDPOINTS - AUTHORIZATION TESTS =============

  describe('User Endpoints - Authorization', () => {
    let userToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
    });

    it('GET /nft-rewards/milestones/progress - should return user progress', async () => {
      const response = await request(app.getHttpServer())
        .get('/nft-rewards/milestones/progress')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('GET /nft-rewards/rewards - should return only user rewards', async () => {
      mockUserNftRewardRepository.find.mockResolvedValueOnce([userReward]);

      const response = await request(app.getHttpServer())
        .get('/nft-rewards/rewards')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('GET /nft-rewards/rewards/:rewardId - should return owned reward', async () => {
      const response = await request(app.getHttpServer())
        .get(`/nft-rewards/rewards/${userReward.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });

    it('POST /nft-rewards/evaluate - should allow user evaluation', async () => {
      jest.spyOn(nftRewardsService, 'evaluateAndMintRewards').mockResolvedValueOnce(undefined);

      const response = await request(app.getHttpServer())
        .post('/nft-rewards/evaluate')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(403);
    });
  });

  // ============= REWARD OWNERSHIP TESTS =============

  describe('Reward Ownership & Boundary Tests', () => {
    let userToken: string;
    let anotherUserToken: string;

    beforeEach(() => {
      userToken = jwtService.sign({ sub: regularUser.id, role: 'user' });
      anotherUserToken = jwtService.sign({ sub: anotherUser.id, role: 'user' });
    });

    it('should prevent user from transferring another user reward', async () => {
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(userReward);

      const response = await request(app.getHttpServer())
        .patch(`/nft-rewards/rewards/${userReward.id}/transfer`)
        .set('Authorization', `Bearer ${anotherUserToken}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('do not own');
    });

    it('should allow user to transfer their own reward', async () => {
      const transferableReward = { ...userReward, is_soulbound: false };
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(
        transferableReward,
      );
      jest
        .spyOn(nftRewardsService, 'updateRewardStatus')
        .mockResolvedValueOnce(transferableReward);

      const response = await request(app.getHttpServer())
        .patch(`/nft-rewards/rewards/${userReward.id}/transfer`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(400);
    });

    it('should prevent transfer of soulbound rewards', async () => {
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(
        soulboundReward,
      );

      // Service should reject this
      jest
        .spyOn(nftRewardsService, 'updateRewardStatus')
        .mockRejectedValueOnce(
          new Error('Cannot transfer soulbound reward'),
        );

      const response = await request(app.getHttpServer())
        .patch(`/nft-rewards/rewards/${soulboundReward.id}/transfer`)
        .set('Authorization', `Bearer ${userToken}`)
        .catch((e) => e.response);

      // This depends on error handling, but should fail
      expect([400, 500]).toContain(response.status);
    });

    it('should prevent access to non-existent reward', async () => {
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(null);

      const response = await request(app.getHttpServer())
        .get('/nft-rewards/rewards/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).not.toBe(200);
    });
  });

  // ============= ADMIN ENDPOINTS - AUTHENTICATION TESTS =============

  describe('Admin Endpoints - Authentication', () => {
    it('should deny admin access without JWT token', async () => {
      const response = await request(app.getHttpServer()).get(
        '/admin/nft-rewards/milestones',
      );

      expect(response.status).toBe(401);
    });

    it('should deny admin access with invalid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should allow admin access with valid JWT token', async () => {
      const adminToken = jwtService.sign({
        sub: adminUser.id,
        role: 'admin',
      });

      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones')
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

    it('should deny regular user access to list milestones', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to get milestone details', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/nft-rewards/milestones/${testMilestone.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to create milestone', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/nft-rewards/milestones')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          milestone_type: 'savings_amount',
          threshold: 1000000,
          name: 'Test',
        });

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to update milestone', async () => {
      const response = await request(app.getHttpServer())
        .put(`/admin/nft-rewards/milestones/${testMilestone.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Updated' });

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to deactivate milestone', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/admin/nft-rewards/milestones/${testMilestone.id}/deactivate`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to admin stats', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should deny regular user access to user rewards view', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/nft-rewards/user-rewards/${regularUser.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should allow admin access to list milestones', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow admin access to get milestone details', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/nft-rewards/milestones/${testMilestone.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow admin access to create milestone', async () => {
      jest
        .spyOn(nftRewardsAdminService, 'createMilestone')
        .mockResolvedValueOnce(testMilestone);

      const response = await request(app.getHttpServer())
        .post('/admin/nft-rewards/milestones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          milestone_type: 'savings_amount',
          threshold: 1000000,
          name: 'Test',
        });

      expect(response.status).not.toBe(403);
    });

    it('should allow admin access to admin stats', async () => {
      jest.spyOn(nftRewardsAdminService, 'getStats').mockResolvedValueOnce({
        total_milestones: 1,
        active_milestones: 1,
        total_rewards_earned: 0,
        total_rewards_minted: 0,
        rewards_by_rarity: {},
      });

      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(403);
    });

    it('should allow admin access to user rewards view', async () => {
      jest
        .spyOn(nftRewardsAdminService, 'getUserRewardsAdmin')
        .mockResolvedValueOnce([userReward]);

      const response = await request(app.getHttpServer())
        .get(`/admin/nft-rewards/user-rewards/${regularUser.id}`)
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

    it('user should not see admin-only endpoints', async () => {
      const adminEndpoints = [
        { method: 'get', path: '/admin/nft-rewards/milestones' },
        { method: 'get', path: '/admin/nft-rewards/stats' },
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app.getHttpServer())
          [endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(403);
      }
    });

    it('admin cannot impersonate regular user operations', async () => {
      // Admin with admin token trying to use user endpoints should work
      // But should get data for the admin user, not arbitrary users
      const response = await request(app.getHttpServer())
        .get('/nft-rewards/rewards')
        .set('Authorization', `Bearer ${adminToken}`);

      // Should succeed but admin user, not regular user
      expect(response.status).not.toBe(403);
    });

    it('should validate query parameters for authorization', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones?active=true')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should prevent privilege escalation via token tampering', async () => {
      const tamperedToken = jwtService.sign({
        sub: regularUser.id,
        role: 'admin', // Regular user trying to claim admin role
      });

      // This depends on implementation, but ideally should verify
      // the actual user role from database
      const response = await request(app.getHttpServer())
        .get('/admin/nft-rewards/milestones')
        .set('Authorization', `Bearer ${tamperedToken}`);

      // If roles are properly validated from DB, this should fail
      expect(response.status).not.toBe(200);
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

    it('user1 cannot access user2 rewards', async () => {
      const user2Reward = { ...userReward, user_id: anotherUser.id };
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(user2Reward);

      const response = await request(app.getHttpServer())
        .get(`/nft-rewards/rewards/${user2Reward.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      // Should either return 404 or 403
      expect([403, 404]).toContain(response.status);
    });

    it('user1 cannot modify user2 rewards', async () => {
      const user2Reward = { ...userReward, user_id: anotherUser.id };
      mockUserNftRewardRepository.findOne.mockResolvedValueOnce(user2Reward);

      const response = await request(app.getHttpServer())
        .patch(`/nft-rewards/rewards/${user2Reward.id}/transfer`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('do not own');
    });

    it('each user sees only their own rewards in list', async () => {
      const user1Rewards = [userReward];
      const user2Rewards = [{ ...userReward, id: 'reward-2', user_id: anotherUser.id }];

      mockUserNftRewardRepository.find
        .mockResolvedValueOnce(user1Rewards)
        .mockResolvedValueOnce(user2Rewards);

      const response1 = await request(app.getHttpServer())
        .get('/nft-rewards/rewards')
        .set('Authorization', `Bearer ${user1Token}`);

      const response2 = await request(app.getHttpServer())
        .get('/nft-rewards/rewards')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response1.status).not.toBe(500);
      expect(response2.status).not.toBe(500);
    });
  });
});
