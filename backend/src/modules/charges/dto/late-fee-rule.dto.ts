import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { LateFeeCalculationType } from '@prisma/client';

/** Minor units are whole non-negative integers, never decimals or floats. */
const MINOR_UNITS = /^\d+$/;

/**
 * FR-CHG-03 / BR-CHG-003 late fee rule configuration.
 *
 * Monetary values are minor-unit strings (BR-CORE-001 tier 3); the service
 * owns parsing so a non-numeric value becomes a 400 rather than a 500.
 *
 * `tenantId` is not a property of either DTO: ownership comes only from the
 * verified JWT and the global whitelist pipe rejects a client-supplied one.
 */
export class CreateLateFeeRuleDto {
  /**
   * FIXED: `amountMinor` is the flat penalty charged once the due date
   * lapses. DAILY: `amountMinor` is charged per overdue day.
   */
  @IsEnum(LateFeeCalculationType)
  calculationType!: LateFeeCalculationType;

  /** Must be greater than zero; a zero fee would be a no-op rule. */
  @IsString()
  @Matches(MINOR_UNITS, {
    message: 'amountMinor must be a non-negative integer amount in minor units',
  })
  amountMinor!: string;
}

export class UpdateLateFeeRuleDto {
  @IsEnum(LateFeeCalculationType)
  @IsOptional()
  calculationType?: LateFeeCalculationType;

  @IsString()
  @Matches(MINOR_UNITS, {
    message: 'amountMinor must be a non-negative integer amount in minor units',
  })
  @IsOptional()
  amountMinor?: string;
}