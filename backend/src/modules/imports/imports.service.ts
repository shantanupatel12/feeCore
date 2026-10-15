import { Injectable, BadRequestException } from '@nestjs/common';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { PeopleService } from '../people/people.service.js';
import { CustomFieldsService } from '../people/custom-fields.service.js';
import { ImportPeopleCsvDto } from './dto/import-people-csv.dto.js';
import { CreatePersonDto } from '../people/dto/person.dto.js';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/** FR-PER-01 standard contact columns recognised in the CSV header. */
const STANDARD_COLUMNS = [
  'fullName',
  'primaryPhone',
  'secondaryPhone',
  'email',
  'address',
] as const;

interface RowError {
  /** 1-based CSV row number, counting the header as row 1. */
  row: number;
  message: string;
}

export interface ImportResult {
  jobId: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  errors: RowError[];
}

/**
 * FR-IMP-01: bulk import of People from CSV with row-level validation.
 *
 * Behaviour follows `docs/implementation-plan.md` §"Bulk CSV Import
 * (People)": rows are streamed, each row is validated against the standard
 * contact fields and the tenant's custom field schema, and structured
 * row-level diagnostics are returned. Valid rows are committed and rejected
 * rows are reported, which is what per-row diagnostics implies; BR-02 says
 * nothing about an all-or-nothing switch, so none is invented.
 *
 * Row creation delegates to `PeopleService.create`, so every existing rule
 * stays authoritative: required/format validation, per-tenant primary-phone
 * uniqueness (ConflictException becomes a row error), and custom-field
 * validation against this tenant's definitions only.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    private readonly customFieldsService: CustomFieldsService,
  ) {}

  /**
   * Parses the CSV, importing one row at a time.
   *
   * `csv-parser` is used because correct RFC-4180 quoting (embedded commas,
   * escaped quotes, newlines inside fields) is not something to hand-roll;
   * `docs/implementation-plan.md` names this package for this exact feature.
   */
  private async parseCsv(csv: string): Promise<Array<Record<string, string>>> {
    const rows: Array<Record<string, string>> = [];

    try {
      await new Promise<void>((resolve, reject) => {
        Readable.from([csv])
          /*
           * Default (no `headers` option) makes csv-parser take the first
           * line as the header row, which is the documented convention.
           * Values are trimmed explicitly below because csv-parser has no
           * trim option.
           */
          .pipe(csvParser({ skipComments: false }))
          .on('data', (row: Record<string, string>) => rows.push(row))
          .on('error', reject)
          .on('end', resolve);
      });
    } catch {
      throw new BadRequestException('The CSV payload could not be parsed.');
    }

    return rows;
  }

  private isBlank(row: Record<string, string>): boolean {
    return Object.values(row).every((value) => value === undefined || value.trim() === '');
  }

  /** Columns the tenant has actually defined. */
  private async customKeys(tenantId: string): Promise<Set<string>> {
    const definitions = await this.customFieldsService.findAll(tenantId);
    return new Set(definitions.map((d) => d.fieldKey));
  }

  /**
   * Runs `CreatePersonDto`'s own class-validator rules over one parsed row.
   *
   * `PeopleService.create` is normally reached through the controller, where
   * the global `ValidationPipe` enforces the DTO decorators. A CSV row never
   * passes through that pipe, so without this step the required-field and
   * email-format rules would silently be skipped and invalid rows would be
   * written as People. The options mirror the global pipe's configuration.
   *
   * Returns the joined constraint messages, or null when the row is valid.
   */
  private async validateRow(dto: CreatePersonDto): Promise<string | null> {
    const errors = await validate(plainToInstance(CreatePersonDto, dto), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length === 0) {
      return null;
    }

    return errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join(', ');
  }

  async importPeopleCsv(
    tenantId: string,
    userId: string,
    dto: ImportPeopleCsvDto,
  ): Promise<ImportResult> {
    const rows = await this.parseCsv(dto.csv);
    const customKeys = await this.customKeys(tenantId);

    const errors: RowError[] = [];
    let successCount = 0;

    for (const [index, row] of rows.entries()) {
      // Row number is 1-based and counts the header line as row 1.
      const rowNumber = index + 2;

      if (this.isBlank(row)) {
        continue;
      }

      const dtoForRow: CreatePersonDto = {
        fullName: (row.fullName ?? '').trim(),
        primaryPhone: (row.primaryPhone ?? '').trim(),
      };

      const secondaryPhone = (row.secondaryPhone ?? '').trim();
      if (secondaryPhone) {
        dtoForRow.secondaryPhone = secondaryPhone;
      }
      const email = (row.email ?? '').trim();
      if (email) {
        dtoForRow.email = email;
      }
      const address = (row.address ?? '').trim();
      if (address) {
        dtoForRow.address = address;
      }

      /*
       * Any column that is neither a standard field nor a custom field this
       * tenant has defined is dropped. `tenantId` therefore cannot appear:
       * ownership is never read from CSV content.
       */
      const customData: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalized = key.trim();
        if (
          !(STANDARD_COLUMNS as readonly string[]).includes(normalized) &&
          customKeys.has(normalized) &&
          typeof value === 'string' &&
          value.trim() !== ''
        ) {
          customData[normalized] = value.trim();
        }
      }
      if (Object.keys(customData).length > 0) {
        dtoForRow.customData = customData;
      }

      const rowValidationError = await this.validateRow(dtoForRow);
      if (rowValidationError) {
        errors.push({ row: rowNumber, message: rowValidationError });
        continue;
      }

      try {
        await this.peopleService.create(tenantId, dtoForRow);
        successCount += 1;
      } catch (error) {
        // A rejected row creates nothing; the failure is reported instead.
        const message =
          error instanceof Error && error.message ? error.message : 'Row could not be imported.';
        errors.push({ row: rowNumber, message });
      }
    }

    const failureCount = errors.length;

    const job = await this.prisma.importJob.create({
      data: {
        tenantId,
        totalRows: successCount + failureCount,
        successCount,
        failureCount,
        errors: (errors.length > 0 ? errors : undefined) as unknown as Prisma.InputJsonValue,
        performedByUserId: userId,
      },
    });

    return {
      jobId: job.id,
      totalRows: job.totalRows,
      successCount: job.successCount,
      failureCount: job.failureCount,
      errors,
    };
  }
}