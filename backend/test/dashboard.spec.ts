import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, PaymentStatus, PersonStatus, UserRole } from '@prisma/client';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DashboardQueryDto } from '../src/modules/dashboard/dto/dashboard-query.dto.js';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const AS_OF = '2026-06-15T12:00:00.000Z';

describe('Dashboard metrics (FR-DSH-01)', () => {
  let prisma: PrismaClient;
  let service: DashboardService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let collectorA: string;
  let personA: string;
  let personB: string;
  let personB2: string;
  let chargeA: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new DashboardService(prisma as any);

    const tA = await prisma.tenant.create({ data: { name: 'Dash Tenant A', category: 'School' } });
    const tB = await prisma.tenant.create({ data: { name: 'Dash Tenant B', category: 'Gym' } });
    tenantA = tA.id;
    tenantB = tB.id;

    adminA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'admin.a@dash.test',
          passwordHash: 'dummyhash',
          fullName: 'Admin A',
          role: UserRole.ROLE_ADMIN,
        },
      })
    ).id;

    collectorA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'collector.a@dash.test',
          passwordHash: 'dummyhash',
          fullName: 'Collector A',
          role: UserRole.ROLE_COLLECTOR,
        },
      })
    ).id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Person A',
          primaryPhone: '1000000001',
          advanceBalance: BigInt(1000),
          status: PersonStatus.ACTIVE,
        },
      })
    ).id;

    personB = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Person B',
          primaryPhone: '1000000002',
          advanceBalance: BigInt(500),
          status: PersonStatus.INACTIVE,
        },
      })
    ).id;

    personB2 = (
      await prisma.person.create({
        data: {
          tenantId: tenantB,
          fullName: 'Tenant B Person',
          primaryPhone: '2000000001',
          advanceBalance: BigInt(0),
          status: PersonStatus.ACTIVE,
        },
      })
    ).id;

    chargeA = (
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

    await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        collectorUserId: collectorA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(1000),
        allocatedToDues: BigInt(1000),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'pay-today-01',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date(AS_OF),
      },
    });

    await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        collectorUserId: adminA,
        paymentMode: PaymentMode.UPI,
        totalAmount: BigInt(500),
        allocatedToDues: BigInt(500),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'pay-mid-month',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date('2026-06-10T10:00:00.000Z'),
      },
    });

    await prisma.payment.create({
      data: {
        tenantId: tenantA,
        personId: personB,
        collectorUserId: collectorA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(300),
        allocatedToDues: BigInt(300),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'pay-last-month',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date('2026-05-01T10:00:00.000Z'),
      },
    });

    // A payment in tenant B (must not leak into tenant A metrics).
    await prisma.payment.create({
      data: {
        tenantId: tenantB,
        personId: personB2,
        collectorUserId: adminA,
        paymentMode: PaymentMode.CASH,
        totalAmount: BigInt(9999),
        allocatedToDues: BigInt(9999),
        creditedToAdvance: BigInt(0),
        idempotencyKey: 'pay-tenant-b',
        status: PaymentStatus.SUCCESSFUL,
        paymentDate: new Date(AS_OF),
      },
    });

    const payToday = await prisma.payment.findFirst({
      where: { tenantId: tenantA, idempotencyKey: 'pay-today-01' },
    });

    if (payToday) {
      await prisma.refund.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          processedByUserId: adminA,
          refundType: 'DUE_ALLOCATION',
          refundAmount: BigInt(200),
          refundReason: 'Dashboard test refund',
          refundMode: 'CASH',
          paymentId: payToday.id,
        },
      });
    }

    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeA,
        dueDate: new Date('2026-06-15'),
        netAmount: BigInt(200),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(200),
        status: DueStatus.PENDING,
      },
    });

    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeA,
        dueDate: new Date('2026-06-01'),
        netAmount: BigInt(1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(0),
        status: DueStatus.PAID,
      },
    });

    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personB,
        chargeId: chargeA,
        dueDate: new Date('2026-06-01'),
        netAmount: BigInt(500),
        lateFeeAmount: BigInt(10),
        balanceRemaining: BigInt(500),
        status: DueStatus.OVERDUE,
      },
    });

    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personB,
        chargeId: chargeA,
        dueDate: new Date('2026-05-01'),
        netAmount: BigInt(300),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(300),
        status: DueStatus.VOIDED,
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

  it('correctTotals: collection today, month-to-date, all-time and net', async () => {
    const r = await service.getMetrics(tenantA, { asOf: AS_OF });

    // 1 payment on 2026-06-15 (the asOf day).
    expect(r.collection.todayCollectedMinor).toBe('1000');
    expect(r.collection.todayPaymentsCount).toBe(1);
    expect(r.collection.todayAllocatedToDuesMinor).toBe('1000');
    expect(r.collection.todayCreditedToAdvanceMinor).toBe('0');

    // Month-to-date: 1000 (today) + 500 (Jun 10) = 1500.
    expect(r.collection.periodCollectedMinor).toBe('1500');
    expect(r.collection.periodPaymentsCount).toBe(2);

    // All-time gross: 1000 + 500 + 300 = 1800.
    expect(r.collection.allTimeCollectedMinor).toBe('1800');
    // Refund issued: 200.
    expect(r.collection.allTimeRefundsMinor).toBe('200');
    // Net = 1800 - 200.
    expect(r.collection.allTimeNetCollectedMinor).toBe('1600');
  });

  it('correctTotals: dues outstanding, overdue, due-raised-today and counts', async () => {
    const r = await service.getMetrics(tenantA, { asOf: AS_OF });

    // Open dues (PENDING + OVERDUE), excluding PAID and VOIDED.
    // Due1: PENDING balance 200, Due3: OVERDUE balance 500 → 700.
    expect(r.dues.totalOutstandingMinor).toBe('700');
    expect(r.dues.outstandingLateFeeMinor).toBe('10'); // from due3
    expect(r.dues.openDueCount).toBe(2);

    // Overdue = open + dueDate < 2026-06-15 + balance > 0 → only due3 (500).
    expect(r.overdue.totalOverdueMinor).toBe('500');
    expect(r.overdue.overdueDueCount).toBe(1);

    expect(r.dues.paidDueCount).toBe(1);

    // Due raised today (dueDate = 2026-06-15) → due1 only.
    expect(r.dues.dueRaisedTodayMinor).toBe('200');
    expect(r.dues.dueRaisedTodayCount).toBe(1);
  });

  it('correctTotals: people and advance wallet', async () => {
    const r = await service.getMetrics(tenantA, { asOf: AS_OF });

    // personA (ACTIVE) + personB (INACTIVE) → total 2, active 1.
    expect(r.people.total).toBe(2);
    expect(r.people.active).toBe(1);

    // advanceBalance: personA=1000, personB=500 → 1500.
    expect(r.advance.totalHeldMinor).toBe('1500');
  });

  it('datePeriodFiltering: asOf shifts "today" and "current period"', async () => {
    // Anchor to 2026-05-02: month starts May 1, "today" = May 2.
    const r = await service.getMetrics(tenantA, { asOf: '2026-05-02T12:00:00.000Z' });

    // No payment on 2026-05-02 → today collected = 0.
    expect(r.collection.todayCollectedMinor).toBe('0');
    expect(r.collection.todayPaymentsCount).toBe(0);

    // Month-to-date (May 1 – end of May 2): only the May 1 payment (300).
    // Payments on June 10/15 are excluded because the period is capped at the asOf day.
    expect(r.collection.periodCollectedMinor).toBe('300');
    expect(r.collection.periodPaymentsCount).toBe(1);

    // All-time unchanged.
    expect(r.collection.allTimeCollectedMinor).toBe('1800');

    // Overdue: due date 2026-06-01 and 2026-06-15 are both > May 2 "today" → not overdue.
    expect(r.overdue.totalOverdueMinor).toBe('0');
    expect(r.overdue.overdueDueCount).toBe(0);
    // But outstanding still includes open dues.
    expect(r.dues.totalOutstandingMinor).toBe('700');

    // Due raised "today" (2026-05-02) → none.
    expect(r.dues.dueRaisedTodayCount).toBe(0);
  });

  it('emptyResults: a tenant with no data returns all-zero metrics', async () => {
    const emptyTenant = (
      await prisma.tenant.create({ data: { name: 'Empty Tenant', category: 'School' } })
    ).id;

    const r = await service.getMetrics(emptyTenant, { asOf: AS_OF });

    expect(r.collection.todayCollectedMinor).toBe('0');
    expect(r.collection.todayPaymentsCount).toBe(0);
    expect(r.collection.periodCollectedMinor).toBe('0');
    expect(r.collection.allTimeCollectedMinor).toBe('0');
    expect(r.collection.allTimeRefundsMinor).toBe('0');
    expect(r.collection.allTimeNetCollectedMinor).toBe('0');

    expect(r.dues.totalOutstandingMinor).toBe('0');
    expect(r.dues.openDueCount).toBe(0);
    expect(r.overdue.totalOverdueMinor).toBe('0');
    expect(r.overdue.overdueDueCount).toBe(0);
    expect(r.dues.paidDueCount).toBe(0);
    expect(r.dues.dueRaisedTodayMinor).toBe('0');

    expect(r.people.total).toBe(0);
    expect(r.people.active).toBe(0);
    expect(r.advance.totalHeldMinor).toBe('0');

    await prisma.tenant.delete({ where: { id: emptyTenant } });
  });

  it('tenantIsolation: tenant B metrics do not include tenant A data', async () => {
    const rB = await service.getMetrics(tenantB, { asOf: AS_OF });

    // Tenant B has 1 payment of 9999 but no refunds/dues.
    expect(rB.collection.todayCollectedMinor).toBe('9999');
    expect(rB.collection.allTimeRefundsMinor).toBe('0');
    expect(rB.dues.totalOutstandingMinor).toBe('0');
    expect(rB.people.total).toBe(1);
  });

  it('defaultsAsOf: with no asOf, uses the server current date', async () => {
    const r = await service.getMetrics(tenantA);

    // The current UTC day. We can't assert exact today-totals without
    // controlling time, but the all-time aggregate is independent of asOf.
    expect(r.collection.allTimeCollectedMinor).toBe('1800');
    expect(r.collection.allTimeRefundsMinor).toBe('200');
  });
});

