import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min, Max, Matches } from 'class-validator';

/** Minor units are whole non-negative integers, never decimals or floats. */
const MINOR_UNITS = /^\d+$/;

/**
 * FR-CHG-01 / FR-CHG-02.
 *
 * Monetary fields are minor-unit strings per BR-CORE-001 tier 3, so they are
 * typed as strings and pattern-constrained here. The pattern matters: the
 * service parses them with BigInt, and BigInt('abc') throws a SyntaxError
 * that would surface as a 500 instead of a 400.
 */
export class CreateChargeDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @Matches(MINOR_UNITS, { message: 'baseAmountMinor must be a non-negative integer amount in minor units' })
  baseAmountMinor!: string;

  /**
   * Fixed discount in minor units (BR-CHG-002 case 1):
   * DiscountAmount = D_fixed.
   *
   * Mutually exclusive with `discountPercent`; supplying both is rejected
   * because the two would silently compete for the same column.
   */
  @IsString()
  @Matches(MINOR_UNITS, { message: 'discountAmountMinor must be a non-negative integer amount in minor units' })
  @IsOptional()
  discountAmountMinor?: string;

  /**
   * Percentage discount (BR-CHG-002 case 2):
   * DiscountAmount = floor(BaseAmount * P / 100).
   *
   * Restricted to whole percentages so the discount is computed in exact
   * BigInt minor units with no floating-point step. `tenantId` is not a
   * property: ownership comes only from the verified JWT and the global
   * whitelist pipe rejects a client-supplied one.
   */
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  discountPercent?: number;

  @IsDateString()
  @IsNotEmpty()
  dueDate!: string; // 'YYYY-MM-DD'
}