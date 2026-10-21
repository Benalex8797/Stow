import { Injectable, Logger } from '@nestjs/common';
import { RoundupMethod } from '../entities/roundup-config.entity';

/**
 * Calculates round-up amounts based on transaction values and methods.
 */
@Injectable()
export class RoundupCalculatorService {
  private readonly logger = new Logger(RoundupCalculatorService.name);

  /**
   * Calculates the round-up amount for a transaction.
   */
  calculateRoundup(
    amount: bigint,
    method: RoundupMethod,
    methodParameter?: string | number,
    maxRoundupPerTransaction?: bigint,
  ): bigint {
    let roundup: bigint;

    switch (method) {
      case RoundupMethod.NEAREST_DOLLAR:
        roundup = this.roundNearestDollar(amount);
        break;

      case RoundupMethod.NEAREST_CENT:
        roundup = this.roundNearestCent(amount);
        break;

      case RoundupMethod.NEAREST_QUARTER:
        roundup = this.roundNearestQuarter(amount);
        break;

      case RoundupMethod.PERCENTAGE:
        roundup = this.roundPercentage(
          amount,
          Number(methodParameter) || 1
        );
        break;

      case RoundupMethod.FIXED_AMOUNT:
        roundup = BigInt(methodParameter || 0);
        break;

      default:
        roundup = 0n;
    }

    // Apply maximum cap
    if (maxRoundupPerTransaction && roundup > maxRoundupPerTransaction) {
      roundup = maxRoundupPerTransaction;
    }

    // Ensure non-negative
    return roundup < 0n ? 0n : roundup;
  }

  /**
   * Rounds to nearest dollar (stroops: 10,000,000 = $1).
   * $12.34 → $13.00 = roundup $0.66
   */
  private roundNearestDollar(amount: bigint): bigint {
    const STROOP_PER_DOLLAR = 10_000_000n;
    const remainder = amount % STROOP_PER_DOLLAR;

    if (remainder === 0n) {
      return 0n; // Already at dollar boundary
    }

    return STROOP_PER_DOLLAR - remainder;
  }

  /**
   * Rounds to nearest cent (stroops: 100,000 = $0.01).
   * $12.34 → $12.35 = roundup $0.01
   */
  private roundNearestCent(amount: bigint): bigint {
    const STROOP_PER_CENT = 100_000n;
    const remainder = amount % STROOP_PER_CENT;

    if (remainder === 0n) {
      return 0n; // Already at cent boundary
    }

    return STROOP_PER_CENT - remainder;
  }

  /**
   * Rounds to nearest quarter ($0.25 = 2,500,000 stroops).
   * $12.34 → $12.50 = roundup $0.16
   */
  private roundNearestQuarter(amount: bigint): bigint {
    const STROOP_PER_QUARTER = 2_500_000n;
    const remainder = amount % STROOP_PER_QUARTER;

    if (remainder === 0n) {
      return 0n; // Already at quarter boundary
    }

    return STROOP_PER_QUARTER - remainder;
  }

  /**
   * Rounds by percentage of transaction amount.
   * Example: 1% of $100 = $1.00 roundup
   */
  private roundPercentage(amount: bigint, percentage: number): bigint {
    if (percentage <= 0 || percentage >= 100) {
      return 0n;
    }

    // Calculate percentage as decimal
    const percentageDecimal = percentage / 100;
    const roundup = BigInt(Math.floor(Number(amount) * percentageDecimal));

    return roundup;
  }

  /**
   * Gets the rounded-up amount (original amount + roundup).
   */
  getRoundedAmount(
    original: bigint,
    method: RoundupMethod,
    methodParameter?: string | number,
    maxRoundupPerTransaction?: bigint,
  ): bigint {
    const roundup = this.calculateRoundup(
      original,
      method,
      methodParameter,
      maxRoundupPerTransaction,
    );
    return original + roundup;
  }

  /**
   * Converts stroops to USD for display.
   * Stroops: 1 XLM = 10,000,000 stroops
   * For USD, assumes fixed rate or pricing.
   */
  stroopsToUsd(stroops: bigint, rate: number = 0.1): number {
    return Number(stroops) * (rate / 10_000_000);
  }

  /**
   * Converts USD to stroops.
   */
  usdToStroops(usd: number, rate: number = 0.1): bigint {
    return BigInt(Math.floor((usd / rate) * 10_000_000));
  }
}
