import { IsString, IsNotEmpty, IsEnum, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { RecurringFrequency, RecurringPlanStatus } from '@prisma/client';

export class CreateRecurringPlanDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  baseAmountMinor!: string;

  @IsEnum(RecurringFrequency)
  frequency!: RecurringFrequency;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  anchorDay?: number;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string; // 'YYYY-MM-DD'

  @IsDateString()
  @IsOptional()
  endDate?: string; // 'YYYY-MM-DD'
}

export class UpdateRecurringPlanDto {
  @IsEnum(RecurringPlanStatus)
  @IsOptional()
  status?: RecurringPlanStatus;

  @IsString()
  @IsOptional()
  baseAmountMinor?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