describe('Dashboard RBAC and JWT tenant scoping', () => {
  const TENANT_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TENANT_B = 'bbbbbbbb-2222-2222-2222-222222222222';

  const admin = {
    sub: 'u-admin',
    tenantId: TENANT_A,
    email: 'a@a.com',
    role: UserRole.ROLE_ADMIN,
  } as JwtPayload;

  it('scopes getMetrics to the JWT tenant, ignoring the URL path tenant', async () => {
    const controller = new DashboardController({} as any);
    const seen: string[] = [];

    (controller as any).dashboardService = {
      getMetrics: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
    };

    // The :tenantId path segment is never passed by the controller.
    await controller.getMetrics(admin, { asOf: AS_OF } as any);

    expect(seen).toEqual([TENANT_A]);
    expect(seen).not.toContain(TENANT_B);
  });

  it('declares no @Roles restriction (dashboard:view is ALLOW-all)', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      DashboardController.prototype.getMetrics,
    );
    expect(roles).toBeUndefined();
  });

  it('never passes an undefined tenantId to the service', async () => {
    const controller = new DashboardController({} as any);
    const seen: { tenantId: string }[] = [];

    (controller as any).dashboardService = {
      getMetrics: async (tenantId: string) => {
        seen.push({ tenantId });
        return null;
      },
    };

    await controller.getMetrics(admin, { asOf: AS_OF } as any);

    expect(seen[0].tenantId).toBeDefined();
    expect(seen[0].tenantId).not.toBe('');
  });
});

describe('Dashboard input validation (DashboardQueryDto)', () => {
  it('accepts a valid asOf date string', () => {
    const dto = plainToInstance(DashboardQueryDto, { asOf: '2026-06-15' });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });

  it('accepts an empty query object (asOf is optional)', () => {
    const dto = plainToInstance(DashboardQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a malformed asOf date', () => {
    const dto = plainToInstance(DashboardQueryDto, { asOf: 'not-a-date' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects a non-whitelisted field', () => {
    const dto = plainToInstance(DashboardQueryDto, { asOf: '2026-06-15', injected: true });
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length,
    ).toBeGreaterThan(0);
  });
});
