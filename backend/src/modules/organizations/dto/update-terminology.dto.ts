import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * FR-ORG-02 terminology aliases.
 *
 * Every field maps to exactly one `tenant_settings` column and all are
 * optional, so a partial update leaves unspecified labels at their
 * existing Prisma default. `tenantId` is deliberately not a property:
 * ownership comes only from the verified JWT.
 */
export class UpdateTerminologyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  personLabelSingular?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  personLabelPlural?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  chargeLabelSingular?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  chargeLabelPlural?: string;
}