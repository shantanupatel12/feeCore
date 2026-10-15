import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import {
  PrismaClient,
  DueStatus,
  PaymentMode,
  PaymentStatus,
  RefundType,
  UserRole,
} from '@prisma/client';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { RefundsService } from '../src/modules/refunds/refunds.service.js';
import { RefundsController } from '../src/modules/refunds/refunds.controller.js';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

describe('V1.11: Refund Flow A (allocation -> refund -> due -> ledger)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let refunds: RefundsService;
  let duesService: DuesService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;
  let personB: string;
  let chargeA: string;

  let keySeq = 0;
  const nextKey = () => `refund-key-${Date.now()}-${keySeq++}`;

  /** Creates a due, pays it, and returns the resulting allocation. */
  async function paidAllocation(opts?: {
    tenantId?: string;
    personId?: string;
    net?: bigint;
    pay?: string;
    dueDate?: Date;
  }) {
    const due = await prisma.due.create({
      data: {
        tenantId: opts?.tenantId ?? tenantA,
        personId: opts?.personId ?? personA,
        chargeId: chargeA,
        dueDate: opts?.dueDate ?? new Date('2026-06-01'),
        netAmount: BigInt(opts?.net ?? 1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(opts?.net ?? 1000),
        status: DueStatus.PENDING,
      },
    });

    const paid = await payments.collectPayment(
      opts?.tenantId ?? tenantA,
      adminA,
      {
        dueId: due.id,
        amountMinor: opts?.pay ?? String(opts?.net ?? 1000),
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      },
    );

    return {
      dueId: due.id,
      allocationId: paid.allocation.id,
      paymentId: paid.payment.id,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({
      data: { name: 'Refund Tenant A', category: 'School' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Refund Tenant B', category: 'School' },
    });
    tenantB = tB.id;

    const u = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@refunds.test',
        passwordHash: 'dummyhash',
        fullName: 'Admin A',
        role: 'ROLE_ADMIN',
      },
    });
    adminA = u.id;

    const pA = await prisma.person.create({
      data: {
        tenantId: tenantA,
        fullName: 'Refund Person A',
        primaryPhone: '9100000001',
        advanceBalance: BigInt(0),
      },
    });
    personA = pA.id;

    const pB = await prisma.person.create({
      data: {
        tenantId: tenantB,
        fullName: 'Refund Person B',
        primaryPhone: '9100000002',
        advanceBalance: BigInt(0),
      },
    });
    personB = pB.id;

    const charge = await prisma.charge.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        category: 'TUITION',
        baseAmount: BigInt(1000),
        discountAmount: BigInt(0),
        createdByUserId: adminA,
      },
    });
    chargeA = charge.id;

    payments = new PaymentsService(prisma as any);
    duesService = new DuesService(prisma as any);
    refunds = new RefundsService(prisma as any, duesService);
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    for (const t of both) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      // Receipts RESTRICT deletion of their payment (V1.12).
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
    }

    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });

    for (const t of both) {
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }

    await prisma.$disconnect();
  });

  it('1. valid partial refund restores the due balance', async () => {
    const ctx = await paidAllocation({ net: 1000, pay: '1000' });

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: ctx.allocationId,
      refundAmountMinor: '250',
      refundMode: 'CASH',
      refundReason: 'Course cancelled',
    });

    expect(res.refund.refundAmountMinor).toBe('250');
    expect(res.due.balanceRemainingMinor).toBe('250');
    expect(res.allocation.refundedAmountMinor).toBe('250');

    const due = await prisma.due.findUnique({ where: { id: ctx.dueId } });
    expect(due!.balanceRemaining).toBe(BigInt(250));
  });

  it('2. valid full refund restores the entire balance', async () => {
    const ctx = await paidAllocation({ net: 800, pay: '800' });

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: ctx.allocationId,
      refundAmountMinor: '800',
      refundMode: 'BANK_TRANSFER',
      refundReason: 'Full reversal',
    });

    expect(res.due.balanceRemainingMinor).toBe('800');
    expect(res.paymentStatus).toBe(PaymentStatus.FULLY_REFUNDED);
  });

  it('3. partial refund marks the payment partially refunded', async () => {
    const ctx = await paidAllocation({ net: 900, pay: '900' });

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: ctx.allocationId,
      refundAmountMinor: '100',
      refundMode: 'UPI',
      refundReason: 'Partial waiver',
    });

    expect(res.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it('4. regresses a paid due away from PAID, using the existing status rules', async () => {
    // Future due date => regression to PENDING (nothing paid back).
    const future = await paidAllocation({
      net: 500,
      pay: '500',
      dueDate: new Date('2099-06-01'),
    });

    const beforeDue = await prisma.due.findUnique({
      where: { id: future.dueId },
    });
    expect(beforeDue!.status).toBe(DueStatus.PAID);

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: future.allocationId,
      refundAmountMinor: '500',
      refundMode: 'CASH',
      refundReason: 'Reversal',
    });

    // DuesService.evaluateStatus: balance == netAmount => PENDING.
    expect(res.due.status).toBe(DueStatus.PENDING);
  });

  it('4b. regresses to OVERDUE when the due date has already passed', async () => {
    const past = await paidAllocation({
      net: 500,
      pay: '500',
      dueDate: new Date('2020-01-01'),
    });

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: past.allocationId,
      refundAmountMinor: '200',
      refundMode: 'CASH',
      refundReason: 'Partial reversal on an old due',
    });

    // today > dueDate => OVERDUE per BR-REF-001 step 4.
    expect(res.due.status).toBe(DueStatus.OVERDUE);
  });

  it('5. rejects an over-refund and leaves no partial writes', async () => {
    const ctx = await paidAllocation({ net: 400, pay: '400' });

    const beforeRefunds = await prisma.refund.count();
    const beforeLedger =
      await prisma.financialTransactionLog.count({
        where: { tenantId: tenantA },
      });

    await expect(
      refunds.refundAllocation(tenantA, adminA, {
        paymentAllocationId: ctx.allocationId,
        refundAmountMinor: '9999',
        refundMode: 'CASH',
        refundReason: 'Too much',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.refund.count()).toBe(beforeRefunds);
    expect(
      await prisma.financialTransactionLog.count({
        where: { tenantId: tenantA },
      }),
    ).toBe(beforeLedger);

    const due = await prisma.due.findUnique({ where: { id: ctx.dueId } });
    expect(due!.balanceRemaining).toBe(BigInt(0));

    const alloc = await prisma.paymentAllocation.findUnique({
      where: { id: ctx.allocationId },
    });
    expect(alloc!.refundedAmount).toBe(BigInt(0));
  });

  it('6. rejects a cumulative over-refund after a partial one', async () => {
    const ctx = await paidAllocation({ net: 600, pay: '600' });

    await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: ctx.allocationId,
      refundAmountMinor: '400',
      refundMode: 'CASH',
      refundReason: 'First',
    });

    // Only 200 remains refundable.
    await expect(
      refunds.refundAllocation(tenantA, adminA, {
        paymentAllocationId: ctx.allocationId,
        refundAmountMinor: '250',
        refundMode: 'CASH',
        refundReason: 'Second, too large',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const alloc = await prisma.paymentAllocation.findUnique({
      where: { id: ctx.allocationId },
    });
    expect(alloc!.refundedAmount).toBe(BigInt(400));
  });

  it('7. rejects zero, negative and malformed refund amounts', async () => {
    const ctx = await paidAllocation({ net: 300, pay: '300' });

    for (const refundAmountMinor of ['0', '-100', 'abc']) {
      await expect(
        refunds.refundAllocation(tenantA, adminA, {
          paymentAllocationId: ctx.allocationId,
          refundAmountMinor,
          refundMode: 'CASH',
          refundReason: 'Invalid',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const alloc = await prisma.paymentAllocation.findUnique({
      where: { id: ctx.allocationId },
    });
    expect(alloc!.refundedAmount).toBe(BigInt(0));
  });

  it('8. rejects a cross-tenant allocation refund', async () => {
    const ctx = await paidAllocation({
      tenantId: tenantB,
      personId: personB,
      net: 700,
      pay: '700',
    });

    const beforeRefunds = await prisma.refund.count();

    await expect(
      refunds.refundAllocation(tenantA, adminA, {
        paymentAllocationId: ctx.allocationId,
        refundAmountMinor: '100',
        refundMode: 'CASH',
        refundReason: 'Cross tenant',
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    expect(await prisma.refund.count()).toBe(beforeRefunds);
  });

  it('9. rejects a nonexistent allocation', async () => {
    await expect(
      refunds.refundAllocation(tenantA, adminA, {
        paymentAllocationId:
          '00000000-0000-0000-0000-000000000000',
        refundAmountMinor: '100',
        refundMode: 'CASH',
        refundReason: 'Ghost',
      }),
    ).rejects.toThrow(/not found in this tenant/i);
  });

  it('10. writes a DUE_ALLOCATION_REFUND ledger entry', async () => {
    const ctx = await paidAllocation({ net: 450, pay: '450' });

    const res = await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: ctx.allocationId,
      refundAmountMinor: '150',
      refundMode: 'CASH',
      refundReason: 'Ledger check',
    });

    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.refund.id,
      },
    });

    expect(log).not.toBeNull();
    expect(log!.eventType).toBe('DUE_ALLOCATION_REFUND');
    expect(log!.amount).toBe(BigInt(150));
    expect(log!.balanceSnapshot).toBe(BigInt(150));

    const refund = await prisma.refund.findUnique({
      where: { id: res.refund.id },
    });
    expect(refund!.refundType).toBe('DUE_ALLOCATION');
    expect(refund!.paymentId).toBe(ctx.paymentId);
  });
});

describe('V1.30: refund status persistence uses the tenant calendar date', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let duesService: DuesService;
  let refunds: RefundsService;

  let tenantIds: string[] = [];
  let phoneSeq = 0;
  let keySeq = 0;
  const nextKey = () => `tz-refund-${Date.now()}-${keySeq++}`;

  /**
   * 2026-06-15T18:30Z is 2026-06-15 in UTC but already 2026-06-16 in
   * Asia/Kolkata (+5:30). A Due dated 2026-06-15 with a positive balance is
   * therefore overdue for the IST tenant and merely due-today for the UTC
   * tenant — the exact boundary where a UTC fallback in the refund path
   * disagrees with the dues read endpoints. Only `Date` is faked, so Prisma's
   * sockets stay real.
   */
  const INSTANT = new Date('2026-06-15T18:30:00Z');

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    payments = new PaymentsService(prisma as any);
    duesService = new DuesService(prisma as any);
    refunds = new RefundsService(prisma as any, duesService);
  });

  afterAll(async () => {
    for (const t of tenantIds) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.due.deleteMany({ where: { tenantId: t } });
      await prisma.charge.deleteMany({ where: { tenantId: t } });
      await prisma.lateFeeRule.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  /**
   * Builds a fully paid Due dated `dueDate` and refunds part of it, then
   * returns both the persisted column and what every read endpoint reports.
   */
  async function refundOn(timezone: string, email: string) {
    const tenant = await prisma.tenant.create({
      data: { name: `TZ Refund ${timezone}`, category: 'School', timezone },
    });
    tenantIds.push(tenant.id);

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash: 'x',
        fullName: email,
        role: 'ROLE_ADMIN',
      },
    });
    const person = await prisma.person.create({
      data: {
        tenantId: tenant.id,
        fullName: `TZ Person ${timezone}`,
        primaryPhone: `+9155${String(phoneSeq++).padStart(6, '0')}`,
      },
    });
    const charge = await prisma.charge.create({
      data: {
        tenantId: tenant.id,
        personId: person.id,
        category: 'TUITION',
        baseAmount: BigInt(1000),
        createdByUserId: user.id,
      },
    });
    const due = await prisma.due.create({
      data: {
        tenantId: tenant.id,
        personId: person.id,
        chargeId: charge.id,
        dueDate: new Date('2026-06-15'),
        netAmount: BigInt(1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(1000),
        status: DueStatus.PENDING,
      },
    });
    const paid = await payments.collectPayment(tenant.id, user.id, {
      dueId: due.id,
      amountMinor: '1000',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const result = await refunds.refundAllocation(tenant.id, user.id, {
      paymentAllocationId: paid.allocation.id,
      refundAmountMinor: '200',
      refundMode: 'CASH',
      refundReason: 'timezone boundary check',
    });

    const stored = await prisma.due.findUniqueOrThrow({ where: { id: due.id } });
    return {
      persisted: stored.status,
      fromRefund: result.due.status,
      fromDetail: (await duesService.findOne(tenant.id, due.id)).status,
      fromList: (await duesService.findAll(tenant.id, {})).items.find(
        (d: any) => d.id === due.id,
      )!.status,
      overdueListTotal: (await duesService.findAll(tenant.id, { status: DueStatus.OVERDUE }))
        .total,
    };
  }

  it('persists OVERDUE for the IST tenant on the same instant that is not yet overdue for the UTC tenant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSTANT);
    try {
      const ist = await refundOn('Asia/Kolkata', 'ist@refundtz.test');
      const utc = await refundOn('UTC', 'utc@refundtz.test');

      // The refund response, the stored column and every read endpoint agree.
      expect(ist.fromRefund).toBe(DueStatus.OVERDUE);
      expect(ist.persisted).toBe(DueStatus.OVERDUE);
      expect(ist.fromDetail).toBe(DueStatus.OVERDUE);
      expect(ist.fromList).toBe(DueStatus.OVERDUE);
      expect(ist.overdueListTotal).toBe(1);

      // Local day is still 2026-06-15 in UTC, so the Due is due-today, not
      // overdue. A UTC fallback cannot express this and is what leaked before.
      expect(utc.fromRefund).toBe(DueStatus.PARTIALLY_PAID);
      expect(utc.persisted).toBe(DueStatus.PARTIALLY_PAID);
      expect(utc.fromDetail).toBe(DueStatus.PARTIALLY_PAID);
      expect(utc.fromList).toBe(DueStatus.PARTIALLY_PAID);
      expect(utc.overdueListTotal).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 60000);

  it('never persists a status that GET /dues contradicts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSTANT);
    try {
      for (const timezone of ['Asia/Kolkata', 'UTC', 'America/New_York']) {
        const seen = await refundOn(timezone, `${timezone.replace(/\W/g, '')}@refundtz.test`);
        expect(seen.persisted, timezone).toBe(seen.fromDetail);
        expect(seen.persisted, timezone).toBe(seen.fromList);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 60000);
});

describe('V1.11b: Refund Flow B (advance wallet -> refund -> ledger)', () => {
  let prisma: PrismaClient;
  let refunds: RefundsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;
  let personB: string;

  /** Seeds a wallet balance and returns the person id. */
  async function seedWallet(
    tenantId: string,
    personId: string,
    balance: bigint,
  ) {
    await prisma.person.update({
      where: { id: personId },
      data: { advanceBalance: balance },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    refunds = new RefundsService(
      prisma as any,
      new DuesService(prisma as any),
    );

    const tA = await prisma.tenant.create({
      data: { name: 'Flow B Tenant A', category: 'School' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Flow B Tenant B', category: 'School' },
    });
    tenantB = tB.id;

    adminA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          email: 'flowb-admin@refunds.test',
          passwordHash: 'dummyhash',
          fullName: 'Flow B Admin',
          role: 'ROLE_ADMIN',
        },
      })
    ).id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Flow B Person A',
          primaryPhone: '9110000001',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    personB = (
      await prisma.person.create({
        data: {
          tenantId: tenantB,
          fullName: 'Flow B Person B',
          primaryPhone: '9110000002',
          advanceBalance: BigInt(0),
        },
      })
    ).id;
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.refund.deleteMany({ where: { tenantId: { in: both } } });
    for (const t of both) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. refunds part of the wallet and debits the balance', async () => {
    await seedWallet(tenantA, personA, BigInt(5000));

    const res = await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '2000',
      refundMode: 'CASH',
      refundReason: 'Customer moving away',
    });

    expect(res.refund.refundAmountMinor).toBe('2000');
    expect(res.person.advanceBalanceMinor).toBe('3000');

    const stored = await prisma.person.findUnique({ where: { id: personA } });
    expect(stored!.advanceBalance).toBe(BigInt(3000));
  });

  it('2. refunds the wallet down to exactly zero', async () => {
    await seedWallet(tenantA, personA, BigInt(2500));

    const res = await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '2500',
      refundMode: 'BANK_TRANSFER',
      refundReason: 'Full deposit return',
    });

    expect(res.person.advanceBalanceMinor).toBe('0');
    expect(res.refund.refundAmountMinor).toBe('2500');
  });

  it('3. never creates money: cumulative refunds cannot exceed the wallet', async () => {
    await seedWallet(tenantA, personA, BigInt(1000));

    await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '600',
      refundMode: 'CASH',
      refundReason: 'First tranche',
    });

    await expect(
      refunds.refundAdvance(tenantA, adminA, {
        personId: personA,
        refundAmountMinor: '500', // only 400 left
        refundMode: 'CASH',
        refundReason: 'Over-refund attempt',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const stored = await prisma.person.findUnique({ where: { id: personA } });
    expect(stored!.advanceBalance).toBe(BigInt(400));
  });

  it('4. rejects zero, negative and malformed amounts atomically', async () => {
    await seedWallet(tenantA, personA, BigInt(1000));

    for (const refundAmountMinor of ['0', '-5', 'abc']) {
      await expect(
        refunds.refundAdvance(tenantA, adminA, {
          personId: personA,
          refundAmountMinor,
          refundMode: 'CASH',
          refundReason: 'Malformed',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const stored = await prisma.person.findUnique({ where: { id: personA } });
    expect(stored!.advanceBalance).toBe(BigInt(1000));
  });

  it('5. rejects a cross-tenant wallet refund', async () => {
    await seedWallet(tenantB, personB, BigInt(4000));

    await expect(
      refunds.refundAdvance(tenantA, adminA, {
        personId: personB, // belongs to Tenant B
        refundAmountMinor: '1000',
        refundMode: 'CASH',
        refundReason: 'Cross tenant attempt',
      }),
    ).rejects.toThrow();

    const stored = await prisma.person.findUnique({ where: { id: personB } });
    expect(stored!.advanceBalance).toBe(BigInt(4000));

    const leaked = await prisma.refund.count({ where: { tenantId: tenantB } });
    expect(leaked).toBe(0);
  });

  it('6. rejects a refund when the wallet is already empty', async () => {
    await seedWallet(tenantA, personA, BigInt(0));

    await expect(
      refunds.refundAdvance(tenantA, adminA, {
        personId: personA,
        refundAmountMinor: '1',
        refundMode: 'CASH',
        refundReason: 'Nothing to return',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('7. touches no Due, Payment or Allocation (flow segregation)', async () => {
    await seedWallet(tenantA, personA, BigInt(900));

    const duesBefore = await prisma.due.count({ where: { tenantId: tenantA } });
    const paysBefore = await prisma.payment.count({ where: { tenantId: tenantA } });
    const allocsBefore = await prisma.paymentAllocation.count({
      where: { tenantId: tenantA },
    });

    await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '400',
      refundMode: 'CASH',
      refundReason: 'Segregation check',
    });

    expect(await prisma.due.count({ where: { tenantId: tenantA } })).toBe(duesBefore);
    expect(await prisma.payment.count({ where: { tenantId: tenantA } })).toBe(paysBefore);
    expect(
      await prisma.paymentAllocation.count({ where: { tenantId: tenantA } }),
    ).toBe(allocsBefore);

    const row = await prisma.refund.findFirst({
      where: { tenantId: tenantA, refundType: 'ADVANCE_WALLET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row!.paymentId).toBeNull();
    expect(row!.paymentAllocationId).toBeNull();
  });

  it('8. writes an ADVANCE_WALLET_REFUND ledger entry', async () => {
    await seedWallet(tenantA, personA, BigInt(700));

    const res = await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '300',
      refundMode: 'UPI',
      refundReason: 'Ledger check',
    });

    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.refund.id,
      },
    });

    expect(log).not.toBeNull();
    expect(log!.eventType).toBe('ADVANCE_WALLET_REFUND');
    expect(log!.amount).toBe(BigInt(300));
    expect(log!.balanceSnapshot).toBe(BigInt(400));
  });

  it('9. a failed refund leaves neither a Refund row nor a ledger entry', async () => {
    await seedWallet(tenantA, personA, BigInt(300));

    const refundsBefore = await prisma.refund.count({ where: { tenantId: tenantA } });
    const logsBefore = await prisma.financialTransactionLog.count({
      where: { tenantId: tenantA },
    });

    await expect(
      refunds.refundAdvance(tenantA, adminA, {
        personId: personA,
        refundAmountMinor: '999999',
        refundMode: 'CASH',
        refundReason: 'Over-refund rollback',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.refund.count({ where: { tenantId: tenantA } })).toBe(refundsBefore);
    expect(
      await prisma.financialTransactionLog.count({ where: { tenantId: tenantA } }),
    ).toBe(logsBefore);

    const stored = await prisma.person.findUnique({ where: { id: personA } });
    expect(stored!.advanceBalance).toBe(BigInt(300));
  });

  it('10. stores the mandatory reason and mode', async () => {
    await seedWallet(tenantA, personA, BigInt(500));

    const res = await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '100',
      refundMode: 'CHEQUE',
      refundReason: 'Cheque 000123',
      referenceNumber: 'CHQ-000123',
    });

    const row = await prisma.refund.findUnique({ where: { id: res.refund.id } });
    expect(row!.refundReason).toBe('Cheque 000123');
    expect(row!.refundMode).toBe('CHEQUE');
    expect(row!.referenceNumber).toBe('CHQ-000123');
  });

  it('11. retrieves a refund by id and rejects a cross-tenant read', async () => {
    await seedWallet(tenantA, personA, BigInt(800));

    const res = await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '200',
      refundMode: 'CASH',
      refundReason: 'Retrieval check',
    });

    const got = await refunds.getRefund(tenantA, res.refund.id);
    expect(got.id).toBe(res.refund.id);
    expect(got.refundType).toBe('ADVANCE_WALLET');
    expect(got.refundAmountMinor).toBe('200');
    expect(got.personId).toBe(personA);

    // Real id, wrong tenant.
    await expect(refunds.getRefund(tenantB, res.refund.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      refunds.getRefund(
        tenantA,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('12. lists only the calling tenant refunds, newest first', async () => {
    await seedWallet(tenantA, personA, BigInt(600));
    await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '100',
      refundMode: 'CASH',
      refundReason: 'List check',
    });

    const listA = await refunds.listRefunds(tenantA);
    const listB = await refunds.listRefunds(tenantB);

    expect(listA.total).toBeGreaterThan(0);
    expect(listB.total).toBe(0);
    expect(listB.items).toHaveLength(0);

    const persisted = await prisma.refund.findMany({
      where: { id: { in: listA.items.map((r) => r.id) } },
    });
    expect(persisted.every((r) => r.tenantId === tenantA)).toBe(true);

    const created = listA.items.map((r) => new Date(r.createdAt).getTime());
    for (let i = 1; i < created.length; i++) {
      expect(created[i]).toBeLessThanOrEqual(created[i - 1]);
    }

    // Filter by person and by refund type.
    const byPerson = await refunds.listRefunds(tenantA, { personId: personA });
    expect(byPerson.total).toBeGreaterThan(0);
    expect(byPerson.items.every((r) => r.personId === personA)).toBe(true);

    const byType = await refunds.listRefunds(tenantA, {
      refundType: 'ADVANCE_WALLET',
    });
    expect(byType.items.every((r) => r.refundType === 'ADVANCE_WALLET')).toBe(true);

    // Paginated.
    const paged = await refunds.listRefunds(tenantA, { page: 1, limit: 1 });
    expect(paged.items.length).toBeLessThanOrEqual(1);
    expect(paged.totalPages).toBe(Math.ceil(paged.total / 1));
  });
});

describe('V1.11c: Refunds RBAC and JWT tenant scoping', () => {
  const tenantA = 'aaaaaaaa-1111-1111-1111-111111111111';
  const tenantB = 'bbbbbbbb-2222-2222-2222-222222222222';

  const admin = {
    sub: 'u-admin',
    tenantId: tenantA,
    email: 'a@a.com',
    role: UserRole.ROLE_ADMIN,
  } as JwtPayload;

  const collector = {
    sub: 'u-collector',
    tenantId: tenantA,
    email: 'c@a.com',
    role: UserRole.ROLE_COLLECTOR,
  } as JwtPayload;

  it('derives the tenant from the JWT for both refund flows', async () => {
    const controller = new RefundsController({} as any);
    const seen: string[] = [];

    (controller as any).refundsService = {
      refundAllocation: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
      refundAdvance: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
    };

    // The URL path claims tenant B in every call.
    await controller.refundAllocation(
      admin,
      { paymentAllocationId: 'a' } as any,
    );
    await controller.refundAdvance(admin, { personId: 'p' } as any);

    // The JWT tenant must win over the request.
    expect(seen).toEqual([tenantA, tenantA]);
    expect(seen).not.toContain(tenantB);
  });

  it('derives the tenant from the JWT for read routes', async () => {
    const controller = new RefundsController({} as any);
    const seen: string[] = [];

    (controller as any).refundsService = {
      getRefund: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
      listRefunds: async (tenantId: string) => {
        seen.push(tenantId);
        return null;
      },
    };

    await controller.getRefund(admin, 'some-id');
    await controller.listRefunds(collector, undefined, undefined, undefined, 1, 10);

    expect(seen).toEqual([tenantA, tenantA]);
    expect(seen).not.toContain(tenantB);
  });

  it('restricts both refund writes to ROLE_ADMIN (Collector is denied)', () => {
    const rolesOn = (handler: string) =>
      Reflect.getMetadata(ROLES_KEY, RefundsController.prototype[handler]);

    // BR-14: Collector blocked from refunds.
    expect(rolesOn('refundAllocation')).toEqual([UserRole.ROLE_ADMIN]);
    expect(rolesOn('refundAdvance')).toEqual([UserRole.ROLE_ADMIN]);
    expect(rolesOn('refundAllocation')).not.toContain(UserRole.ROLE_COLLECTOR);

    // `refunds:view` is ALLOW for every role, so read routes narrow nothing.
    expect(rolesOn('getRefund')).toBeUndefined();
    expect(rolesOn('listRefunds')).toBeUndefined();
  });
});