import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, IsBoolean } from 'class-validator';
import { RoundupMethod, RoundupFrequency } from '../entities/roundup-config.entity';

export class CreateRoundupConfigDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(RoundupMethod)
  method: RoundupMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  method_parameter?: number; // For percentage: 0-100

  @IsEnum(RoundupFrequency)
  frequency: RoundupFrequency;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_roundup_amount?: number; // In stroops

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_roundup_per_transaction?: number; // In stroops

  @IsOptional()
  @IsString()
  target_vault?: string; // 'flexible', 'locked', 'goals', etc.
}

export class UpdateRoundupConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RoundupMethod)
  method?: RoundupMethod;

  @IsOptional()
  @IsNumber()
  method_parameter?: number;

  @IsOptional()
  @IsEnum(RoundupFrequency)
  frequency?: RoundupFrequency;

  @IsOptional()
  @IsNumber()
  min_roundup_amount?: number;

  @IsOptional()
  @IsNumber()
  max_roundup_per_transaction?: number;

  @IsOptional()
  @IsString()
  target_vault?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_paused?: boolean;

  @IsOptional()
  @IsString()
  pause_reason?: string;
}

export class RoundupConfigResponseDto {
  id: string;
  name: string;
  description: string | null;
  method: RoundupMethod;
  method_parameter: string | null;
  frequency: RoundupFrequency;
  min_roundup_amount: string;
  max_roundup_per_transaction: string;
  target_vault: string;
  is_active: boolean;
  is_paused: boolean;
  last_processed_at: Date | null;
  next_scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
