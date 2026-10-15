import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CustomFieldDataType } from '@prisma/client';

/**
 * FR-CFD-01 / BR-12: tenant-defined custom field schemas.
 *
 * The persisted `data_type` enum is the repository's canonical vocabulary
 * (`CustomFieldDataType`), which predates this work: `SELECT` and
 * `BOOLEAN` rather than the SRS prose "Select"/"Boolean". Per ADR-007 the
 * stored enum is authoritative, so it is kept as-is and the SRS synonyms
 * are accepted on input and normalised to the canonical value rather than
 * inventing a parallel enum or renaming existing columns.
 */
const DATA_TYPE_ALIASES: Record<string, CustomFieldDataType> = {
  TEXT: CustomFieldDataType.TEXT,
  STRING: CustomFieldDataType.TEXT,
  NUMBER: CustomFieldDataType.NUMBER,
  NUMERIC: CustomFieldDataType.NUMBER,
  DATE: CustomFieldDataType.DATE,
  SELECT: CustomFieldDataType.SELECT,
  DROPDOWN: CustomFieldDataType.SELECT,
  ENUM: CustomFieldDataType.SELECT,
  BOOLEAN: CustomFieldDataType.BOOLEAN,
  YESNO: CustomFieldDataType.BOOLEAN,
  TOGGLE: CustomFieldDataType.BOOLEAN,
};

const CANONICAL_DATA_TYPES = Object.values(CustomFieldDataType) as string[];

/** Accepts "YES/NO", "yes_no", "Dropdown", ... and returns canonical form. */
export function normalizeDataType(input: unknown): CustomFieldDataType | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  return DATA_TYPE_ALIASES[input.trim().replace(/[^a-z0-9]/gi, '').toUpperCase()];
}

/**
 * The key is the JSONB property name on `Person.customData`, so it is
 * normalised to `snake_case` before it is ever compared or persisted.
 * Two keys that normalise to the same value must collide (see the
 * `@@unique([tenantId, fieldKey])` constraint), so creation checks for
 * duplicates using this function rather than the raw input.
 */
export function normalizeFieldKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/*
 * Neither DTO declares `tenantId`. Ownership of a definition comes only
 * from the verified JWT, and the global whitelist pipe
 * ({ whitelist: true, forbidNonWhitelisted: true }) rejects a client
 * supplied `tenantId` in the request body before the handler runs.
 */
export class CreateCustomFieldDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // Snake_case keys keep the JSONB property names predictable and stable.
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'fieldKey may contain only letters, digits and underscores',
  })
  fieldKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fieldLabel!: string;

  @Transform(({ value }) => normalizeDataType(value))
  @IsIn(CANONICAL_DATA_TYPES, {
    message: `dataType must be one of ${CANONICAL_DATA_TYPES.join(', ')} (SRS synonyms such as DROPDOWN or YES/NO are accepted)`,
  })
  dataType!: CustomFieldDataType;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  /**
   * Allowed values for a `SELECT` field. Required and validated by the
   * service, which is the only layer that knows the resolved dataType
   * once SRS synonyms have been normalised.
   */
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  options?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}

export class UpdateCustomFieldDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fieldLabel?: string;

  @Transform(({ value }) => normalizeDataType(value))
  @IsIn(CANONICAL_DATA_TYPES, {
    message: `dataType must be one of ${CANONICAL_DATA_TYPES.join(', ')}`,
  })
  @IsOptional()
  dataType?: CustomFieldDataType;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  options?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  /*
   * `fieldKey` is intentionally absent and therefore immutable.
   *
   * The key is the JSONB property name holding every stored person value;
   * the SRS defines no rename operation and `Person.customData` is not
   * migrated by this codebase. Renaming would orphan existing values
   * silently, so it is refused instead: the global whitelist pipe rejects
   * `fieldKey` in a PATCH body outright (forbidNonWhitelisted), and the
   * service ignores it as a second line of defence.
   */
}