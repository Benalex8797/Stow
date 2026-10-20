import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { ReferralStatus, UserReferral } from './entities/user-referral.entity';
import {
  ReferralReward,
  RewardStatus,
  RewardType,
} from './entities/referral-reward.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const DEFAULT_REWARD_AMOUNT = '1000000'; // 1 XLM in stroops
const DEFAULT_ASSET_CODE = 'XLM';

export interface ReferralStats {
  total: number;
  pending: number;
  qualified: number;
  total_rewards_issued: number;
  referral_code: string;
}

export interface AdminReferralOverview {
  total_referrals: number;
  pending: number;
  qualified: number;
  total_rewards_pending: number;
  total_rewards_issued: number;
  computed_at: string;
}

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserReferral)
    private readonly referralsRepo: Repository<UserReferral>,
    @InjectRepository(ReferralReward)
    private readonly rewardsRepo: Repository<ReferralReward>,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Attribution — claim a referral relationship
  // ---------------------------------------------------------------------------

  /**
   * Records that `userId` was referred by the owner of `referralCode`.
   * A user's referral code is their own user ID. Idempotent-safe: throws
   * 409 if the user already has a referral, 400 for self-referral.
   */
  async claimReferral(
    userId: string,
    referralCode: string,
  ): Promise<UserReferral> {
    if (referralCode === userId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const referrer = await this.usersRepo.findOneBy({ id: referralCode });
    if (!referrer) {
      throw new NotFoundException('Referral code is invalid');
    }

    const existing = await this.referralsRepo.findOne({
      where: { referred_id: userId },
    });
    if (existing) {
      throw new ConflictException(
        'A referral has already been recorded for this account',
      );
    }

    const referral = await this.referralsRepo.save(
      this.referralsRepo.create({ referrer_id: referralCode, referred_id: userId }),
    );

    this.logger.log(`Referral claimed: ${userId} attributed to ${referralCode}`);
    return referral;
  }

  // ---------------------------------------------------------------------------
  // Qualifying action — advances PENDING → QUALIFIED and issues rewards
  // ---------------------------------------------------------------------------

  /**
   * Called when a referred user completes their first qualifying action
   * (e.g. first deposit). Idempotent: no-op if the user isn't a pending
   * referral. When it qualifies, reward rows are created for both parties.
   */
  async recordQualifyingAction(userId: string): Promise<void> {
    const referral = await this.referralsRepo.findOne({
      where: { referred_id: userId, status: ReferralStatus.PENDING },
    });

    if (!referral) return;

    referral.status = ReferralStatus.QUALIFIED;
    referral.qualified_at = new Date();
    await this.referralsRepo.save(referral);

    await this.issueRewards(referral);

    this.logger.log(
      `Referral ${referral.id} qualified — rewards issued for referrer ${referral.referrer_id} and referee ${userId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getMyReferrals(userId: string): Promise<ReferralStats & { referrals: UserReferral[] }> {
    const referrals = await this.referralsRepo.find({
      where: { referrer_id: userId },
      relations: ['referred'],
      order: { created_at: 'DESC' },
    });

    let pending = 0;
    let qualified = 0;
    for (const r of referrals) {
      r.status === ReferralStatus.QUALIFIED ? qualified++ : pending++;
    }

    const rewardsIssued = await this.rewardsRepo.count({
      where: { recipient_id: userId, status: RewardStatus.ISSUED },
    });

    return {
      referral_code: userId,
      total: referrals.length,
      pending,
      qualified,
      total_rewards_issued: rewardsIssued,
      referrals,
    };
  }

  async getMyRewards(userId: string, query: PaginationQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.rewardsRepo
      .createQueryBuilder('rw')
      .where('rw.recipient_id = :userId', { userId })
      .orderBy('rw.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Admin: paginated list of all referrals with optional status filter. */
  async listReferrals(query: PaginationQueryDto & { status?: ReferralStatus }) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const qb = this.referralsRepo
      .createQueryBuilder('ref')
      .leftJoinAndSelect('ref.referrer', 'referrer')
      .leftJoinAndSelect('ref.referred', 'referred')
      .orderBy('ref.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    if (status) qb.where('ref.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Admin: platform-wide referral overview metrics. */
  async getAdminOverview(): Promise<AdminReferralOverview> {
    const [total, pending, qualified] = await Promise.all([
      this.referralsRepo.count(),
      this.referralsRepo.count({ where: { status: ReferralStatus.PENDING } }),
      this.referralsRepo.count({ where: { status: ReferralStatus.QUALIFIED } }),
    ]);

    const [rewardsPending, rewardsIssued] = await Promise.all([
      this.rewardsRepo.count({ where: { status: RewardStatus.PENDING } }),
      this.rewardsRepo.count({ where: { status: RewardStatus.ISSUED } }),
    ]);

    return {
      total_referrals: total,
      pending,
      qualified,
      total_rewards_pending: rewardsPending,
      total_rewards_issued: rewardsIssued,
      computed_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async issueRewards(referral: UserReferral): Promise<void> {
    const amount = this.config.get<string>('REFERRAL_REWARD_AMOUNT_STROOPS') ?? DEFAULT_REWARD_AMOUNT;
    const asset_code = this.config.get<string>('REFERRAL_REWARD_ASSET_CODE') ?? DEFAULT_ASSET_CODE;

    await this.rewardsRepo.save([
      this.rewardsRepo.create({
        referral_id: referral.id,
        recipient_id: referral.referrer_id,
        type: RewardType.REFERRER_BONUS,
        amount,
        asset_code,
        status: RewardStatus.PENDING,
      }),
      this.rewardsRepo.create({
        referral_id: referral.id,
        recipient_id: referral.referred_id,
        type: RewardType.REFEREE_BONUS,
        amount,
        asset_code,
        status: RewardStatus.PENDING,
      }),
    ]);
  }
}
