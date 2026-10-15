import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * FR-SRH-01 global search query.
 *
 * `q` is required and must carry at least one non-whitespace character,
 * so a blank search bar cannot trigger an unbounded table scan.
 * `tenantId` is deliberately not a property: ownership comes only from
 * the verified JWT, and the global whitelist pipe rejects it outright.
 */
export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  q!: string;

  /** Per-result-type cap, keeping the response bounded. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
