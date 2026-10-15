import { Injectable, BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { ReportsService } from '../reports/services/reports.service.js';
import { CollectionReportQueryDto } from '../reports/validators/reports-query.dto.js';
import { csvStream } from './csv.js';

/**
 * The only entities FR-EXP-01 names: People, Dues, Payments and Reports.
 * Anything else is a client error, never a silently empty CSV.
 */
export const EXPORTABLE_ENTITIES = ['people', 'dues', 'payments', 'reports'] as const;
export type ExportableEntity = (typeof EXPORTABLE_ENTITIES)[number];

/** Rows fetched per database round trip while streaming. */
const BATCH_SIZE = 500;

/**
 * Column order per entity, declared once so it is stable and diffable.
 */
const HEADERS: Record<ExportableEntity, readonly string[]> = {
  people: [
    'id',
    'fullName',
    'primaryPhone',
    'secondaryPhone',
    'email',
    'address',
    'status',
    'advanceBalanceMinor',
    'customData',
    'createdAt',
  ],
  dues: [
    'id',
    'personId',
    'personName',
    'personPrimaryPhone',
    'chargeId',
    'chargeCategory',
    'chargeDescription',
    'dueDate',
    'netAmountMinor',
    'lateFeeAmountMinor',
    'balanceRemainingMinor',
    'status',
  ],
  payments: [
    'id',
    'personId',
    'personName',
    'personPrimaryPhone',
    'collectorUserId',
    'collectorName',
    'paymentDate',
    'paymentMode',
    'status',
    'referenceNumber',
    'totalAmountMinor',
    'allocatedToDuesMinor',
    'creditedToAdvanceMinor',
    'receiptNumbers',
  ],
  reports: [
    'id',
    'paymentDate',
    'paymentMode',
    'status',
    'personId',
    'personName',
    'personPrimaryPhone',
    'collectorUserId',
    'collectorName',
    'referenceNumber',
    'totalAmountMinor',
    'allocatedToDuesMinor',
    'creditedToAdvanceMinor',
    'receiptNumbers',
  ],
};

export interface CsvExport {
  stream: Readable;
  filename: string;
}

/**
 * FR-EXP-01: read-only CSV export for People, Dues, Payments and Reports.
 *
 * This service is strictly read-only. It issues `findMany` only and never
 * creates, updates or deletes a record, so it cannot generate a due, assess a
 * late fee, take a payment, raise a receipt, move an allocation or touch the
 * financial ledger.
 *
 * Rows are streamed in batches so a large tenant is never loaded into memory
 * at once.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
  ) {}

  /**
   * Resolves the `:entity` path segment. Unsupported values are rejected with
   * 400, matching the BadRequestException convention `ImportsService` uses
   * for an unparseable payload.
   */
  resolveEntity(entity: string): ExportableEntity {
    const normalized = (entity ?? '').trim().toLowerCase();
    if (!(EXPORTABLE_ENTITIES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Unsupported export entity '${entity}'. Supported entities: ${EXPORTABLE_ENTITIES.join(', ')}.`,
      );
    }
    return normalized as ExportableEntity;
  }

  /**
   * A stable, descriptive filename. The tenant id is not embedded because an
   * export is always scoped to the caller's own tenant.
   */
  private filename(entity: ExportableEntity): string {
    return `feecore-${entity}-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  /**
   * People. Reuses the existing Person semantics and exports the same contact
   * fields the module treats as canonical, plus the tenant's custom field map.
   *
   * `customData` is emitted as one JSON column rather than one column per
   * tenant-defined field: custom fields are tenant-defined, so a dynamic
   * column set would make column order unstable, which FR-EXP-01's CSV
   * requirements forbid. Person has no credential columns and nothing
   * security-related is selected.
   */
  private async *peopleRows(tenantId: string): AsyncGenerator<readonly unknown[]> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.person.findMany({
        where: { tenantId },
        // Deterministic total order so repeated exports of unchanged data are
        // byte-identical.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) {
        return;
      }

      for (const person of batch) {
        yield [
          person.id,
          person.fullName,
          person.primaryPhone,
          person.secondaryPhone,
          person.email,
          person.address,
          person.status,
          // BR-CORE-001: BIGINT is exported as its exact minor-unit string,
          // never as a float or a rupee-denominated number.
          person.advanceBalance.toString(),
          JSON.stringify(person.customData ?? {}),
          person.createdAt.toISOString(),
        ];
      }

      if (batch.length < BATCH_SIZE) {
        return;
      }
      cursor = batch[batch.length - 1].id;
    }
  }

  /**
   * Dues. Every value is the *stored* value: balances, discount effects, late
   * fees and status are read straight from the row.
   *
   * `status` is deliberately the persisted enum and not the date-derived
   * display status `DuesService.findAll` computes on read, because FR-EXP-01
   * requires stored values and forbids recalculation.
   */
  private async *duesRows(tenantId: string): AsyncGenerator<readonly unknown[]> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.due.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          person: { select: { id: true, fullName: true, primaryPhone: true } },
          charge: { select: { category: true, description: true } },
        },
      });

      if (batch.length === 0) {
        return;
      }

      for (const due of batch) {
        yield [
          due.id,
          due.personId,
          due.person.fullName,
          due.person.primaryPhone,
          due.chargeId,
          due.charge.category,
          due.charge.description,
          due.dueDate.toISOString().slice(0, 10),
          due.netAmount.toString(),
          due.lateFeeAmount.toString(),
          due.balanceRemaining.toString(),
          due.status,
        ];
      }

      if (batch.length < BATCH_SIZE) {
        return;
      }
      cursor = batch[batch.length - 1].id;
    }
  }

  /**
   * Payments. Stored payment values only, plus the person and collector names
   * already joined by the reports query. `idempotencyKey` is deliberately
   * omitted: it is internal request plumbing, not customer-facing data.
   */
  private async *paymentRows(tenantId: string): AsyncGenerator<readonly unknown[]> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.payment.findMany({
        where: { tenantId },
        orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          person: { select: { id: true, fullName: true, primaryPhone: true } },
          collectorUser: { select: { id: true, fullName: true } },
          receipts: { select: { receiptNumber: true } },
        },
      });

      if (batch.length === 0) {
        return;
      }

      for (const payment of batch) {
        yield [
          payment.id,
          payment.personId,
          payment.person.fullName,
          payment.person.primaryPhone,
          payment.collectorUserId,
          payment.collectorUser.fullName,
          payment.paymentDate.toISOString(),
          payment.paymentMode,
          payment.status,
          payment.referenceNumber,
          payment.totalAmount.toString(),
          payment.allocatedToDues.toString(),
          payment.creditedToAdvance.toString(),
          payment.receipts.map((receipt) => receipt.receiptNumber).join(' '),
        ];
      }

      if (batch.length < BATCH_SIZE) {
        return;
      }
      cursor = batch[batch.length - 1].id;
    }
  }

  /**
   * Reports. Delegates to the existing `ReportsService.collectionReport` and
   * streams the rows that report already returns, so no report calculation
   * exists in two places and no second reporting engine is introduced. BR-11's
   * acceptance criterion is that the CSV matches the query result.
   */
  private async *reportRows(
    tenantId: string,
    query: CollectionReportQueryDto,
  ): AsyncGenerator<readonly unknown[]> {
    const report = await this.reportsService.collectionReport(tenantId, query);

    for (const item of report.items) {
      yield [
        item.id,
        item.paymentDate,
        item.paymentMode,
        item.status,
        item.personId,
        item.personName,
        item.personPrimaryPhone,
        item.collectorUserId,
        item.collectorName,
        item.referenceNumber,
        item.totalAmountMinor,
        item.allocatedToDuesMinor,
        item.creditedToAdvanceMinor,
        item.receiptNumbers.join(' '),
      ];
    }
  }

  /**
   * Builds the CSV stream for a resolved entity.
   *
   * `tenantId` is passed in from the verified JWT by the controller and is
   * the only tenant scope any query here uses.
   */
  buildCsv(
    tenantId: string,
    entity: ExportableEntity,
    query: CollectionReportQueryDto,
  ): CsvExport {
    const rows =
      entity === 'people'
        ? this.peopleRows(tenantId)
        : entity === 'dues'
          ? this.duesRows(tenantId)
          : entity === 'payments'
            ? this.paymentRows(tenantId)
            : this.reportRows(tenantId, query);

    return {
      stream: csvStream(HEADERS[entity], rows),
      filename: this.filename(entity),
    };
  }
}
