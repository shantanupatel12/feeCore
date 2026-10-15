import { Injectable } from '@nestjs/common';
import { DueStatus, PaymentMode } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service.js';
import type {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../validators/reports-query.dto.js';

const ZERO = BigInt(0);
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

function sum(value: bigint | null): bigint {
  return value ?? ZERO;
}

/**
 * Standard overdue aging buckets, measured from the due date.
 * Open-ended last bucket so nothing is silently dropped.
 */
const AGE_BUCKETS = [0, 30, 60, 90] as const;

function bucketLabel(index: number): string {
  const from = AGE_BUCKETS[index];
  const to = AGE_BUCKETS[index + 1];
  if (to === undefined) return `${from}+ days`;
  // SQL buckets use <= boundaries: <=30 => "0-30", <=60 => "31-60", <=90 => "61-90".
  const rangeFrom = index === 0 ? from : from + 1;
  return `${rangeFrom}-${to} days`;
}

/**
 * Operational reports (FR-REP-01 / FR-REP-02 / BR-10 / BR-11).
 *
 * Read-only aggregations over the same indexed columns the dashboard
 * uses. Every query is tenant-scoped from the JWT-derived tenantId, and
 * totals are computed by the database (aggregate + groupBy) rather than
 * by folding rows in Node, so a page of rows can never disagree with the
 * headline figure.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Collection report: gross collections over a period, net of refunds,
   * with breakdowns by payment mode, collector and day.
   */
  async collectionReport(tenantId: string, query: CollectionReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Inclusive `to` date: a bare YYYY-MM-DD must cover the whole day.
    const from = query.from ? startOfUtcDay(new Date(query.from)) : undefined;
    const to = query.to
      ? new Date(startOfUtcDay(new Date(query.to)).getTime() + DAY_MS)
      : undefined;

    if (from && to && from >= to) {
      return {
        period: { from: query.from, to: query.to },
        totals: {
          paymentCount: 0,
          grossCollectedMinor: '0',
          allocatedToDuesMinor: '0',
          creditedToAdvanceMinor: '0',
          refundedMinor: '0',
          netCollectedMinor: '0',
        },
        byPaymentMode: [],
        byCollector: [],
        byDay: [],
        items: [],
        page,
        limit,
        totalPages: 0,
      };
    }

    const where: Record<string, unknown> = { tenantId };
    if (from || to) where.paymentDate = { gte: from, lt: to };
    if (query.paymentMode) where.paymentMode = query.paymentMode;
    if (query.collectorUserId) where.collectorUserId = query.collectorUserId;
    if (query.personId) where.personId = query.personId;

    const [aggregate, byMode, byCollector, items, total, refunds, collectors] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where,
          _sum: {
            totalAmount: true,
            allocatedToDues: true,
            creditedToAdvance: true,
          },
          _count: true,
        }),
        this.prisma.payment.groupBy({
          by: ['paymentMode'],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.payment.groupBy({
          by: ['collectorUserId'],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.payment.findMany({
          where,
          orderBy: { paymentDate: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            person: { select: { id: true, fullName: true, primaryPhone: true } },
            collectorUser: { select: { id: true, fullName: true } },
            receipts: { select: { id: true, receiptNumber: true } },
          },
        }),
        this.prisma.payment.count({ where }),
        this.prisma.refund.aggregate({
          where: { tenantId },
          _sum: { refundAmount: true },
        }),
        this.prisma.user.findMany({
          where: {
            tenantId,
            id: {
              in: await this.prisma.payment
                .findMany({ where, select: { collectorUserId: true }, distinct: ['collectorUserId'] })
                .then((rows) => rows.map((r) => r.collectorUserId)),
            },
          },
          select: { id: true, fullName: true },
        }),
      ]);

    const collectorName = new Map(collectors.map((u) => [u.id, u.fullName]));
    const gross = sum(aggregate._sum.totalAmount);
    const refunded = sum(refunds._sum.refundAmount);

    return {
      period: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      totals: {
        paymentCount: aggregate._count,
        grossCollectedMinor: gross.toString(),
        allocatedToDuesMinor: sum(aggregate._sum.allocatedToDues).toString(),
        creditedToAdvanceMinor: sum(aggregate._sum.creditedToAdvance).toString(),
        refundedMinor: refunded.toString(),
        netCollectedMinor: (gross - refunded).toString(),
      },
      byPaymentMode: byMode
        .map((row) => ({
          paymentMode: row.paymentMode,
          paymentCount: row._count,
          totalMinor: sum(row._sum.totalAmount).toString(),
        }))
        .sort((a, b) => Number(b.totalMinor) - Number(a.totalMinor)),
      byCollector: byCollector.map((row) => ({
        collectorUserId: row.collectorUserId,
        collectorName: collectorName.get(row.collectorUserId) ?? null,
        paymentCount: row._count,
        totalMinor: sum(row._sum.totalAmount).toString(),
      })),
      items: items.map((p) => ({
        id: p.id,
        paymentDate: p.paymentDate.toISOString(),
        paymentMode: p.paymentMode,
        status: p.status,
        personId: p.personId,
        personName: p.person.fullName,
        personPrimaryPhone: p.person.primaryPhone,
        collectorUserId: p.collectorUserId,
        collectorName: p.collectorUser.fullName,
        referenceNumber: p.referenceNumber,
        totalAmountMinor: p.totalAmount.toString(),
        allocatedToDuesMinor: p.allocatedToDues.toString(),
        creditedToAdvanceMinor: p.creditedToAdvance.toString(),
        receiptNumbers: p.receipts.map((r) => r.receiptNumber),
      })),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Dues & overdue report: outstanding balances with overdue aging,
   * filtered by status, person, category and minimum overdue age.
   */
  async duesReport(tenantId: string, query: DuesReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const from = query.from ? startOfUtcDay(new Date(query.from)) : undefined;
    const to = query.to
      ? new Date(startOfUtcDay(new Date(query.to)).getTime() + DAY_MS)
      : undefined;

    // Excludes VOIDED (cancelled) and PAID (settled) obligations.
    const openStatuses = { notIn: [DueStatus.PAID, DueStatus.VOIDED] } as const;

    const where: Record<string, unknown> = {
      tenantId,
      status: query.status ?? openStatuses,
      balanceRemaining: { gt: ZERO },
    };
    if (from || to) where.dueDate = { gte: from, lt: to };
    if (query.personId) where.personId = query.personId;
    if (query.category) where.charge = { category: query.category };

    /*
     * BR-10: overdue is defined strictly as due_date < today, so the
     * bucket filter is anchored on the same day boundary the dashboard
     * uses rather than on the calendar time of the request.
     */
    const today = startOfUtcDay(new Date());
    const overdueWhere: Record<string, unknown> = { ...where, dueDate: { lt: today } };
    if (query.ageBucketDays !== undefined) {
      const cutoff = new Date(today.getTime() - query.ageBucketDays * DAY_MS);
      overdueWhere.dueDate = { lt: cutoff };
    }

    const [aggregate, overdueAggregate, byStatus, items, total, byCategory] =
      await Promise.all([
        this.prisma.due.aggregate({
          where,
          _sum: { balanceRemaining: true, lateFeeAmount: true },
          _count: true,
        }),
        this.prisma.due.aggregate({
          where: overdueWhere,
          _sum: { balanceRemaining: true },
          _count: true,
        }),
        this.prisma.due.groupBy({
          by: ['status'],
          where,
          _sum: { balanceRemaining: true },
          _count: true,
        }),
        this.prisma.due.findMany({
          where,
          orderBy: { dueDate: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            person: { select: { id: true, fullName: true, primaryPhone: true } },
            charge: { select: { id: true, category: true, description: true } },
          },
        }),
        this.prisma.due.count({ where }),
        this.prisma.due.groupBy({
          by: ['chargeId'],
          where,
          _sum: { balanceRemaining: true },
          _count: true,
        }),
      ]);

    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        id: { in: byCategory.map((c) => c.chargeId) },
      },
      select: { id: true, category: true },
    });
    const chargeCategory = new Map(charges.map((c) => [c.id, c.category]));

    const categoryTotals = new Map<string, { count: number; total: bigint }>();
    for (const row of byCategory) {
      const label = chargeCategory.get(row.chargeId) ?? 'UNKNOWN';
      const acc = categoryTotals.get(label) ?? { count: 0, total: ZERO };
      acc.count += row._count;
      acc.total += sum(row._sum.balanceRemaining);
      categoryTotals.set(label, acc);
    }

    // Aging is computed per bucket against the same `today` boundary.
    const aging = await this.prisma.$queryRaw<
      Array<{ bucket: string; due_count: bigint; amount: bigint }>
    >`
      SELECT
        CASE
          WHEN (${today}::date - due_date) <= 30 THEN '0-30 days'
          WHEN (${today}::date - due_date) <= 60 THEN '31-60 days'
          WHEN (${today}::date - due_date) <= 90 THEN '61-90 days'
          ELSE '90+ days'
        END AS bucket,
        COUNT(*) AS due_count,
        COALESCE(SUM(balance_remaining), 0) AS amount
      FROM dues
      WHERE tenant_id = ${tenantId}::uuid
        AND status = ANY(${['PENDING', 'PARTIALLY_PAID', 'OVERDUE']}::"DueStatus"[])
        AND balance_remaining > 0
        AND due_date < ${today}::date
      GROUP BY 1
      ORDER BY 1
    `;

    const agingByBucket = new Map(
      aging.map((a) => [a.bucket, { count: Number(a.due_count), total: a.amount }]),
    );

    return {
      period: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      asOf: today.toISOString(),
      totals: {
        openDueCount: aggregate._count,
        totalOutstandingMinor: sum(aggregate._sum.balanceRemaining).toString(),
        outstandingLateFeeMinor: sum(aggregate._sum.lateFeeAmount).toString(),
        overdueDueCount: overdueAggregate._count,
        totalOverdueMinor: sum(overdueAggregate._sum.balanceRemaining).toString(),
      },
      byStatus: byStatus.map((row) => ({
        status: row.status,
        dueCount: row._count,
        balanceMinor: sum(row._sum.balanceRemaining).toString(),
      })),
      byCategory: Array.from(categoryTotals.entries())
        .map(([category, v]) => ({
          category,
          dueCount: v.count,
          balanceMinor: v.total.toString(),
        }))
        .sort((a, b) => Number(b.balanceMinor) - Number(a.balanceMinor)),
      overdueAging: AGE_BUCKETS.map((_, index) => {
        const label = bucketLabel(index);
        const found = agingByBucket.get(label);
        return {
          bucket: label,
          dueCount: found?.count ?? 0,
          amountMinor: (found?.total ?? ZERO).toString(),
        };
      }),
      items: items.map((d) => ({
        id: d.id,
        dueDate: d.dueDate.toISOString().slice(0, 10),
        status: d.status,
        personId: d.personId,
        personName: d.person.fullName,
        personPrimaryPhone: d.person.primaryPhone,
        category: d.charge.category,
        description: d.charge.description,
        netAmountMinor: d.netAmount.toString(),
        lateFeeAmountMinor: d.lateFeeAmount.toString(),
        balanceRemainingMinor: d.balanceRemaining.toString(),
        daysOverdue: Math.max(
          0,
          Math.floor((today.getTime() - startOfUtcDay(d.dueDate).getTime()) / DAY_MS),
        ),
      })),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}