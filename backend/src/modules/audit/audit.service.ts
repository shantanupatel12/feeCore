import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Audit logs (FR-AUD-01 / BR-13).
 *
 * Read-only over `financial_transaction_logs`, which is the immutable
 * append-only ledger the payments, charges, advance-wallet, late-fee
 * and refunds services already write. This service deliberately
 * exposes no create, update or delete path: the ledger is append-only
 * and existing writers own every insert (BR-CORE-002/003).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    id: string;
    personId: string;
    eventType: string;
    referenceEntityType: string;
    referenceEntityId: string;
    amount: bigint;
    balanceSnapshot: bigint;
    metadata: Prisma.JsonValue;
    performedByUserId: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      personId: row.personId,
      eventType: row.eventType,
      referenceEntityType: row.referenceEntityType,
      referenceEntityId: row.referenceEntityId,
      // Minor units serialized as strings (BR-CORE-001).
      amountMinor: row.amount.toString(),
      balanceSnapshotMinor: row.balanceSnapshot.toString(),
      metadata: row.metadata,
      performedByUserId: row.performedByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseDate(raw: string, field: string): Date {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Query parameter '${field}' must be a valid ISO-8601 date.`,
      );
    }
    return parsed;
  }

  async listAuditLogs(tenantId: string, query: AuditLogQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (query.personId) where.personId = query.personId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.referenceEntityType) {
      where.referenceEntityType = query.referenceEntityType;
    }
    if (query.referenceEntityId) {
      where.referenceEntityId = query.referenceEntityId;
    }
    if (query.performedByUserId) {
      where.performedByUserId = query.performedByUserId;
    }

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.gte = this.parseDate(query.from, 'from');
      if (query.to) createdAt.lte = this.parseDate(query.to, 'to');
      where.createdAt = createdAt;
    }

    const [rows, total] = await Promise.all([
      this.prisma.financialTransactionLog.findMany({
        where,
        /*
         * Newest first, with `id` as a tie-break. Rows created inside
         * one transaction share a createdAt, so ordering on the
         * timestamp alone would be non-deterministic across pages.
         */
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.financialTransactionLog.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.serialize(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Tenant-scoped single lookup; a foreign id is indistinguishable from absent. */
  async getAuditLog(tenantId: string, id: string) {
    const row = await this.prisma.financialTransactionLog.findFirst({
      where: { id, tenantId },
    });

    return row ? this.serialize(row) : null;
  }
}