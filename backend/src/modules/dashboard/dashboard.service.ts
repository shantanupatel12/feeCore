import { Injectable } from '@nestjs/common';
import { DueStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service.js';

/** UTC day/month boundaries, matching the schema's Timestamptz storage. */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function sum(value: bigint | null | undefined): bigint {
  return value ?? BigInt(0);
}

/**
 * Dashboard KPIs (FR-DSH-01 / BR-10 / ADR-015).
 *
 * Every figure is a PostgreSQL aggregate over an existing indexed
 * column set rather than an in-memory fold over the tenant's rows:
 *   - payments: idx_payments_dashboard (tenant_id, payment_date, total_amount)
 *   - dues:idx_dues_dashboard (tenant_id, status, due_date, balance_remaining)
 *
 * Single responsibility: read-only KPI projection. No writes, and no
 * dependency on the Payments/Dues services because a KPI is an
 * aggregate view, not a domain operation.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(tenantId: string, query?: { asOf?: string }) {
    const asOf = query?.asOf ? new Date(query.asOf) : new Date();
    const dayStart = startOfUtcDay(asOf);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const monthStart = startOfUtcMonth(asOf);

    /*
     * VOIDED dues are cancelled obligations, so they are excluded from
     * every outstanding figure. The SRS sample SQL only filters on
     * status != 'PAID', but counting a voided due as money owed would
     * contradict BR-REC-001's reconciliation equation.
     */
    const openStatuses = {
      notIn: [DueStatus.PAID, DueStatus.VOIDED],
    };

    const [
      collectedToday,
      collectedMonthToDate,
      grossCollected,
      refundsIssued,
      dueRaisedToday,
      totalOutstanding,
      totalOverdue,
      openDueCount,
      overdueDueCount,
      paidDueCount,
      totalPeople,
      activePeople,
      paymentsToday,
      advanceHeld,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          paymentDate: { gte: dayStart, lt: dayEnd },
        },
        _sum: { totalAmount: true, allocatedToDues: true, creditedToAdvance: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, paymentDate: { gte: monthStart, lt: dayEnd } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: PaymentStatus.SUCCESSFUL },
        _sum: { totalAmount: true },
      }),
      this.prisma.refund.aggregate({
        where: { tenantId },
        _sum: { refundAmount: true },
      }),
      this.prisma.due.aggregate({
        where: { tenantId, dueDate: { gte: dayStart, lt: dayEnd } },
        _sum: { netAmount: true },
        _count: true,
      }),
      this.prisma.due.aggregate({
        where: { tenantId, status: openStatuses },
        _sum: { balanceRemaining: true, lateFeeAmount: true },
        _count: true,
      }),
      this.prisma.due.aggregate({
        where: {
          tenantId,
          status: openStatuses,
          dueDate: { lt: dayStart },
          balanceRemaining: { gt: BigInt(0) },
        },
        _sum: { balanceRemaining: true },
        _count: true,
      }),
      this.prisma.due.count({ where: { tenantId, status: openStatuses } }),
      this.prisma.due.count({
        where: {
          tenantId,
          status: openStatuses,
          dueDate: { lt: dayStart },
          balanceRemaining: { gt: BigInt(0) },
        },
      }),
      this.prisma.due.count({ where: { tenantId, status: DueStatus.PAID } }),
      this.prisma.person.count({ where: { tenantId } }),
      this.prisma.person.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.payment.count({
        where: { tenantId, paymentDate: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.person.aggregate({
        where: { tenantId },
        _sum: { advanceBalance: true },
      }),
    ]);

    const netCollected =
      sum(grossCollected._sum.totalAmount) - sum(refundsIssued._sum.refundAmount);

    return {
      asOf: asOf.toISOString(),
      currentPeriod: {
        from: monthStart.toISOString(),
        to: asOf.toISOString(),
      },
      collection: {
        todayCollectedMinor: sum(collectedToday._sum.totalAmount).toString(),
        todayPaymentsCount: collectedToday._count,
        todayAllocatedToDuesMinor: sum(collectedToday._sum.allocatedToDues).toString(),
        todayCreditedToAdvanceMinor: sum(collectedToday._sum.creditedToAdvance).toString(),
        periodCollectedMinor: sum(collectedMonthToDate._sum.totalAmount).toString(),
        periodPaymentsCount: collectedMonthToDate._count,
        allTimeCollectedMinor: sum(grossCollected._sum.totalAmount).toString(),
        allTimeRefundsMinor: sum(refundsIssued._sum.refundAmount).toString(),
        allTimeNetCollectedMinor: netCollected.toString(),
      },
      dues: {
        dueRaisedTodayMinor: sum(dueRaisedToday._sum.netAmount).toString(),
        dueRaisedTodayCount: dueRaisedToday._count,
        totalOutstandingMinor: sum(totalOutstanding._sum.balanceRemaining).toString(),
        openDueCount,
        paidDueCount,
        outstandingLateFeeMinor: sum(totalOutstanding._sum.lateFeeAmount).toString(),
      },
      overdue: {
        totalOverdueMinor: sum(totalOverdue._sum.balanceRemaining).toString(),
        overdueDueCount,
        paymentsTodayCount: paymentsToday,
      },
      people: {
        total: totalPeople,
        active: activePeople,
      },
      advance: {
        totalHeldMinor: sum(advanceHeld._sum.advanceBalance).toString(),
      },
    };
  }
}