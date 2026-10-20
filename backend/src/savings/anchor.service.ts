import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import {
  AnchorDeposit,
  AnchorDepositStatus,
} from './entities/anchor-deposit.entity';
import { InitiateDepositDto } from './dto/initiate-deposit.dto';
import { ReferralService } from '../users/referral.service';

/** SEP-38 quote shape returned to callers */
export interface Sep38Quote {
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  buy_amount: string;
  price: string;
  expires_at: string;
}

/** TTL for quote cache: 30 seconds */
const QUOTE_CACHE_TTL_MS = 30_000;

const quoteCacheKey = (sellAsset: string, buyAsset: string, sellAmount: string) =>
  `savings:quote:${sellAsset}:${buyAsset}:${sellAmount}`;

export interface DepositInitiationResult {
  deposit_id: string;
  transaction_id: string;
  interactive_url: string;
}

/** Shape of the SEP-24 POST /transactions/deposit/interactive response */
interface Sep24DepositResponse {
  type: string;
  url: string;
  id: string;
}

@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);

  /** Base URL of the SEP-24 anchor platform (e.g. https://anchor.example.com) */
  private readonly anchorBaseUrl: string;

  constructor(
    @InjectRepository(AnchorDeposit)
    private readonly depositRepo: Repository<AnchorDeposit>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional() private readonly referralService: ReferralService,
  ) {
    this.anchorBaseUrl = this.configService.get<string>(
      'ANCHOR_BASE_URL',
      '',
    );
  }

  /**
   * Initiates a SEP-24 interactive deposit with the configured anchor.
   *
   * Steps:
   *  1. POST to the anchor's SEP-24 endpoint requesting an interactive session.
   *  2. Persist a pending AnchorDeposit record with the returned URL and
   *     transaction id.
   *  3. Return the interactive URL to the caller so the frontend can open it.
   */
  async initiateDeposit(
    userId: string,
    dto: InitiateDepositDto,
  ): Promise<DepositInitiationResult> {
    const sep24Url = `${this.anchorBaseUrl}/sep24/transactions/deposit/interactive`;

    let sep24Response: Sep24DepositResponse;
    try {
      const { data } = await axios.post<Sep24DepositResponse>(
        sep24Url,
        {
          asset_code: dto.asset_code,
          account: dto.account,
        },
        { timeout: 10_000 },
      );
      sep24Response = data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `SEP-24 deposit initiation failed for user ${userId}: ${message}`,
      );
      throw new BadGatewayException(
        'Anchor service unavailable. Please try again later.',
      );
    }

    const deposit = this.depositRepo.create({
      user_id: userId,
      stellar_account: dto.account,
      asset_code: dto.asset_code,
      transaction_id: sep24Response.id,
      interactive_url: sep24Response.url,
      status: 'pending' as AnchorDepositStatus,
    });

    await this.depositRepo.save(deposit);

    this.logger.log(
      `SEP-24 deposit initiated: deposit_id=${deposit.id} transaction_id=${sep24Response.id} user=${userId}`,
    );

    // On first deposit, qualify any pending referral for this user.
    if (this.referralService) {
      const depositCount = await this.depositRepo.count({ where: { user_id: userId } });
      if (depositCount === 1) {
        await this.referralService.recordQualifyingAction(userId).catch((err) =>
          this.logger.warn(`Referral qualification failed for user ${userId}: ${(err as Error).message}`),
        );
      }
    }

    return {
      deposit_id: deposit.id,
      transaction_id: sep24Response.id,
      interactive_url: sep24Response.url,
    };
  }

  /**
   * Fetches an indicative SEP-38 quote from the anchor.
   * Results are cached for QUOTE_CACHE_TTL_MS to reduce upstream calls.
   */
  async getQuote(
    sellAsset: string,
    buyAsset: string,
    sellAmount: string,
  ): Promise<Sep38Quote> {
    const key = quoteCacheKey(sellAsset, buyAsset, sellAmount);
    const cached = await this.cache.get<Sep38Quote>(key);
    if (cached) return cached;

    const sep38Url = `${this.anchorBaseUrl}/sep38/quote`;
    let quote: Sep38Quote;
    try {
      const { data } = await axios.get<Sep38Quote>(sep38Url, {
        params: { sell_asset: sellAsset, buy_asset: buyAsset, sell_amount: sellAmount },
        timeout: 10_000,
      });
      quote = data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`SEP-38 quote failed: ${message}`);
      throw new BadGatewayException('Anchor quote service unavailable.');
    }

    await this.cache.set(key, quote, QUOTE_CACHE_TTL_MS);
    return quote;
  }
}
