import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateInterestRateConfigDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  asset?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  base_rate: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  min_rate: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  max_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  optimal_utilization: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  slope_up: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  slope_down: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  smoothing_factor: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInterestRateConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  base_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  min_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  max_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  optimal_utilization?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  slope_up?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  slope_down?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  smoothing_factor?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  is_active?: boolean;
}
