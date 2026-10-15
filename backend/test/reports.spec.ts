import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, PaymentStatus, UserRole } from '@prisma/client';
import { ReportsService } from '../src/modules/reports/services/reports.service.js';
import { ReportsController } from '../src/modules/reports/controllers/reports.controller.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../src/modules/reports/validators/reports-query.dto.js';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcTodayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function daysBeforeToday(n: number): Date {
  return new Date(utcTodayStart().getTime() - n * DAY_MS);
}

/* -------------------------------------------------------------------------- */
/* Collection report tests (FR-REP-01)                                        */
/* -------------------------------------------------------------------------- */
describe('Collection report (FR-REP-01)', () => {
  let prisma: PrismaClient;
  let service: ReportsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let collectorA: string;
  let personA: string;
  let payTodayC: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new ReportsService(prisma as any);

    const tA = await prisma.tenant.create({ data: { name: 'Coll Report A', category: 'School' } });
    const tB = await prisma.tenant.create({ data: { name: 'Coll Report B', category: 'Gym' } });
    tenantA = tA.id;
    tenantB = tB.id;

    adminA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'admin@coll.test',
          passwordHash: 'h',
          fullName: 'Admin A',
          role: UserRole.ROLE_ADMIN,
        },
      })
    ).id;

    collectorA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'collector@coll.test',
          passwordHash: 'h',
          fullName: 'Collector A',
          role: UserRole.ROLE_COLLECTOR,
        },
      })
    ).id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Coll Person A',
          primaryPhone: '3000000001',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    const today = utcTodayStart();

    const p1 = await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        collectorUserId: collectorA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(1000),
        allocatedToDues: BigInt(1000),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'coll-today-cash',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: today,
      },
    });
    payTodayC = p1.id;

    await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        collectorUserId: adminA,
        paymentMode: PaymentMode.UPI,
        totalAmount: BigInt(500),
        allocatedToDues: BigInt(500),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'coll-today-upi',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date(today.getTime() + 4 * 60 * 60 * 1000),
      },
    });

    await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        collectorUserId: collectorA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(200),
        allocatedToDues: BigInt(200),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'coll-mid-month',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date(today.getTime() - 5 * DAY_MS),
      },
    });

    await prisma.refund.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        processedByUserId: adminA,
        refundType: 'DUE_ALLOCATION',
        refundAmount: BigInt(200),
        refundReason: 'Coll refund',
        refundMode: 'CASH',
        paymentId: payTodayC,
      },
    });

    // Stray payment in tenant B for isolation checks.
    const personB = await prisma.person.create({
      data: {
        tenantId: tenantB,
        fullName: 'Coll Tenant B Person',
        primaryPhone: '4000000001',
        advanceBalance: BigInt(0),
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantB,
        personId: personB.id,
        collectorUserId: adminA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(9999),
        allocatedToDues: BigInt(9999),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'coll-tenant-b',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: today,
      },
    });
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.refund.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('returns correct gross, net, refund and count totals', async () => {
    const r = await service.collectionReport(tenantA, { page: 1, limit: 20 });

    // 1000 + 500 + 200 = 1700 gross.
    expect(r.totals.grossCollectedMinor).toBe('1700');
    expect(r.totals.paymentCount).toBe(3);
    expect(r.totals.allocatedToDuesMinor).toBe('1700');
    expect(r.totals.creditedToAdvanceMinor).toBe('0');
    // All-time refund (200) is subtracted from gross.
    expect(r.totals.refundedMinor).toBe('200');
    expect(r.totals.netCollectedMinor).toBe('1500');
  });

  it('groups breakdowns by payment mode and collector (with names)', async () => {
    const r = await service.collectionReport(tenantA, { page: 1, limit: 20 });

    const cash = r.byPaymentMode.find((m) => m.paymentMode === PaymentMode.CASH)!;
    const upi = r.byPaymentMode.find((m) => m.paymentMode === PaymentMode.UPI)!;
    expect(cash.totalMinor).toBe('1200');
    expect(cash.paymentCount).toBe(2);
    expect(upi.totalMinor).toBe('500');
    expect(upi.paymentCount).toBe(1);

    const byCollectorA = r.byCollector.find((c) => c.collectorUserId === collectorA)!;
    const byAdminA = r.byCollector.find((c) => c.collectorUserId === adminA)!;
    expect(byCollectorA.collectorName).toBe('Collector A');
    expect(byAdminA.collectorName).toBe('Admin A');
    expect(byCollectorA.totalMinor).toBe('1200');
    expect(byAdminA.totalMinor).toBe('500');
  });

  it('includes line items in desc date order', async () => {
    const r = await service.collectionReport(tenantA, { page: 1, limit: 20 });

    expect(r.items).toHaveLength(3);
    const [first] = r.items;
    expect(first.paymentMode).toBe(PaymentMode.UPI);
    expect(first.personName).toBe('Coll Person A');
    expect(first.totalAmountMinor).toBe('500');
    expect(first.collectorName).toBe('Admin A');
  });

  it('filters by date range (from/to is inclusive of full days)', async () => {
    const today = utcTodayStart();
    const todayStr = today.toISOString().slice(0, 10);

    // Only today's payments: 1000 + 500 = 1500.
    const r = await service.collectionReport(tenantA, {
      from: todayStr,
      to: todayStr,
      page: 1,
      limit: 20,
    });

    expect(r.totals.grossCollectedMinor).toBe('1500');
    expect(r.totals.paymentCount).toBe(2);
    // Refund is all-time, still 200.
    expect(r.totals.refundedMinor).toBe('200');
    expect(r.totals.netCollectedMinor).toBe('1300');
    expect(r.items.every((i) => i.paymentDate.slice(0, 10) === todayStr)).toBe(true);
  });

  it('filters by payment mode', async () => {
    const r = await service.collectionReport(tenantA, {
      paymentMode: PaymentMode.CASH,
      page: 1,
      limit: 20,
    });
    expect(r.totals.paymentCount).toBe(2);
    expect(r.totals.grossCollectedMinor).toBe('1200');
    expect(r.items.every((i) => i.paymentMode === PaymentMode.CASH)).toBe(true);
  });

  it('filters by collector', async () => {
    const r = await service.collectionReport(tenantA, {
      collectorUserId: collectorA,
      page: 1,
      limit: 20,
    });
    expect(r.totals.paymentCount).toBe(2);
    expect(r.totals.grossCollectedMinor).toBe('1200');
    expect(r.items.every((i) => i.collectorUserId === collectorA)).toBe(true);
  });

  it('paginates items with correct totalPages', async () => {
    const r = await service.collectionReport(tenantA, { page: 1, limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.totalPages).toBe(2);

    const r2 = await service.collectionReport(tenantA, { page: 2, limit: 2 });
    expect(r2.items).toHaveLength(1);
  });

  it('returns empty results for a tenant with no payments', async () => {
    const empty = (
      await prisma.tenant.create({ data: { name: 'Coll Empty', category: 'School' } })
    ).id;

    const r = await service.collectionReport(empty, { page: 1, limit: 20 });
    expect(r.totals.paymentCount).toBe(0);
    expect(r.totals.grossCollectedMinor).toBe('0');
    expect(r.totals.refundedMinor).toBe('0');
    expect(r.totals.netCollectedMinor).toBe('0');
    expect(r.items).toHaveLength(0);
    expect(r.totalPages).toBe(0);

    await prisma.tenant.delete({ where: { id: empty } });
  });

  it('does not leak other tenants data', async () => {
    const r = await service.collectionReport(tenantA, { page: 1, limit: 20 });
    expect(r.totals.grossCollectedMinor).toBe('1700');
    expect(r.items.some((i) => i.totalAmountMinor === '9999')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Dues report tests (FR-REP-02)                                              */
/* -------------------------------------------------------------------------- */
describe('Dues report (FR-REP-02)', () => {
  let prisma: PrismaClient;
  let service: ReportsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;
  let chargeTuition: string;
  let chargeFee: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new ReportsService(prisma as any);

    const tA = await prisma.tenant.create({ data: { name: 'Dues Report A', category: 'School' } });
    const tB = await prisma.tenant.create({ data: { name: 'Dues Report B', category: 'Gym' } });
    tenantA = tA.id;
    tenantB = tB.id;

    adminA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'admin@dues.test',
          passwordHash: 'h',
          fullName: 'Admin A',
          role: UserRole.ROLE_ADMIN,
        },
      })
    ).id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Dues Person A',
          primaryPhone: '5000000001',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    chargeTuition = (
      await prisma.charge.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          category: 'TUITION',
          baseAmount: BigInt(1000),
          discountAmount: BigInt(0),
          createdByUserId: adminA,
        },
      })
    ).id;

    chargeFee = (
      await prisma.charge.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          category: 'LATE_FEE',
          baseAmount: BigInt(500),
          discountAmount: BigInt(0),
          createdByUserId: adminA,
        },
      })
    ).id;

    // Dues with relative due dates for deterministic aging buckets.
    // All open statuses with balance > 0 (except PAID/VOIDED which are excluded).

    // 5 days overdue  → "0-30 days" bucket.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeTuition,
        dueDate: daysBeforeToday(5),
        netAmount: BigInt(1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(1000),
        status: DueStatus.PENDING,
      },
    });

    // 45 days overdue → "31-60 days" bucket.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeFee,
        dueDate: daysBeforeToday(45),
        netAmount: BigInt(500),
        lateFeeAmount: BigInt(50),
        balanceRemaining: BigInt(500),
        status: DueStatus.OVERDUE,
      },
    });

    // 75 days overdue → "61-90 days" bucket.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeTuition,
        dueDate: daysBeforeToday(75),
        netAmount: BigInt(300),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(300),
        status: DueStatus.PENDING,
      },
    });

    // 120 days overdue → "90+ days" bucket.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeFee,
        dueDate: daysBeforeToday(120),
        netAmount: BigInt(200),
        lateFeeAmount: BigInt(20),
        balanceRemaining: BigInt(200),
        status: DueStatus.OVERDUE,
      },
    });

    // Paid due → excluded.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeTuition,
        dueDate: daysBeforeToday(10),
        netAmount: BigInt(400),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(0),
        status: DueStatus.PAID,
      },
    });

    // Voided due → excluded.
    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeTuition,
        dueDate: daysBeforeToday(10),
        netAmount: BigInt(100),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(100),
        status: DueStatus.VOIDED,
      },
    });

    // Tenant B data for isolation.
    const personB = await prisma.person.create({
      data: {
        tenantId: tenantB,
        fullName: 'Dues Tenant B Person',
        primaryPhone: '6000000001',
        advanceBalance: BigInt(0),
      },
    });
    const chargeB = await prisma.charge.create({
      data: {
        tenantId: tenantB,
        personId: personB.id,
        category: 'TUITION',
        baseAmount: BigInt(9999),
        discountAmount: BigInt(0),
        createdByUserId: adminA,
      },
    });
    await prisma.due.create({
      data: {
        tenantId: tenantB,
        personId: personB.id,
        chargeId: chargeB.id,
        dueDate: daysBeforeToday(5),
        netAmount: BigInt(9999),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(9999),
        status: DueStatus.PENDING,
      },
    });
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await prisma.refund.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('returns correct outstanding and overdue totals', async () => {
    const r = await service.duesReport(tenantA, { page: 1, limit: 20 });

    // Open dues: PENDING(1000) + OVERDUE(500) + PENDING(300) + OVERDUE(200) = 2000.
    // Paid (400) and Voided (100) excluded.
    expect(r.totals.openDueCount).toBe(4);
    expect(r.totals.totalOutstandingMinor).toBe('2000');
    expect(r.totals.overdueDueCount).toBe(4); // all 4 are overdue (dueDate < today)
    expect(r.totals.totalOverdueMinor).toBe('2000');
    expect(r.totals.outstandingLateFeeMinor).toBe('70'); // 50 + 20
  });

  it('populates all four aging buckets with correct labels and amounts', async () => {
    const r = await service.duesReport(tenantA, { page: 1, limit: 20 });

    expect(r.overdueAging).toHaveLength(4);

    const b030 = r.overdueAging.find((a) => a.bucket === '0-30 days')!;
    const b3160 = r.overdueAging.find((a) => a.bucket === '31-60 days')!;
    const b6190 = r.overdueAging.find((a) => a.bucket === '61-90 days')!;
    const b90 = r.overdueAging.find((a) => a.bucket === '90+ days')!;

    expect(b030.dueCount).toBe(1);
    expect(b030.amountMinor).toBe('1000');

    expect(b3160.dueCount).toBe(1);
    expect(b3160.amountMinor).toBe('500');

    expect(b6190.dueCount).toBe(1);
    expect(b6190.amountMinor).toBe('300');

    expect(b90.dueCount).toBe(1);
    expect(b90.amountMinor).toBe('200');

    // Aging amounts sum to the overdue total.
    const agedSum = r.overdueAging.reduce((acc, b) => acc + Number(b.amountMinor), 0);
    expect(agedSum).toBe(Number(r.totals.totalOverdueMinor));
  });

  it('groups by status and category', async () => {
    const r = await service.duesReport(tenantA, { page: 1, limit: 20 });

    const pending = r.byStatus.find((s) => s.status === DueStatus.PENDING)!;
    const overdue = r.byStatus.find((s) => s.status === DueStatus.OVERDUE)!;

    expect(pending.dueCount).toBe(2);
    expect(pending.balanceMinor).toBe('1300'); // 1000 + 300
    expect(overdue.dueCount).toBe(2);
    expect(overdue.balanceMinor).toBe('700'); // 500 + 200

    const tuition = r.byCategory.find((c) => c.category === 'TUITION')!;
    const lateFee = r.byCategory.find((c) => c.category === 'LATE_FEE')!;

    expect(tuition.dueCount).toBe(2);
    expect(tuition.balanceMinor).toBe('1300'); // 1000 + 300
    expect(lateFee.dueCount).toBe(2);
    expect(lateFee.balanceMinor).toBe('700'); // 500 + 200
  });

  it('filters by status (OVERDUE only)', async () => {
    const r = await service.duesReport(tenantA, { status: DueStatus.OVERDUE, page: 1, limit: 20 });

    expect(r.totals.openDueCount).toBe(2);
    expect(r.totals.totalOutstandingMinor).toBe('700');
    expect(r.totals.overdueDueCount).toBe(2);
    expect(r.totals.totalOverdueMinor).toBe('700');
    expect(r.items.every((i) => i.status === DueStatus.OVERDUE)).toBe(true);
  });

  it('filters by category', async () => {
    const r = await service.duesReport(tenantA, { category: 'TUITION', page: 1, limit: 20 });

    expect(r.totals.openDueCount).toBe(2);
    expect(r.totals.totalOutstandingMinor).toBe('1300');
    expect(r.items.every((i) => i.category === 'TUITION')).toBe(true);
  });

  it('filters by age bucket (at least N days overdue)', async () => {
    // ageBucketDays=30 → dueDate < today-30 (i.e. 31+ days overdue).
    const r = await service.duesReport(tenantA, { ageBucketDays: 30, page: 1, limit: 20 });

    expect(r.totals.overdueDueCount).toBe(3); // 45d, 75d, 120d (excludes 5d)
    expect(r.totals.totalOverdueMinor).toBe('1000'); // 500 + 300 + 200
  });

  it('filters by date range on due date', async () => {
    const today = utcTodayStart();
    const from = new Date(today.getTime() - 50 * DAY_MS).toISOString().slice(0, 10);
    const to = new Date(today.getTime() - 40 * DAY_MS).toISOString().slice(0, 10);

    // Due dates in [today-50, today-40): only the 45-day-overdue due falls here.
    const r = await service.duesReport(tenantA, { from, to, page: 1, limit: 20 });

    expect(r.totals.openDueCount).toBe(1);
    expect(r.totals.totalOutstandingMinor).toBe('500');
    expect(r.items[0].category).toBe('LATE_FEE');
  });

  it('paginates items with correct totalPages', async () => {
    const r = await service.duesReport(tenantA, { page: 1, limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.totalPages).toBe(2); // 4 open dues / 2 per page

    const r2 = await service.duesReport(tenantA, { page: 2, limit: 2 });
    expect(r2.items).toHaveLength(2);
  });

  it('returns empty results for a tenant with no dues', async () => {
    const empty = (
      await prisma.tenant.create({ data: { name: 'Dues Empty', category: 'School' } })
    ).id;

    const r = await service.duesReport(empty, { page: 1, limit: 20 });
    expect(r.totals.openDueCount).toBe(0);
    expect(r.totals.totalOutstandingMinor).toBe('0');
    expect(r.totals.overdueDueCount).toBe(0);
    expect(r.totals.totalOverdueMinor).toBe('0');
    expect(r.items).toHaveLength(0);
    expect(r.totalPages).toBe(0);

    await prisma.tenant.delete({ where: { id: empty } });
  });

  it('does not leak other tenants dues', async () => {
    const r = await service.duesReport(tenantA, { page: 1, limit: 20 });
    expect(r.totals.openDueCount).toBe(4);
    expect(r.totals.totalOutstandingMinor).toBe('2000');
    // No item from tenant B (which has a 9999 balance).
    expect(r.items.some((i) => Number(i.balanceRemainingMinor) === 9999)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* RBAC + JWT tenant scoping                                                  */
/* -------------------------------------------------------------------------- */
describe('Reports RBAC and JWT tenant scoping', () => {
  const TENANT_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TENANT_B = 'bbbbbbbb-2222-2222-2222-222222222222';

  const admin = {
    sub: 'u-admin',
    tenantId: TENANT_A,
    email: 'a@a.com',
    role: UserRole.ROLE_ADMIN,
  } as JwtPayload;

  it('collectionReport scopes to the JWT tenant, ignoring the URL path tenant', async () => {
    const controller = new ReportsController({} as any);
    const seen: string[] = [];

    (controller as any).reportsService = {
      collectionReport: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
      duesReport: async () => null,
    };

    await controller.collectionReport(admin, { page: 1, limit: 20 } as any);

    expect(seen).toEqual([TENANT_A]);
    expect(seen).not.toContain(TENANT_B);
  });

  it('duesReport scopes to the JWT tenant, ignoring the URL path tenant', async () => {
    const controller = new ReportsController({} as any);
    const seen: string[] = [];

    (controller as any).reportsService = {
      collectionReport: async () => null,
      duesReport: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
    };

    await controller.duesReport(admin, { page: 1, limit: 20 } as any);

    expect(seen).toEqual([TENANT_A]);
    expect(seen).not.toContain(TENANT_B);
  });

  it('declares no @Roles restriction (both reports are ALLOW-all)', () => {
    const collRoles = Reflect.getMetadata(
      ROLES_KEY,
      ReportsController.prototype.collectionReport,
    );
    const duesRoles = Reflect.getMetadata(
      ROLES_KEY,
      ReportsController.prototype.duesReport,
    );
    expect(collRoles).toBeUndefined();
    expect(duesRoles).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Input validation                                                            */
/* -------------------------------------------------------------------------- */
describe('Reports input validation', () => {
  it('collection: accepts a valid query', () => {
    const dto = plainToInstance(CollectionReportQueryDto, {
      from: '2026-06-01',
      to: '2026-06-30',
      page: 1,
      limit: 20,
    });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });

  it('collection: rejects a bad date', () => {
    const dto = plainToInstance(CollectionReportQueryDto, { from: 'not-a-date' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('collection: rejects an invalid paymentMode', () => {
    const dto = plainToInstance(CollectionReportQueryDto, { paymentMode: 'CASH_ONLY' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('collection: rejects page below 1 and limit above 100', () => {
    const dto = plainToInstance(CollectionReportQueryDto, { page: 0, limit: 200 });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('due: accepts a valid query', () => {
    const dto = plainToInstance(DuesReportQueryDto, {
      from: '2026-06-01',
      status: DueStatus.PENDING,
      ageBucketDays: 30,
      category: 'TUITION',
      page: 1,
      limit: 50,
    });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });

  it('due: rejects a bad date', () => {
    const dto = plainToInstance(DuesReportQueryDto, { to: 'invalid' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('due: rejects an invalid status enum', () => {
    const dto = plainToInstance(DuesReportQueryDto, { status: 'NOT_A_STATUS' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('due: rejects negative ageBucketDays', () => {
    const dto = plainToInstance(DuesReportQueryDto, { ageBucketDays: -1 });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
