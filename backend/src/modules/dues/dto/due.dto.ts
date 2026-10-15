import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { DueStatus } from '@prisma/client';

export class QueryDuesDto {
  @IsString()
  @IsOptional()
  personId?: string;

  @IsEnum(DueStatus)
  @IsOptional()
  status?: DueStatus;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  page?: number;

  @IsString()
  @IsOptional()
  limit?: number;
}

export class GenerateDuesDto {
  @IsDateString()
  @IsOptional()
  targetDate?: string; // 'YYYY-MM-DD'

  @IsString()
  @IsOptional()
  recurringPlanId?: string;
}
