import { Injectable, Logger } from '@nestjs/common';
import { InterestRateConfig } from '../entities/interest-rate-config.entity';

/**
 * Core interest rate calculation engine.
 * Implements utilization-based rate curves with smoothing.
 */
@Injectable()
export class RateCalculatorService {
  private readonly logger = new Logger(RateCalculatorService.name);

  /**
   * Calculates interest rate based on utilization and config.
   *
   * Algorithm:
   * 1. If utilization <= optimal: linear slope from base_rate
   * 2. If utilization > optimal: steeper slope towards max_rate
   * 3. Apply smoothing to dampen volatility
   * 4. Clamp result between min_rate and max_rate
   */
  calculateRate(
    utilization: number,
    config: InterestRateConfig,
    previousRate?: string,
  ): string {
    // Validate inputs
    if (utilization < 0 || utilization > 1) {
      this.logger.warn(
        `Utilization out of bounds: ${utilization}, clamping to [0, 1]`,
      );
      utilization = Math.max(0, Math.min(1, utilization));
    }

    const baseRate = Number(config.base_rate);
    const minRate = Number(config.min_rate);
    const maxRate = Number(config.max_rate);
    const optimalUtil = Number(config.optimal_utilization);
    const slopeUp = Number(config.slope_up);
    const slopeDown = Number(config.slope_down);
    const smoothingFactor = Number(config.smoothing_factor);

    // Calculate raw rate based on utilization curve
    let calculatedRate: number;

    if (utilization <= optimalUtil) {
      // Below optimal: linear increase from base_rate
      const utilizationRatio = utilization / optimalUtil;
      const rateIncrease = slopeUp * utilizationRatio * 100; // slope_up is APY increase per 1% util
      calculatedRate = baseRate + rateIncrease;
    } else {
      // Above optimal: steeper increase towards max_rate
      const excessUtilization = utilization - optimalUtil;
      const excessRange = 1 - optimalUtil;
      const excessRatio = excessUtilization / excessRange;
      
      // Rate at optimal point
      const rateAtOptimal = baseRate + slopeUp * 100;
      
      // Additional increase from optimal to max
      const additionalIncrease = slopeDown * excessRatio * 100;
      calculatedRate = rateAtOptimal + additionalIncrease;
    }

    // Apply min/max bounds
    calculatedRate = Math.max(minRate, Math.min(maxRate, calculatedRate));

    // Apply exponential smoothing to dampen volatility
    if (previousRate !== undefined && previousRate !== null) {
      const prevRateNum = Number(previousRate);
      calculatedRate =
        smoothingFactor * calculatedRate + (1 - smoothingFactor) * prevRateNum;
    }

    // Final clamp after smoothing
    calculatedRate = Math.max(minRate, Math.min(maxRate, calculatedRate));

    // Round to 4 decimal places
    return calculatedRate.toFixed(4);
  }

  /**
   * Projects rate for different utilization scenarios.
   * Useful for UI display or simulations.
   */
  projectRate(
    utilization: number,
    config: InterestRateConfig,
  ): string {
    return this.calculateRate(utilization, config);
  }

  /**
   * Calculates the utilization ratio from liquidity amounts.
   */
  calculateUtilization(
    totalLiquidity: bigint,
    borrowedAmount: bigint,
  ): number {
    if (totalLiquidity === 0n) {
      return 0;
    }

    const utilization = Number(borrowedAmount) / Number(totalLiquidity);
    return Math.max(0, Math.min(1, utilization));
  }

  /**
   * Calculates APY to APR conversion.
   * Formula: APR = (1 + APY)^(1/365) - 1
   */
  apyToApr(apy: number): number {
    const aprDecimal = Math.pow(1 + apy / 100, 1 / 365) - 1;
    return aprDecimal * 100;
  }

  /**
   * Calculates APR to APY conversion.
   * Formula: APY = (1 + APR)^365 - 1
   */
  aprToApy(apr: number): number {
    const apyDecimal = Math.pow(1 + apr / 100, 365) - 1;
    return apyDecimal * 100;
  }

  /**
   * Calculates earned interest over a period.
   * Principal * APY * (days / 365)
   */
  calculateInterestEarned(
    principal: bigint,
    apy: number,
    daysElapsed: number,
  ): bigint {
    const principalNum = Number(principal);
    const dailyRate = (apy / 100) * (daysElapsed / 365);
    const earned = principalNum * dailyRate;
    return BigInt(Math.round(earned));
  }

  /**
   * Calculates utilization from total liquidity and current positions.
   */
  calculateUtilizationFromPositions(
    totalDeposits: bigint,
    totalBorrows: bigint,
    reserveRatio: number = 0.1, // 10% reserve requirement
  ): number {
    // Available for lending = total deposits - (total deposits * reserve)
    const reserveAmount = totalDeposits * BigInt(Math.round(reserveRatio * 100)) / 100n;
    const availableForLending = totalDeposits - reserveAmount;

    if (availableForLending === 0n) {
      return 0;
    }

    const utilization =
      Number(totalBorrows) / Number(availableForLending);
    return Math.max(0, Math.min(1, utilization));
  }
}
