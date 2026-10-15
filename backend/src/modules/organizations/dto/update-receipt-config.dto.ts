import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * FR-ORG-03 receipt configuration.
 *
 * Every field maps to a column that already exists:
 *   receiptPrefix     -> tenant_settings.receipt_prefix   (VarChar 20)
 *   receiptFooterText -> tenant_settings.receipt_footer_text (Text)
 *   logoUrl           -> tenants.logo_url                 (VarChar 500)
 *
 * There is no receipt-numbering-sequence field: `receipt_sequences`
 * is an internal per-tenant, per-fiscal-year counter maintained by
 * the existing issuance transaction, not a configurable value.
 *
 * `tenantId` is deliberately not a property; ownership comes only from
 * the verified JWT.
 */
export class UpdateReceiptConfigDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  receiptPrefix?: string;

  @IsOptional()
  @IsString()
  receiptFooterText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}