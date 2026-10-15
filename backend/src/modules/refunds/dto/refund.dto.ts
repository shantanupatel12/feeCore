import {
  IsString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class CreateRefundDto {
  /**
   * Flow A only: the allocation being refunded. Required for
   * RefundType.DUE_ALLOCATION per BR-REF-001.
   */
  @IsString()
  @IsNotEmpty()
  paymentAllocationId!: string;

  /** Minor units, matching Charge/Due/Payment conventions. */
  @IsString()
  @IsNotEmpty()
  refundAmountMinor!: string;

  /** Free-text mode label, e.g. CASH / BANK_TRANSFER. */
  @IsString()
  @IsNotEmpty()
  refundMode!: string;

  /** Mandatory per SRS. */
  @IsString()
  @IsNotEmpty()
  refundReason!: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;
}

/**
 * Flow B only: return of credit that was never allocated to a Due.
 * No payment or allocation reference exists for this flow.
 */
export class CreateAdvanceRefundDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  /** Minor units, matching Charge/Due/Payment conventions. */
  @IsString()
  @IsNotEmpty()
  refundAmountMinor!: string;

  /** Free-text mode label, e.g. CASH / BANK_TRANSFER. */
  @IsString()
  @IsNotEmpty()
  refundMode!: string;

  /** Mandatory per SRS. */
  @IsString()
  @IsNotEmpty()
  refundReason!: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;
}