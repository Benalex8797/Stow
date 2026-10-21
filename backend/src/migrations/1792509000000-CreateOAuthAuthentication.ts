import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateOAuthAuthentication1792509000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'oauth_identities',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'provider',
            type: 'varchar',
            length: '16',
            isNullable: false,
          },
          {
            name: 'provider_user_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          { name: 'email', type: 'varchar', isNullable: true },
          { name: 'display_name', type: 'varchar', isNullable: true },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'oauth_identities',
      new TableIndex({
        name: 'UQ_oauth_identities_provider_subject',
        columnNames: ['provider', 'provider_user_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'oauth_identities',
      new TableIndex({
        name: 'UQ_oauth_identities_user_provider',
        columnNames: ['user_id', 'provider'],
        isUnique: true,
      }),
    );
    await queryRunner.createForeignKey(
      'oauth_identities',
      new TableForeignKey({
        name: 'FK_oauth_identities_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'oauth_transactions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'state_hash',
            type: 'varchar',
            length: '64',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'provider',
            type: 'varchar',
            length: '16',
            isNullable: false,
          },
          { name: 'intent', type: 'varchar', length: '8', isNullable: false },
          { name: 'user_id', type: 'uuid', isNullable: true },
          { name: 'nonce', type: 'varchar', length: '128', isNullable: true },
          {
            name: 'client_verifier_hash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          { name: 'expires_at', type: 'timestamptz', isNullable: false },
          { name: 'consumed_at', type: 'timestamptz', isNullable: true },
          {
            name: 'exchange_code_hash',
            type: 'varchar',
            length: '64',
            isUnique: true,
            isNullable: true,
          },
          { name: 'exchanged_at', type: 'timestamptz', isNullable: true },
          {
            name: 'return_to',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'oauth_transactions',
      new TableIndex({
        name: 'IDX_oauth_transactions_expires_at',
        columnNames: ['expires_at'],
      }),
    );
    await queryRunner.createForeignKey(
      'oauth_transactions',
      new TableForeignKey({
        name: 'FK_oauth_transactions_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey(
      'oauth_transactions',
      'FK_oauth_transactions_user',
    );
    await queryRunner.dropTable('oauth_transactions');
    await queryRunner.dropForeignKey(
      'oauth_identities',
      'FK_oauth_identities_user',
    );
    await queryRunner.dropTable('oauth_identities');
  }
}
