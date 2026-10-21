import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from '../../savings/entities/balance.entity';
import { Goal, GoalStatus } from '../../goals/entities/goal.entity';
import {
  ContractEvent,
  ContractEventStatus,
} from '../../indexer/entities/contract-event.entity';
import { MilestoneType } from '../entities/nft-reward-milestone.entity';

/**
 * Evaluates user progress toward each milestone type by querying
 * savings balance, goals, and activity data.
 */
@Injectable()
export class MilestoneEvaluatorService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(ContractEvent)
    private readonly contractEventRepository: Repository<ContractEvent>,
  ) {}

  /**
   * Gets the current progress for a user on a specific milestone type.
   */
  async getProgress(
    stellarAddress: string,
    milestoneType: MilestoneType,
  ): Promise<number> {
    switch (milestoneType) {
      case MilestoneType.SAVINGS_AMOUNT:
        return this.getSavingsAmount(stellarAddress);

      case MilestoneType.GOALS_REACHED:
        return this.getGoalsReached(stellarAddress);

      case MilestoneType.CONSECUTIVE_DEPOSITS:
        return this.getConsecutiveDeposits(stellarAddress);

      case MilestoneType.ACTIVITY_STREAK:
        return this.getActivityStreak(stellarAddress);

      default:
        return 0;
    }
  }

  private async getSavingsAmount(stellarAddress: string): Promise<number> {
    const balance = await this.balanceRepository.findOne({
      where: { account: stellarAddress },
    });
    if (!balance) return 0;
    // Return amount in stroops as a number
    return parseInt(balance.amount, 10);
  }

  private async getGoalsReached(stellarAddress: string): Promise<number> {
    const result = await this.goalRepository.count({
      where: {
        owner: stellarAddress,
        status: GoalStatus.REACHED,
      },
    });
    return result;
  }

  private async getConsecutiveDeposits(
    stellarAddress: string,
  ): Promise<number> {
    // Get all deposit events for this user, ordered by ledger
    const deposits = await this.contractEventRepository.find({
      where: {
        event_type: 'deposit',
        status: ContractEventStatus.PROCESSED,
      },
      order: { ledger: 'DESC', log_index: 'DESC' },
      take: 100, // Reasonable limit
    });

    let consecutive = 0;
    let lastDate: Date | null = null;

    for (const deposit of deposits) {
      const data = deposit.data ?? {};
      if (data.account !== stellarAddress) continue;

      const depositDate = deposit.created_at;

      // Check if deposits are consecutive (within same day or next day)
      if (lastDate === null) {
        consecutive = 1;
      } else {
        const daysDiff = Math.floor(
          (lastDate.getTime() - depositDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysDiff <= 1) {
          consecutive++;
        } else {
          break; // Streak broken
        }
      }

      lastDate = depositDate;
    }

    return consecutive;
  }

  private async getActivityStreak(stellarAddress: string): Promise<number> {
    // Count unique days with any activity (deposit or withdrawal)
    const events = await this.contractEventRepository
      .createQueryBuilder('event')
      .where('event.event_type IN (:...types)', {
        types: ['deposit', 'withdraw'],
      })
      .andWhere('event.status = :status', {
        status: ContractEventStatus.PROCESSED,
      })
      .andWhere(
        "COALESCE(event.data->>'account', event.data->>'user') = :address",
        { address: stellarAddress },
      )
      .orderBy('event.created_at', 'DESC')
      .take(365) // Look back up to a year
      .getMany();

    if (events.length === 0) return 0;

    // Group by day and count consecutive days
    const daySet = new Set<string>();
    for (const event of events) {
      const dateStr = new Date(event.created_at).toISOString().split('T')[0];
      daySet.add(dateStr);
    }

    const sortedDays = Array.from(daySet).sort().reverse();
    let consecutive = 0;
    let expectedDate = new Date();

    for (const dayStr of sortedDays) {
      const day = new Date(dayStr);
      const daysDiff = Math.floor(
        (expectedDate.getTime() - day.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysDiff === 0 || (consecutive === 0 && daysDiff >= 0)) {
        consecutive++;
        expectedDate = new Date(day.getTime() - 24 * 60 * 60 * 1000);
      } else if (daysDiff > 0) {
        break;
      }
    }

    return consecutive;
  }
}
