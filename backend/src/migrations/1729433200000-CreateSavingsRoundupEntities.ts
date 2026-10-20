import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateSavingsRoundupEntities1729433200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create roundup_configs table
    await queryRunner.createTable(
      new Table({
        name: 'roundup_configs',
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
            name: 'name',
            type: 'varchar',
            length: 255,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'method',
            type: 'enum',
            enum: [
              'nearest_dollar',
              'nearest_cent',
              'nearest_quarter',
              'percentage',
              'fixed_amount',
            ],
          },
          {
            name: 'method_parameter',
            type: 'numeric',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'frequency',
            type: 'enum',
            enum: ['immediate', 'daily', 'weekly', 'monthly', 'batch'],
          },
          {
            name: 'min_roundup_amount',
            type: 'varchar',
            default: "'1000000'",
          },
          {
            name: 'max_roundup_per_transaction',
            type: 'varchar',
            default: "'100000000'",
          },
          {
            name: 'target_vault',
            type: 'varchar',
            default: "'flexible'",
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'is_paused',
            type: 'boolean',
            default: false,
          },
          {
            name: 'pause_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'last_processed_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'next_scheduled_at',
            type: 'timestamptz',
            isNullable: true,
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

    // Add indexes to roundup_configs
    await queryRunner.createIndex(
      'roundup_configs',
      new TableIndex({
        name: 'IDX_roundup_configs_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_configs',
      new TableIndex({
        name: 'IDX_roundup_configs_is_active',
        columnNames: ['is_active'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_configs',
      new TableIndex({
        name: 'UQ_user_active_config',
        columnNames: ['user_id', 'is_active'],
        isUnique: true,
        where: 'is_active = true',
      }),
    );

    // Create roundup_records table
    await queryRunner.createTable(
      new Table({
        name: 'roundup_records',
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
            name: 'config_id',
            type: 'uuid',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
          },
          {
            name: 'trigger_source',
            type: 'enum',
            enum: ['transaction', 'external', 'webhook', 'api', 'scheduled'],
          },
          {
            name: 'roundup_amount',
            type: 'varchar',
          },
          {
            name: 'original_amount',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'method_applied',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'transaction_reference',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'trigger_timestamp',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'deposit_tx_hash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'deposit_ledger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'batch_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'processed_at',
            type: 'timestamptz',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Add indexes to roundup_records
    await queryRunner.createIndex(
      'roundup_records',
      new TableIndex({
        name: 'IDX_roundup_records_user_created',
        columnNames: ['user_id', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_records',
      new TableIndex({
        name: 'IDX_roundup_records_config_id',
        columnNames: ['config_id'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_records',
      new TableIndex({
        name: 'IDX_roundup_records_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_records',
      new TableIndex({
        name: 'IDX_roundup_records_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create roundup_batches table
    await queryRunner.createTable(
      new Table({
        name: 'roundup_batches',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'record_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'total_amount',
            type: 'varchar',
          },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'pending',
              'processing',
              'completed',
              'partial',
              'failed',
              'cancelled',
            ],
            default: "'pending'",
          },
          {
            name: 'successful_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'failed_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'deposit_tx_hash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'deposit_ledger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'processing_started_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'processed_at',
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

    // Add indexes to roundup_batches
    await queryRunner.createIndex(
      'roundup_batches',
      new TableIndex({
        name: 'IDX_roundup_batches_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_batches',
      new TableIndex({
        name: 'IDX_roundup_batches_created_at',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'roundup_batches',
      new TableIndex({
        name: 'IDX_roundup_batches_processed_at',
        columnNames: ['processed_at'],
      }),
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'roundup_configs',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'roundup_records',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'roundup_records',
      new TableForeignKey({
        columnNames: ['config_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'roundup_configs',
        onDelete: 'RESTRICT',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    const configTable = await queryRunner.getTable('roundup_configs');
    const configFK = configTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('user_id') !== -1,
    );
    if (configFK) {
      await queryRunner.dropForeignKey('roundup_configs', configFK);
    }

    const recordTable = await queryRunner.getTable('roundup_records');
    const recordUserFK = recordTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('user_id') !== -1,
    );
    const recordConfigFK = recordTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('config_id') !== -1,
    );
    if (recordUserFK) {
      await queryRunner.dropForeignKey('roundup_records', recordUserFK);
    }
    if (recordConfigFK) {
      await queryRunner.dropForeignKey('roundup_records', recordConfigFK);
    }

    // Drop tables
    await queryRunner.dropTable('roundup_batches');
    await queryRunner.dropTable('roundup_records');
    await queryRunner.dropTable('roundup_configs');
  }
}
