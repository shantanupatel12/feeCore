import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMode } from '@prisma/client';

export class DueAllocationDto {
  @IsString()
  @IsNotEmpty()
  dueId!: string;

  /** Minor units (e.g. paise/cents) */
  @IsString()
  @IsNotEmpty()
  amountMinor!: string;
}

export class CreatePaymentDto {
  @IsString()
  @IsOptional()
  dueId?: string;

  /** Minor units (e.g. paise/cents), matching Charge/Due conventions. */
  @IsString()
  @IsOptional()
  amountMinor?: string;

  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  /**
   * Optional client reference (cheque no., UPI ref, etc).
   * Not used as an idempotency key.
   */
  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * Caller-supplied de-duplication key. Required by the schema
   * so a retried request can never create a second payment.
   */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  // Optional multi-due fields if sent via primary payment endpoint
  @IsString()
  @IsOptional()
  personId?: string;

  @IsString()
  @IsOptional()
  totalAmountMinor?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DueAllocationDto)
  allocations?: DueAllocationDto[];

  @IsString()
  @IsOptional()
  creditedToAdvanceMinor?: string;
}

export class CreateMultiDuePaymentDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsString()
  @IsNotEmpty()
  totalAmountMinor!: string;

  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DueAllocationDto)
  allocations!: DueAllocationDto[];

  @IsString()
  @IsOptional()
  creditedToAdvanceMinor?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class CreateAdvancePaymentDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsString()
  @IsNotEmpty()
  amountMinor!: string;

  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class ApplyAdvanceDto {
  @IsString()
  @IsOptional()
  dueId?: string;

  @IsString()
  @IsOptional()
  personId?: string;

  /**
   * Optional minor units to apply.
   * If omitted, applies the minimum of available advance balance and outstanding due balance.
   */
  @IsString()
  @IsOptional()
  amountMinor?: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class AssessLateFeeDto {
  @IsString()
  @IsNotEmpty()
  feeAmountMinor!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * FR-CHG-03 rule-driven sweep. `asOfDate` is optional and exists so the
 * daily evaluation is deterministic and testable; production callers omit it
 * and the tenant's current calendar date is used.
 */
export class AssessLateFeesDto {
  @IsString()
  @IsDateString()
  @IsOptional()
  asOfDate?: string; // 'YYYY-MM-DD'
}

export class WaiveLateFeeDto {
  /**
   * Minor units to waive. If omitted, waives all unsettled late fee on the due.
   */
  @IsString()
  @IsOptional()
  amountMinor?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}