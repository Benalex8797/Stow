import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RateLimitMiddleware } from './rate-limit.middleware';

describe('RateLimitMiddleware', () => {
  let middleware: RateLimitMiddleware;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'RATE_LIMIT_MIDDLEWARE_LIMIT') return 5;
      if (key === 'RATE_LIMIT_MIDDLEWARE_WINDOW_MS') return 10_000;
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitMiddleware,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    middleware = module.get<RateLimitMiddleware>(RateLimitMiddleware);
    configService = module.get<ConfigService>(ConfigService);
    middleware.clear(); // Clear any existing entries
  });

  afterEach(() => {
    middleware.clear();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  describe('use', () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let nextFunction: jest.Mock;

    beforeEach(() => {
      mockRequest = {
        ip: '192.168.1.1',
        headers: {},
        socket: {} as any,
      };
      
      mockResponse = {
        setHeader: jest.fn(),
      };
      
      nextFunction = jest.fn();
    });

    it('should allow requests under the limit', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
    });

    it('should track requests per IP', () => {
      for (let i = 0; i < 5; i++) {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }

      expect(nextFunction).toHaveBeenCalledTimes(5);
    });

    it('should throw 429 when limit is exceeded', () => {
      for (let i = 0; i < 5; i++) {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }

      expect(() => {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }).toThrow(HttpException);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        '0',
      );
    });

    it('should set Retry-After header when rate limited', () => {
      for (let i = 0; i < 5; i++) {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }

      try {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
        expect(mockResponse.setHeader).toHaveBeenCalledWith(
          'Retry-After',
          expect.any(String),
        );
      }
    });

    it('should handle X-Forwarded-For header', () => {
      mockRequest.headers = {
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      expect(nextFunction).toHaveBeenCalled();
      
      // Make more requests with same IP
      for (let i = 0; i < 4; i++) {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }

      // Should be rate limited now
      expect(() => {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          nextFunction,
        );
      }).toThrow(HttpException);
    });

    it('should track different IPs separately', () => {
      const request1 = { ...mockRequest, ip: '192.168.1.1' };
      const request2 = { ...mockRequest, ip: '192.168.1.2' };

      for (let i = 0; i < 5; i++) {
        middleware.use(
          request1 as Request,
          mockResponse as Response,
          nextFunction,
        );
      }

      // Request from different IP should still work
      middleware.use(
        request2 as Request,
        mockResponse as Response,
        nextFunction,
      );

      expect(nextFunction).toHaveBeenCalledTimes(6);
    });
  });

  describe('getStats', () => {
    it('should return rate limit statistics', () => {
      const mockRequest: Partial<Request> = {
        ip: '192.168.1.1',
        headers: {},
        socket: {} as any,
      };
      const mockResponse: Partial<Response> = {
        setHeader: jest.fn(),
      };
      const nextFunction = jest.fn();

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      const stats = middleware.getStats();
      expect(stats.totalTracked).toBeGreaterThan(0);
      expect(stats.activeEntries).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear all rate limit entries', () => {
      const mockRequest: Partial<Request> = {
        ip: '192.168.1.1',
        headers: {},
        socket: {} as any,
      };
      const mockResponse: Partial<Response> = {
        setHeader: jest.fn(),
      };
      const nextFunction = jest.fn();

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      let stats = middleware.getStats();
      expect(stats.totalTracked).toBeGreaterThan(0);

      middleware.clear();
      stats = middleware.getStats();
      expect(stats.totalTracked).toBe(0);
    });
  });
});
