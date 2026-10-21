import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('oauth_transactions')
export class OAuthTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  state_hash: string;

  @Column({ type: 'varchar', length: 16 })
  provider: string;

  @Column({ type: 'varchar', length: 8 })
  intent: 'login' | 'link';

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  nonce: string | null;

  @Column({ type: 'varchar', length: 64 })
  client_verifier_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumed_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  exchange_code_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  exchanged_at: Date | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  return_to: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
