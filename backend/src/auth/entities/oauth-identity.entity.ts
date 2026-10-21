import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('oauth_identities')
@Index(['provider', 'provider_user_id'], { unique: true })
@Index(['user_id', 'provider'], { unique: true })
export class OAuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  provider: string;

  @Column({ type: 'varchar', length: 255 })
  provider_user_id: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  display_name: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
