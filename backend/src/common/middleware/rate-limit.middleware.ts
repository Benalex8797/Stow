import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limiting middleware that tracks requests per IP address.
 * Complements the TieredThrottlerGuard by providing middleware-level rate limiting.
 * 
 * This middleware provides:
 * - IP-based rate limiting for all requests
 * - Configurable limits per time window
 * - Rate limit headers in responses
 * - Automatic cleanup of expired entries
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private rateLimitStore = new Map<string, RateLimitEntry>();
  private readonly defaultLimit: number;
  private readonly defaultWindow: number; // in milliseconds

  constructor(private readonly configService: ConfigService) {
    this.defaultLimit = this.configService.get<number>('RATE_LIMIT_MIDDLEWARE_LIMIT') ?? 1000;
    this.defaultWindow = this.configService.get<number>('RATE_LIMIT_MIDDLEWARE_WINDOW_MS') ?? 60_000;
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60_000);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const identifier = this.getIdentifier(req);
    const now = Date.now();
    
    let entry = this.rateLimitStore.get(identifier);
    
    // Initialize or reset if window expired
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.defaultWindow,
      };
      this.rateLimitStore.set(identifier, entry);
    }
    
    // Increment request count
    entry.count++;
    
    // Set rate limit headers
    const remaining = Math.max(0, this.defaultLimit - entry.count);
    const resetTimeSeconds = Math.ceil(entry.resetTime / 1000);
    
    res.setHeader('X-RateLimit-Limit', this.defaultLimit.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetTimeSeconds.toString());
    
    // Check if limit exceeded
    if (entry.count > this.defaultLimit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests from this IP, please try again later',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    
    next();
  }

  /**
   * Get a unique identifier for the request (IP address)
   */
  private getIdentifier(req: Request): string {
    // Try to get real IP from proxy headers
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  /**
   * Clean up expired entries from the store
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        this.rateLimitStore.delete(key);
      }
    }
  }

  /**
   * Get current rate limit statistics (useful for monitoring)
   */
  getStats(): { totalTracked: number; activeEntries: number } {
    const now = Date.now();
    let activeEntries = 0;
    
    for (const entry of this.rateLimitStore.values()) {
      if (now <= entry.resetTime) {
        activeEntries++;
      }
    }
    
    return {
      totalTracked: this.rateLimitStore.size,
      activeEntries,
    };
  }

  /**
   * Clear all rate limit entries (useful for testing)
   */
  clear(): void {
    this.rateLimitStore.clear();
  }
}
