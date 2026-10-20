import { INestApplication } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminController } from '../admin.controller';
import { AdminService } from '../admin.service';
import { AuditLogService } from '../audit-log.service';
import { AdminAuditInterceptor } from './admin-audit.interceptor';

describe('AdminAuditInterceptor', () => {
  let app: INestApplication;

  const mockAuditLogService: Partial<AuditLogService> = {
    log: jest.fn().mockResolvedValue({
      id: 'audit-1',
      actor_id: 'admin-42',
      action: 'VIEW_SAVINGS_OVERVIEW',
      target_type: 'savings',
      target_id: 'overview',
      metadata: null,
      checksum: 'abc123',
      created_at: new Date('2026-09-25T12:00:00.000Z'),
    }),
  };

  const mockAdminService = {
    getSavingsOverview: jest.fn().mockResolvedValue({ total_deposits: 0 }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CacheModule.register()],
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        AdminAuditInterceptor,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { id: 'admin-42' };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists actor, action, target, and checksum for savings admin access', async () => {
    await request(app.getHttpServer())
      .get('/admin/savings/overview')
      .expect(200);

    expect(mockAuditLogService.log).toHaveBeenCalledWith({
      actor_id: 'admin-42',
      action: 'VIEW_SAVINGS_OVERVIEW',
      target_type: 'savings',
      target_id: 'overview',
      metadata: null,
    });
  });

  it('does not log when no authenticated user present', async () => {
    (mockAuditLogService.log as jest.Mock).mockClear();

    // Override guard to provide no user
    const moduleNoUser: TestingModule = await Test.createTestingModule({
      imports: [CacheModule.register()],
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        AdminAuditInterceptor,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true }) // no user injected
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const appNoUser = moduleNoUser.createNestApplication();
    await appNoUser.init();

    await request(appNoUser.getHttpServer())
      .get('/admin/savings/overview')
      .expect(200);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();

    await appNoUser.close();
  });
});
