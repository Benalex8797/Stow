import { RoundupRecordStatus, RoundupTriggerSource } from '../entities/roundup-record.entity';

export class RoundupRecordResponseDto {
  id: string;
  status: RoundupRecordStatus;
  trigger_source: RoundupTriggerSource;
  roundup_amount: string;
  original_amount: string | null;
  method_applied: string | null;
  transaction_reference: string | null;
  trigger_timestamp: Date | null;
  deposit_tx_hash: string | null;
  error_message: string | null;
  created_at: Date;
  processed_at: Date | null;
}

export class RoundupStatsDto {
  total_configs: number;
  active_configs: number;
  paused_configs: number;
  total_accumulated: string;      // Total pending roundups
  total_processed: string;        // Total deposited
  pending_records: number;
  completed_records: number;
  failed_records: number;
  last_batch_at: Date | null;
}

export class ProcessRoundupResponseDto {
  success: boolean;
  records_processed: number;
  total_amount: string;
  batch_id: string;
  message: string;
}

export class TriggerRoundupResponseDto {
  success: boolean;
  roundup_amount: string;
  batch_id: string | null;
  message: string;
}
