import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateNftRewardsEntities1729432800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create nft_reward_milestones table
    await queryRunner.createTable(
      new Table({
        name: 'nft_reward_milestones',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'milestone_type',
            type: 'enum',
            enum: [
              'savings_amount',
              'goals_reached',
              'consecutive_deposits',
              'activity_streak',
            ],
          },
          {
            name: 'threshold',
            type: 'bigint',
          },
          {
            name: 'name',
            type: 'varchar',
            length: 255,
          },
          {
            name: 'description',
            type: 'text',
          },
          {
            name: 'nft_title',
            type: 'varchar',
            length: 255,
          },
          {
            name: 'nft_description',
            type: 'text',
          },
          {
            name: 'image_ipfs_cid',
            type: 'varchar',
            length: 255,
          },
          {
            name: 'rarity_tier',
            type: 'int',
            default: 1,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'is_soulbound',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add indexes to nft_reward_milestones
    await queryRunner.createIndex(
      'nft_reward_milestones',
      new TableIndex({
        name: 'IDX_nft_reward_milestones_milestone_type',
        columnNames: ['milestone_type'],
      }),
    );

    await queryRunner.createIndex(
      'nft_reward_milestones',
      new TableIndex({
        name: 'IDX_nft_reward_milestones_threshold',
        columnNames: ['threshold'],
      }),
    );

    // Create user_nft_rewards table
    await queryRunner.createTable(
      new Table({
        name: 'user_nft_rewards',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'milestone_id',
            type: 'uuid',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['earned', 'minted', 'transferred'],
            default: "'earned'",
          },
          {
            name: 'nft_contract_address',
            type: 'varchar',
            length: 56,
            isNullable: true,
          },
          {
            name: 'nft_token_id',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'metadata_ipfs_cid',
            type: 'varchar',
            length: 255,
            isNullable: true,
          },
          {
            name: 'mint_tx_hash',
            type: 'varchar',
            length: 255,
            isNullable: true,
          },
          {
            name: 'mint_ledger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'earned_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'minted_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'transferred_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add indexes to user_nft_rewards
    await queryRunner.createIndex(
      'user_nft_rewards',
      new TableIndex({
        name: 'IDX_user_nft_rewards_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_nft_rewards',
      new TableIndex({
        name: 'IDX_user_nft_rewards_milestone_id',
        columnNames: ['milestone_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_nft_rewards',
      new TableIndex({
        name: 'IDX_user_nft_rewards_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'user_nft_rewards',
      new TableIndex({
        name: 'IDX_user_nft_rewards_created_at',
        columnNames: ['earned_at'],
      }),
    );

    await queryRunner.createIndex(
      'user_nft_rewards',
      new TableIndex({
        name: 'UQ_user_milestone_reward',
        columnNames: ['user_id', 'milestone_id'],
        isUnique: true,
      }),
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'user_nft_rewards',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'user_nft_rewards',
      new TableForeignKey({
        columnNames: ['milestone_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'nft_reward_milestones',
        onDelete: 'RESTRICT',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    const table = await queryRunner.getTable('user_nft_rewards');
    const userForeignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('user_id') !== -1,
    );
    if (userForeignKey) {
      await queryRunner.dropForeignKey('user_nft_rewards', userForeignKey);
    }

    const milestoneForeignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('milestone_id') !== -1,
    );
    if (milestoneForeignKey) {
      await queryRunner.dropForeignKey('user_nft_rewards', milestoneForeignKey);
    }

    // Drop tables
    await queryRunner.dropTable('user_nft_rewards');
    await queryRunner.dropTable('nft_reward_milestones');
  }
}
