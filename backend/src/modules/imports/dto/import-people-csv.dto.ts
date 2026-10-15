import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * FR-IMP-01 bulk People CSV import.
 *
 * The CSV travels as a JSON string field rather than a multipart upload:
 * the repository has no multipart plugin and adding one would be a new
 * dependency plus new HTTP plumbing for no SRS benefit. Routing the body
 * through the existing `ValidationPipe({ whitelist, forbidNonWhitelisted })`
 * also means `tenantId` in the body is rejected before the handler runs.
 *
 * `tenantId` is deliberately not a property. Ownership of every created
 * Person and of the ImportJob comes only from the verified JWT.
 */
export class ImportPeopleCsvDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  csv!: string;
}