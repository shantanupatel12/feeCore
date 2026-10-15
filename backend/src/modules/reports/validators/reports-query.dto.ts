import {
  IsOptional,
  IsDateString,
  IsEnum,
  IsString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DueStatus, PaymentMode } from '@prisma/client';

/**
 * Collection report filters (FR-REP-01).
 * The SRS requires filtering by date range, payment mode, collector and person.
 */
export class CollectionReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @IsString()
  collectorUserId?: string;

  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Dues & overdue report filters (FR-REP-02).
 * The SRS requires filtering by age bucket, category and person.
 */
export class DuesReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(DueStatus)
  status?: DueStatus;

  @IsOptional()
  @IsString()
  personId?: string;

  /** Charge category, matched against the related Charge. */
  @IsOptional()
  @IsString()
  category?: string;

  /**
   * Overdue age bucket in days, e.g. 30 selects "31-60 days overdue".
   * Rows are those overdue by at least this many days.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ageBucketDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}