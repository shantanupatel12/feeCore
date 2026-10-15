import { IsString, IsNotEmpty, IsOptional, IsEmail, IsObject, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { PersonStatus } from '@prisma/client';

/**
 * FR-PER-02 search parameters for `GET /people`.
 *
 * `query` is the SRS-defined parameter. `search` is retained as a
 * backward-compatible alias because it is already the supported behaviour of
 * this endpoint; when both are supplied `query` wins (see the controller).
 * `tenantId` is deliberately not a property: ownership comes only from the
 * verified JWT, and the global whitelist pipe rejects it outright.
 *
 * Only `@IsInt()` is imposed on the paging parameters. A non-integer page was
 * previously coerced to `NaN` and surfaced as a 500 from the driver; it now
 * fails validation with 400. Out-of-range values still reach the service and
 * are clamped there exactly as before.
 */
export class QueryPeopleDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  status?: PersonStatus;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  limit?: number;
}

/**
 * FR-PER-02 search-term precedence: the SRS parameter `query` wins over the
 * backward-compatible `search` alias, decided on presence rather than
 * truthiness, and the two are never combined.
 *
 * Shared by `PeopleController` and the SRS route alias so the documented rule
 * has exactly one implementation.
 */
export function resolvePeopleSearchTerm(dto?: QueryPeopleDto): string | undefined {
  return dto?.query ?? dto?.search;
}

export class CreatePersonDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  primaryPhone!: string;

  @IsString()
  @IsOptional()
  secondaryPhone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsObject()
  @IsOptional()
  customData?: Record<string, any>;
}

export class UpdatePersonDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  primaryPhone?: string;

  @IsString()
  @IsOptional()
  secondaryPhone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsObject()
  @IsOptional()
  customData?: Record<string, any>;

  /*
   * `status` is deliberately absent.
   *
   * Person status changed through the generic update, which has no
   * permission narrower than authentication, and so bypassed the
   * `people:deactivate` check that governs the dedicated
   * `POST /people/:id/deactivate` route (Owner/Admin only per
   * docs/permission-matrix.md).
   *
   * Status now changes only through the dedicated endpoint. Because the
   * global pipe runs with `forbidNonWhitelisted: true`, a `status`
   * property in a PUT body is rejected with 400 rather than silently
   * ignored. This also preserves BR-REC-004, which suspends recurring
   * plans on deactivation: a bare status write would have skipped that.
   */
}
