import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateInterestRatesEntities1729433000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create interest_rate_configs table
    await queryRunner.createTable(
      new Table({
        name: 'interest_rate_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
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
            name: 'asset',
            type: 'varchar',
            length: 12,
            default: "'USDC'",
          },
          {
            name: 'base_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0',
          },
          {
            name: 'min_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0',
          },
          {
            name: 'max_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '100',
          },
          {
            name: 'optimal_utilization',
            type: 'numeric',
            precision: 5,
            scale: 4,
            default: '0.85',
          },
          {
            name: 'slope_up',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.05',
          },
          {
            name: 'slope_down',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.25',
          },
          {
            name: 'smoothing_factor',
            type: 'numeric',
            precision: 5,
            scale: 4,
            default: '0.1',
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'notes',
            type: 'text',
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

    // Add indexes to interest_rate_configs
    await queryRunner.createIndex(
      'interest_rate_configs',
      new TableIndex({
        name: 'IDX_interest_rate_configs_is_active',
        columnNames: ['is_active'],
      }),
    );

    // Create interest_rate_history table
    await queryRunner.createTable(
      new Table({
        name: 'interest_rate_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'config_id',
            type: 'uuid',
          },
          {
            name: 'calculated_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
          },
          {
            name: 'utilization_ratio',
            type: 'numeric',
            precision: 5,
            scale: 4,
          },
          {
            name: 'total_liquidity',
            type: 'varchar',
          },
          {
            name: 'total_utilization',
            type: 'varchar',
          },
          {
            name: 'oracle_price',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'previous_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
          },
          {
            name: 'rate_delta',
            type: 'numeric',
            precision: 10,
            scale: 4,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add indexes to interest_rate_history
    await queryRunner.createIndex(
      'interest_rate_history',
      new TableIndex({
        name: 'IDX_interest_rate_history_config_created',
        columnNames: ['config_id', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'interest_rate_history',
      new TableIndex({
        name: 'IDX_interest_rate_history_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create oracle_data table
    await queryRunner.createTable(
      new Table({
        name: 'oracle_data',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'asset',
            type: 'varchar',
            length: 12,
          },
          {
            name: 'source_type',
            type: 'enum',
            enum: [
              'stellar_quest',
              'chainlink',
              'band_protocol',
              'anchor',
              'manual',
            ],
          },
          {
            name: 'price_usd',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'price_base',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'confidence',
            type: 'numeric',
            precision: 5,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'price_timestamp',
            type: 'timestamptz',
          },
          {
            name: 'is_valid',
            type: 'boolean',
            default: true,
          },
          {
            name: 'notes',
            type: 'text',
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

    // Add indexes to oracle_data
    await queryRunner.createIndex(
      'oracle_data',
      new TableIndex({
        name: 'IDX_oracle_data_asset_source',
        columnNames: ['asset', 'source_type'],
      }),
    );

    await queryRunner.createIndex(
      'oracle_data',
      new TableIndex({
        name: 'IDX_oracle_data_updated_at',
        columnNames: ['updated_at'],
      }),
    );

    // Add foreign key
    await queryRunner.createForeignKey(
      'interest_rate_history',
      new TableForeignKey({
        columnNames: ['config_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'interest_rate_configs',
        onDelete: 'RESTRICT',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    const historyTable = await queryRunner.getTable('interest_rate_history');
    const foreignKey = historyTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('config_id') !== -1,
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey('interest_rate_history', foreignKey);
    }

    // Drop tables
    await queryRunner.dropTable('oracle_data');
    await queryRunner.dropTable('interest_rate_history');
    await queryRunner.dropTable('interest_rate_configs');
  }
}
