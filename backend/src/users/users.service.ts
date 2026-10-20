import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPreferences } from './entities/user-preferences.entity';
import { UserFollow } from './entities/user-follow.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { AnchorDeposit } from '../savings/entities/anchor-deposit.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserPreferencesDto,
  UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import {
  PaginationDto,
  UserFollowResponseDto,
  FollowersListDto,
  FollowingListDto,
} from './dto/user-follow.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserPreferences)
    private readonly preferencesRepository: Repository<UserPreferences>,
    @InjectRepository(UserFollow)
    private readonly followRepository: Repository<UserFollow>,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(AnchorDeposit)
    private readonly anchorDepositsRepository: Repository<AnchorDeposit>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  async findByAddress(stellar_address: string): Promise<User> {
    const user = await this.usersRepository.findOneBy({ stellar_address });
    if (!user) {
      throw new NotFoundException(
        `User with address ${stellar_address} not found`,
      );
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(userId);

    if (dto.username !== undefined) {
      user.username = dto.username;
    }
    if (dto.avatar_url !== undefined) {
      user.avatar_url = dto.avatar_url;
    }

    return this.usersRepository.save(user);
  }

  async exportUserData(userId: string) {
    const user = await this.findById(userId);

    const [notifications, anchorDeposits] = await Promise.all([
      this.notificationsRepository.find({
        where: { user_address: user.stellar_address },
        order: { created_at: 'DESC' },
      }),
      this.anchorDepositsRepository.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
      }),
    ]);

    return {
      profile: {
        id: user.id,
        stellar_address: user.stellar_address,
        username: user.username,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
      },
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        created_at: n.created_at,
      })),
      savings: {
        anchor_deposits: anchorDeposits.map((d) => ({
          id: d.id,
          asset_code: d.asset_code,
          stellar_account: d.stellar_account,
          transaction_id: d.transaction_id,
          status: d.status,
          created_at: d.created_at,
          updated_at: d.updated_at,
        })),
      },
      exported_at: new Date().toISOString(),
    };
  }

  async getOrCreatePreferences(userId: string): Promise<UserPreferences> {
    let prefs = await this.preferencesRepository.findOne({
      where: { userId },
    });

    if (!prefs) {
      prefs = this.preferencesRepository.create({ userId });
      prefs = await this.preferencesRepository.save(prefs);
    }

    return prefs;
  }

  async updatePreferences(
    userId: string,
    dto: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    const prefs = await this.getOrCreatePreferences(userId);

    if (dto.email_notifications !== undefined) {
      prefs.email_notifications = dto.email_notifications;
    }
    if (dto.marketing_emails !== undefined) {
      prefs.marketing_emails = dto.marketing_emails;
    }
    if (dto.goal_created_notifications !== undefined) {
      prefs.goal_created_notifications = dto.goal_created_notifications;
    }
    if (dto.goal_contribution_notifications !== undefined) {
      prefs.goal_contribution_notifications =
        dto.goal_contribution_notifications;
    }
    if (dto.goal_reached_notifications !== undefined) {
      prefs.goal_reached_notifications = dto.goal_reached_notifications;
    }
    if (dto.deposit_notifications !== undefined) {
      prefs.deposit_notifications = dto.deposit_notifications;
    }
    if (dto.withdrawal_notifications !== undefined) {
      prefs.withdrawal_notifications = dto.withdrawal_notifications;
    }
    if (dto.group_settlement_notifications !== undefined) {
      prefs.group_settlement_notifications =
        dto.group_settlement_notifications;
    }
    if (dto.digest_frequency !== undefined) {
      prefs.digest_frequency = dto.digest_frequency;
    }
    if (dto.digest_hour !== undefined) {
      prefs.digest_hour = dto.digest_hour;
    }
    if (dto.digest_timezone !== undefined) {
      prefs.digest_timezone = dto.digest_timezone;
    }

    const updated = await this.preferencesRepository.save(prefs);

    return {
      id: updated.id,
      email_notifications: updated.email_notifications,
      marketing_emails: updated.marketing_emails,
      goal_created_notifications: updated.goal_created_notifications,
      goal_contribution_notifications: updated.goal_contribution_notifications,
      goal_reached_notifications: updated.goal_reached_notifications,
      deposit_notifications: updated.deposit_notifications,
      withdrawal_notifications: updated.withdrawal_notifications,
      group_settlement_notifications: updated.group_settlement_notifications,
      digest_frequency: updated.digest_frequency,
      digest_hour: updated.digest_hour,
      digest_timezone: updated.digest_timezone,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    };
  }

  async followUser(
    followerId: string,
    followingAddress: string,
  ): Promise<{ success: boolean; message: string }> {
    const follower = await this.findById(followerId);
    const following = await this.findByAddress(followingAddress);

    if (follower.id === following.id) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const existing = await this.followRepository.findOne({
      where: { follower_id: followerId, following_id: following.id },
    });

    if (existing) {
      throw new ConflictException('Already following this user');
    }

    await this.followRepository.save({
      follower_id: followerId,
      following_id: following.id,
    });

    return { success: true, message: 'User followed successfully' };
  }

  async unfollowUser(
    followerId: string,
    followingAddress: string,
  ): Promise<{ success: boolean; message: string }> {
    const following = await this.findByAddress(followingAddress);

    const result = await this.followRepository.delete({
      follower_id: followerId,
      following_id: following.id,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Follow relationship not found');
    }

    return { success: true, message: 'User unfollowed successfully' };
  }

  async getFollowers(
    address: string,
    dto: PaginationDto,
  ): Promise<FollowersListDto> {
    const user = await this.findByAddress(address);
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const [followers, total] = await this.followRepository
      .createQueryBuilder('follow')
      .leftJoinAndSelect('follow.follower', 'follower')
      .where('follow.following_id = :userId', { userId: user.id })
      .orderBy('follow.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const data = followers.map((f) => this.mapUserToFollowResponse(f.follower));

    return { data, total, page, limit };
  }

  async getFollowing(
    address: string,
    dto: PaginationDto,
  ): Promise<FollowingListDto> {
    const user = await this.findByAddress(address);
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const [following, total] = await this.followRepository
      .createQueryBuilder('follow')
      .leftJoinAndSelect('follow.following', 'following')
      .where('follow.follower_id = :userId', { userId: user.id })
      .orderBy('follow.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const data = following.map((f) =>
      this.mapUserToFollowResponse(f.following),
    );

    return { data, total, page, limit };
  }

  async getFollowStats(
    address: string,
  ): Promise<{ followers_count: number; following_count: number }> {
    const user = await this.findByAddress(address);

    const [, followersCount] = await this.followRepository
      .createQueryBuilder('follow')
      .where('follow.following_id = :userId', { userId: user.id })
      .getManyAndCount();

    const [, followingCount] = await this.followRepository
      .createQueryBuilder('follow')
      .where('follow.follower_id = :userId', { userId: user.id })
      .getManyAndCount();

    return {
      followers_count: followersCount,
      following_count: followingCount,
    };
  }

  private mapUserToFollowResponse(user: User): UserFollowResponseDto {
    return {
      id: user.id,
      stellar_address: user.stellar_address,
      username: user.username,
      avatar_url: user.avatar_url,
      reputation_score: user.reputation_score,
    };
  }
}
