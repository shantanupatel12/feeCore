import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * FR-ORG-01 organization profile.
 *
 * `name` is required; the remaining organization fields are optional
 * so a partially configured tenant is still valid. No currency or
 * timezone format is enforced, matching the existing project
 * convention of storing these as free-form configured strings.
 */
export class UpdateOrganizationProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string;

  /**
   * Minor-unit currency code the tenant transacts in. Recorded as
   * provided; the system does not normalize it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}