import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Query filters for the audit ledger (FR-AUD-01).
 *
 * Every field maps 1:1 onto an existing `financial_transaction_logs`
 * column. `tenantId` is deliberately absent: ownership comes only from
 * the verified JWT, and the global `forbidNonWhitelisted` pipe rejects
 * a client-supplied `tenantId` outright rather than silently ignoring it.
 */
export class AuditLogQueryDto {
  @IsOptional()
  @IsUUID()
  personId?: string;

  /** e.g. PAYMENT_COLLECTED, DUE_ALLOCATION_REFUND, ADVANCE_WALLET_REFUND. */
  @IsOptional()
  @IsString()
  eventType?: string;

  /** e.g. Payment, Due, Refund. */
  @IsOptional()
  @IsString()
  referenceEntityType?: string;

  @IsOptional()
  @IsUUID()
  referenceEntityId?: string;

  /** The authenticated user who performed the action (BR-13 attribution). */
  @IsOptional()
  @IsUUID()
  performedByUserId?: string;

  /** Inclusive lower bound on createdAt (ISO-8601). */
  @IsOptional()
  @IsString()
  from?: string;

  /** Inclusive upper bound on createdAt (ISO-8601). */
  @IsOptional()
  @IsString()
  to?: string;

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