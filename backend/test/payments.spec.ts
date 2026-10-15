import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'vitest';
import {
  PrismaClient,
  DueStatus,
  PaymentMode,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { AdvanceWalletService } from '../src/modules/payments/services/advance-wallet.service.js';
import { LateFeeService } from '../src/modules/payments/services/late-fee.service.js';

describe('V1.10: Payment Collection & Core Capabilities Test Suite', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let advanceWallet: AdvanceWalletService;
  let lateFees: LateFeeService;

  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let adminA: string;
  let personA: string;
  let personB: string;
  let personC: string;
  let chargeA: string;

  let keySeq = 0;
  const nextKey = () => `pay-key-${Date.now()}-${keySeq++}`;

  async function makeDue(opts?: {
    tenantId?: string;
    personId?: string;
    chargeId?: string;
    net?: bigint;
    lateFee?: bigint;
    balance?: bigint;
    status?: DueStatus;
    dueDate?: Date;
  }) {
    return prisma.due.create({
      data: {
        tenantId: opts?.tenantId ?? tenantA,
        personId: opts?.personId ?? personA,
        chargeId: opts?.chargeId ?? chargeA,
        dueDate: opts?.dueDate ?? new Date('2026-01-15'),
        netAmount: opts?.net ?? BigInt(1000),
        lateFeeAmount: opts?.lateFee ?? BigInt(0),
        balanceRemaining: opts?.balance ?? BigInt(1000),
        status: opts?.status ?? DueStatus.PENDING,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    payments = new PaymentsService(prisma as any);
    advanceWallet = new AdvanceWalletService(prisma as any);
    lateFees = new LateFeeService(prisma as any);

    const tA = await prisma.tenant.create({
      data: { name: 'Payments Tenant A', category: 'School' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Payments Tenant B', category: 'School' },
    });
    tenantB = tB.id;

    const uA = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'collector.a@payments.test',
        passwordHash: 'dummyhash',
        fullName: 'Collector A',
        role: 'ROLE_COLLECTOR',
      },
    });
    userA = uA.id;

    const adm = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@payments.test',
        passwordHash: 'dummyhash',
        fullName: 'Admin A',
        role: 'ROLE_ADMIN',
      },
    });
    adminA = adm.id;

    const pA = await prisma.person.create({
      data: {
        tenantId: tenantA,
        fullName: 'Person A',
        primaryPhone: '9000000001',
        advanceBalance: BigInt(0),
      },
    });
    personA = pA.id;

    const pB = await prisma.person.create({
      data: {
        tenantId: tenantB,
        fullName: 'Person B',
        primaryPhone: '9000000002',
        advanceBalance: BigInt(0),
      },
    });
    personB = pB.id;

    const pC = await prisma.person.create({
      data: {
        tenantId: tenantA,
        fullName: 'Person C',
        primaryPhone: '9000000003',
        advanceBalance: BigInt(0),
      },
    });
    personC = pC.id;

    const charge = await prisma.charge.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        category: 'TUITION',
        baseAmount: BigInt(1000),
        discountAmount: BigInt(0),
        createdByUserId: userA,
      },
    });
    chargeA = charge.id;
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    // Children first, across BOTH tenants, because the
    // cross-tenant due in test 6 references tenant A's charge.
    for (const t of both) {
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      // Receipts RESTRICT deletion of their payment (V1.12).
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
    }

    await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });

    for (const t of both) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }

    await prisma.$disconnect();
  });

  // -------------------------------------------------------------
  // Baseline Single-Due Payment Tests (Preserved 1-10)
  // -------------------------------------------------------------

  it('1. records a principal-only payment and reduces the balance', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });

    const res = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '400',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    expect(res.payment.totalAmountMinor).toBe('400');
    expect(res.allocation!.allocatedPrincipalMinor).toBe('400');
    expect(res.allocation!.allocatedLateFeeMinor).toBe('0');
    expect(res.due!.balanceRemainingMinor).toBe('600');

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.balanceRemaining).toBe(BigInt(600));
    expect(stored!.status).toBe(DueStatus.PARTIALLY_PAID);
  });

  it('2. applies principal before late fee when funds cover both', async () => {
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(200),
    });

    const res = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '1100',
      paymentMode: PaymentMode.UPI,
      idempotencyKey: nextKey(),
    });

    // Principal must be cleared before any late fee is touched.
    expect(res.allocation!.allocatedPrincipalMinor).toBe('1000');
    expect(res.allocation!.allocatedLateFeeMinor).toBe('100');
    expect(res.due!.balanceRemainingMinor).toBe('0');
  });

  it('3. full payment sets the due to PAID and never overshoots zero', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });

    const res = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '1000',
      paymentMode: PaymentMode.CARD,
      idempotencyKey: nextKey(),
    });

    expect(res.due!.status).toBe(DueStatus.PAID);
    expect(res.due!.balanceRemainingMinor).toBe('0');

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.status).toBe(DueStatus.PAID);
    expect(stored!.balanceRemaining).toBe(BigInt(0));
  });

  it('4. persists the principal/late-fee split on the allocation row', async () => {
    const due = await makeDue({
      net: BigInt(500),
      balance: BigInt(500),
      lateFee: BigInt(250),
    });

    const res = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '600',
      paymentMode: PaymentMode.BANK_TRANSFER,
      idempotencyKey: nextKey(),
    });

    const row = await prisma.paymentAllocation.findUnique({
      where: { id: res.allocation!.id },
    });

    expect(row!.allocatedPrincipal).toBe(BigInt(500));
    expect(row!.allocatedLateFee).toBe(BigInt(100));
    expect(row!.totalAllocated).toBe(BigInt(600));
    expect(res.payment.creditedToAdvanceMinor).toBe('0');
  });

  it('5. rejects a payment against a VOIDED due', async () => {
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      status: DueStatus.VOIDED,
    });

    await expect(
      payments.collectPayment(tenantA, userA, {
        dueId: due.id,
        amountMinor: '100',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.balanceRemaining).toBe(BigInt(1000));
    expect(stored!.status).toBe(DueStatus.VOIDED);
  });

  it('6. rejects a payment against another tenant due', async () => {
    const due = await makeDue({
      tenantId: tenantB,
      personId: personB,
      net: BigInt(1000),
      balance: BigInt(1000),
    });

    await expect(
      payments.collectPayment(tenantA, userA, {
        dueId: due.id,
        amountMinor: '100',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    const paymentsForB = await prisma.payment.count({
      where: { tenantId: tenantB },
    });
    expect(paymentsForB).toBe(0);
  });

  it('7. rejects overpayment and leaves no partial writes', async () => {
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(0),
    });

    // Scoped to this tenant: spec files share one database, so an
    // unscoped count also sees rows written by other suites.
    const before = await prisma.payment.count({
      where: { tenantId: tenantA },
    });
    const beforeAllocs = await prisma.paymentAllocation.count({
      where: { tenantId: tenantA },
    });

    await expect(
      payments.collectPayment(tenantA, userA, {
        dueId: due.id,
        amountMinor: '5000',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.payment.count({ where: { tenantId: tenantA } })).toBe(
      before,
    );
    expect(
      await prisma.paymentAllocation.count({ where: { tenantId: tenantA } }),
    ).toBe(beforeAllocs);

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.balanceRemaining).toBe(BigInt(1000));
  });

  it('8. rejects a zero or malformed amount atomically', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });

    for (const amountMinor of ['0', '-5', 'abc']) {
      await expect(
        payments.collectPayment(tenantA, userA, {
          dueId: due.id,
          amountMinor,
          paymentMode: PaymentMode.CASH,
          idempotencyKey: nextKey(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.balanceRemaining).toBe(BigInt(1000));
  });

  it('9. a failed allocation rolls back the ledger entry too', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });
    const beforeLedger = await prisma.financialTransactionLog.count({
      where: { tenantId: tenantA },
    });

    await expect(
      payments.collectPayment(tenantA, userA, {
        dueId: due.id,
        amountMinor: '999999',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const afterLedger = await prisma.financialTransactionLog.count({
      where: { tenantId: tenantA },
    });
    expect(afterLedger).toBe(beforeLedger);
  });

  it('10. writes a PAYMENT_COLLECTED ledger entry on success', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });

    const res = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '250',
      paymentMode: PaymentMode.CASH,
      referenceNumber: 'REF-1',
      idempotencyKey: nextKey(),
    });

    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.payment.id,
      },
    });

    expect(log).not.toBeNull();
    expect(log!.eventType).toBe('PAYMENT_COLLECTED');
    expect(log!.amount).toBe(BigInt(250));
    expect(log!.balanceSnapshot).toBe(BigInt(750));
  });

  // -------------------------------------------------------------
  // Capability 1: Multiple-Charge Payment (FR-PAY-03 / BR-PAY-003)
  // -------------------------------------------------------------

  it('11. records a multiple-charge payment across multiple dues atomically with Principal-First on each due', async () => {
    const due1 = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(200),
    });
    const due2 = await makeDue({
      net: BigInt(2000),
      balance: BigInt(2000),
      lateFee: BigInt(0),
    });

    const res = await payments.collectMultiDuePayment(tenantA, userA, {
      personId: personA,
      totalAmountMinor: '2600',
      paymentMode: PaymentMode.UPI,
      allocations: [
        { dueId: due1.id, amountMinor: '1100' }, // 1000 principal + 100 late fee
        { dueId: due2.id, amountMinor: '1500' }, // 1500 principal
      ],
      idempotencyKey: nextKey(),
    });

    expect(res.payment.totalAmountMinor).toBe('2600');
    expect(res.payment.allocatedToDuesMinor).toBe('2600');
    expect(res.payment.creditedToAdvanceMinor).toBe('0');
    expect(res.allocations).toHaveLength(2);

    const alloc1 = res.allocations.find((a) => a.dueId === due1.id);
    expect(alloc1!.allocatedPrincipalMinor).toBe('1000');
    expect(alloc1!.allocatedLateFeeMinor).toBe('100');
    expect(alloc1!.totalAllocatedMinor).toBe('1100');

    const alloc2 = res.allocations.find((a) => a.dueId === due2.id);
    expect(alloc2!.allocatedPrincipalMinor).toBe('1500');
    expect(alloc2!.allocatedLateFeeMinor).toBe('0');
    expect(alloc2!.totalAllocatedMinor).toBe('1500');

    const stored1 = await prisma.due.findUnique({ where: { id: due1.id } });
    expect(stored1!.balanceRemaining).toBe(BigInt(0));
    expect(stored1!.status).toBe(DueStatus.PAID);

    const stored2 = await prisma.due.findUnique({ where: { id: due2.id } });
    expect(stored2!.balanceRemaining).toBe(BigInt(500));
    expect(stored2!.status).toBe(DueStatus.PARTIALLY_PAID);

    // Ledger check: exactly 1 PAYMENT_COLLECTED log for the multi-due payment
    const log = await prisma.financialTransactionLog.findFirst({
      where: { tenantId: tenantA, referenceEntityId: res.payment.id },
    });
    expect(log).not.toBeNull();
    expect(log!.eventType).toBe('PAYMENT_COLLECTED');
    expect(log!.amount).toBe(BigInt(2600));
  });

  it('12. rejects a multiple-charge payment if any due belongs to another tenant (atomic rollback)', async () => {
    const dueA = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });
    const dueB = await makeDue({
      tenantId: tenantB,
      personId: personB,
      net: BigInt(1000),
      balance: BigInt(1000),
    });

    await expect(
      payments.collectMultiDuePayment(tenantA, userA, {
        personId: personA,
        totalAmountMinor: '1000',
        paymentMode: PaymentMode.CASH,
        allocations: [
          { dueId: dueA.id, amountMinor: '500' },
          { dueId: dueB.id, amountMinor: '500' },
        ],
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    // Atomic guarantee: Due A balance must NOT be partially deducted
    const untouched = await prisma.due.findUnique({ where: { id: dueA.id } });
    expect(untouched!.balanceRemaining).toBe(BigInt(1000));
  });

  it('13. rejects a multiple-charge payment if dues belong to different persons', async () => {
    const duePersonA = await makeDue({
      personId: personA,
      net: BigInt(500),
      balance: BigInt(500),
    });
    const duePersonC = await makeDue({
      personId: personC,
      net: BigInt(500),
      balance: BigInt(500),
    });

    await expect(
      payments.collectMultiDuePayment(tenantA, userA, {
        personId: personA,
        totalAmountMinor: '1000',
        paymentMode: PaymentMode.CASH,
        allocations: [
          { dueId: duePersonA.id, amountMinor: '500' },
          { dueId: duePersonC.id, amountMinor: '500' },
        ],
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow(/All dues must belong to the same person/i);

    const storedA = await prisma.due.findUnique({ where: { id: duePersonA.id } });
    const storedC = await prisma.due.findUnique({ where: { id: duePersonC.id } });
    expect(storedA!.balanceRemaining).toBe(BigInt(500));
    expect(storedC!.balanceRemaining).toBe(BigInt(500));
  });

  it('14. records multiple-charge payment with excess credited to advance wallet', async () => {
    const personBefore = await prisma.person.findUnique({ where: { id: personA } });
    const initialAdvance = personBefore!.advanceBalance;

    const due1 = await makeDue({ net: BigInt(400), balance: BigInt(400) });
    const due2 = await makeDue({ net: BigInt(600), balance: BigInt(600) });

    // Payer owes 1000 across dues, pays 1500 lump sum -> 500 excess to advance wallet
    const res = await payments.collectMultiDuePayment(tenantA, userA, {
      personId: personA,
      totalAmountMinor: '1500',
      paymentMode: PaymentMode.BANK_TRANSFER,
      allocations: [
        { dueId: due1.id, amountMinor: '400' },
        { dueId: due2.id, amountMinor: '600' },
      ],
      idempotencyKey: nextKey(),
    });

    expect(res.payment.totalAmountMinor).toBe('1500');
    expect(res.payment.allocatedToDuesMinor).toBe('1000');
    expect(res.payment.creditedToAdvanceMinor).toBe('500');
    expect(res.advanceCreditMinor).toBe('500');

    const personAfter = await prisma.person.findUnique({ where: { id: personA } });
    expect(personAfter!.advanceBalance).toBe(initialAdvance + BigInt(500));

    // Financial ledger check for advance credit
    const advLog = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.payment.id,
        eventType: 'ADVANCE_RECEIVED',
      },
    });
    expect(advLog).not.toBeNull();
    expect(advLog!.amount).toBe(BigInt(500));
  });

  // -------------------------------------------------------------
  // Capability 2: Advance Payment (FR-ADV-01 / BR-ADV-001)
  // -------------------------------------------------------------

  it('15. records an advance payment with no selected dues and increments person advanceBalance', async () => {
    const personBefore = await prisma.person.findUnique({ where: { id: personA } });
    const initialAdvance = personBefore!.advanceBalance;

    const res = await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '5000',
      paymentMode: PaymentMode.UPI,
      referenceNumber: 'ADV-REF-101',
      idempotencyKey: nextKey(),
    });

    expect(res.payment.totalAmountMinor).toBe('5000');
    expect(res.payment.allocatedToDuesMinor).toBe('0');
    expect(res.payment.creditedToAdvanceMinor).toBe('5000');
    expect(res.person.advanceBalanceMinor).toBe(
      (initialAdvance + BigInt(5000)).toString(),
    );

    const storedPerson = await prisma.person.findUnique({ where: { id: personA } });
    expect(storedPerson!.advanceBalance).toBe(initialAdvance + BigInt(5000));
  });

  it('16. writes an ADVANCE_RECEIVED financial ledger entry for advance payment', async () => {
    const res = await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '3000',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.payment.id,
        eventType: 'ADVANCE_RECEIVED',
      },
    });

    expect(log).not.toBeNull();
    expect(log!.amount).toBe(BigInt(3000));
  });

  it('17. rejects advance payment for a person in another tenant', async () => {
    await expect(
      payments.collectAdvancePayment(tenantA, userA, {
        personId: personB, // Tenant B's person
        amountMinor: '1000',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    const personBCheck = await prisma.person.findUnique({ where: { id: personB } });
    expect(personBCheck!.advanceBalance).toBe(BigInt(0));
  });

  it('18. rejects advance payment with zero, negative, or malformed amount', async () => {
    for (const badAmount of ['0', '-100', 'xyz']) {
      await expect(
        payments.collectAdvancePayment(tenantA, userA, {
          personId: personA,
          amountMinor: badAmount,
          paymentMode: PaymentMode.CASH,
          idempotencyKey: nextKey(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  // -------------------------------------------------------------
  // Capability 3: Manual Advance Application (FR-ADV-02 / BR-ADV-002)
  // -------------------------------------------------------------

  it('19. manually applies advance credit to an outstanding due, reducing advance and settling due', async () => {
    // Deposit 3000 advance first
    await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '3000',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const personBefore = await prisma.person.findUnique({ where: { id: personA } });
    const advanceBefore = personBefore!.advanceBalance;

    const due = await makeDue({ net: BigInt(2000), balance: BigInt(2000) });

    const res = await payments.applyAdvance(tenantA, userA, {
      dueId: due.id,
      amountMinor: '2000',
    });

    expect(res.allocation.allocatedPrincipalMinor).toBe('2000');
    expect(res.allocation.allocatedLateFeeMinor).toBe('0');
    expect(res.due.balanceRemainingMinor).toBe('0');
    expect(res.due.status).toBe(DueStatus.PAID);
    expect(res.person.advanceBalanceMinor).toBe(
      (advanceBefore - BigInt(2000)).toString(),
    );

    const storedDue = await prisma.due.findUnique({ where: { id: due.id } });
    expect(storedDue!.balanceRemaining).toBe(BigInt(0));
    expect(storedDue!.status).toBe(DueStatus.PAID);

    const storedPerson = await prisma.person.findUnique({ where: { id: personA } });
    expect(storedPerson!.advanceBalance).toBe(advanceBefore - BigInt(2000));

    // Ledger entry check
    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: res.allocation.id,
        eventType: 'ADVANCE_APPLIED',
      },
    });
    expect(log).not.toBeNull();
    expect(log!.amount).toBe(BigInt(2000));
  });

  it('20. applies advance credit with Principal-First ordering when due has an accrued late fee', async () => {
    // Ensure sufficient advance
    await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '2000',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(300),
    });

    // Apply 1200 advance: covers 1000 principal + 200 late fee
    const res = await payments.applyAdvance(tenantA, userA, {
      dueId: due.id,
      amountMinor: '1200',
    });

    expect(res.allocation.allocatedPrincipalMinor).toBe('1000');
    expect(res.allocation.allocatedLateFeeMinor).toBe('200');
    expect(res.due.balanceRemainingMinor).toBe('0');
    expect(res.due.status).toBe(DueStatus.PAID);
  });

  it('21. rejects advance application when person has zero or insufficient advance balance', async () => {
    // Person C has 0 advance balance
    const due = await makeDue({
      personId: personC,
      net: BigInt(1000),
      balance: BigInt(1000),
    });

    await expect(
      payments.applyAdvance(tenantA, userA, {
        dueId: due.id,
        amountMinor: '500',
      }),
    ).rejects.toThrow(/no advance balance/i);

    const untouched = await prisma.due.findUnique({ where: { id: due.id } });
    expect(untouched!.balanceRemaining).toBe(BigInt(1000));
  });

  it('22. rejects advance application against another tenant due', async () => {
    const dueB = await makeDue({
      tenantId: tenantB,
      personId: personB,
      net: BigInt(1000),
      balance: BigInt(1000),
    });

    await expect(
      payments.applyAdvance(tenantA, userA, {
        dueId: dueB.id,
        amountMinor: '500',
      }),
    ).rejects.toThrow(/not found in this tenant/i);
  });

  // -------------------------------------------------------------
  // Capability 4: Idempotency Enforcement (ADR-006 / BR-PAY-001)
  // -------------------------------------------------------------

  it('23. idempotency replay: submitting exact same key returns cached payment without duplicate records', async () => {
    const due = await makeDue({ net: BigInt(1000), balance: BigInt(1000) });
    const idempKey = nextKey();

    const first = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '350',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: idempKey,
    });

    const second = await payments.collectPayment(tenantA, userA, {
      dueId: due.id,
      amountMinor: '350',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: idempKey,
    });

    // Exact matching payment ID returned from cache
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.payment.totalAmountMinor).toBe('350');

    // Exactly 1 Payment row exists in database for this key
    const paymentCount = await prisma.payment.count({
      where: { tenantId: tenantA, idempotencyKey: idempKey },
    });
    expect(paymentCount).toBe(1);

    // Balance deducted ONCE (1000 - 350 = 650, NOT 300)
    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.balanceRemaining).toBe(BigInt(650));

    // Ledger has only 1 PAYMENT_COLLECTED log for this payment ID
    const logCount = await prisma.financialTransactionLog.count({
      where: { tenantId: tenantA, referenceEntityId: first.payment.id },
    });
    expect(logCount).toBe(1);
  });

  it('24. advance payment idempotency replay returns cached advance payment without double-crediting advance balance', async () => {
    const personBefore = await prisma.person.findUnique({ where: { id: personA } });
    const initialAdvance = personBefore!.advanceBalance;
    const idempKey = nextKey();

    const first = await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '1000',
      paymentMode: PaymentMode.UPI,
      idempotencyKey: idempKey,
    });

    const second = await payments.collectAdvancePayment(tenantA, userA, {
      personId: personA,
      amountMinor: '1000',
      paymentMode: PaymentMode.UPI,
      idempotencyKey: idempKey,
    });

    expect(second.payment.id).toBe(first.payment.id);

    // Advance balance must only be incremented ONCE
    const personAfter = await prisma.person.findUnique({ where: { id: personA } });
    expect(personAfter!.advanceBalance).toBe(initialAdvance + BigInt(1000));
  });

  it('25. multi-due payment idempotency replay returns cached multi-due payment without double-allocating', async () => {
    const due1 = await makeDue({ net: BigInt(500), balance: BigInt(500) });
    const due2 = await makeDue({ net: BigInt(500), balance: BigInt(500) });
    const idempKey = nextKey();

    const first = await payments.collectMultiDuePayment(tenantA, userA, {
      personId: personA,
      totalAmountMinor: '600',
      paymentMode: PaymentMode.CARD,
      allocations: [
        { dueId: due1.id, amountMinor: '300' },
        { dueId: due2.id, amountMinor: '300' },
      ],
      idempotencyKey: idempKey,
    });

    const second = await payments.collectMultiDuePayment(tenantA, userA, {
      personId: personA,
      totalAmountMinor: '600',
      paymentMode: PaymentMode.CARD,
      allocations: [
        { dueId: due1.id, amountMinor: '300' },
        { dueId: due2.id, amountMinor: '300' },
      ],
      idempotencyKey: idempKey,
    });

    expect(second.payment.id).toBe(first.payment.id);

    // Dues balances must be deducted ONCE (500 - 300 = 200, NOT -100)
    const stored1 = await prisma.due.findUnique({ where: { id: due1.id } });
    const stored2 = await prisma.due.findUnique({ where: { id: due2.id } });
    expect(stored1!.balanceRemaining).toBe(BigInt(200));
    expect(stored2!.balanceRemaining).toBe(BigInt(200));

    // Only 2 payment allocations exist total for this payment
    const allocCount = await prisma.paymentAllocation.count({
      where: { paymentId: first.payment.id },
    });
    expect(allocCount).toBe(2);
  });

  // -------------------------------------------------------------
  // Capability 5: Basic Late-Fee Assessment (BR-CHG-003 / Edge Case 7)
  // -------------------------------------------------------------

  it('26. assesses late fee on an overdue due, updates lateFeeAmount and status to OVERDUE, preserving principal balanceRemaining', async () => {
    // Due with dueDate in 2026-01-15 (delinquent)
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(0),
      dueDate: new Date('2026-01-01'),
    });

    const assessed = await lateFees.assessLateFee(tenantA, userA, due.id, {
      feeAmountMinor: '250',
      reason: '30-day delinquent penalty',
    });

    expect(assessed.lateFeeAmountMinor).toBe('250');
    expect(assessed.balanceRemainingMinor).toBe('1000'); // Principal balance remains untouched
    expect(assessed.status).toBe(DueStatus.OVERDUE);

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.lateFeeAmount).toBe(BigInt(250));
    expect(stored!.balanceRemaining).toBe(BigInt(1000));
    expect(stored!.status).toBe(DueStatus.OVERDUE);

    // Financial ledger check
    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: due.id,
        eventType: 'LATE_FEE_ASSESSED',
      },
    });
    expect(log).not.toBeNull();
    expect(log!.amount).toBe(BigInt(250));
  });

  it('27. rejects late fee assessment if due date has not lapsed (premature assessment blocked)', async () => {
    // Due in the distant future
    const futureDue = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      dueDate: new Date('2099-12-31'),
    });

    await expect(
      lateFees.assessLateFee(tenantA, userA, futureDue.id, {
        feeAmountMinor: '100',
      }),
    ).rejects.toThrow(/Due date has not lapsed/i);

    const stored = await prisma.due.findUnique({ where: { id: futureDue.id } });
    expect(stored!.lateFeeAmount).toBe(BigInt(0));
  });

  it('28. rejects late fee assessment on a VOIDED or settled due', async () => {
    const settledDue = await makeDue({
      net: BigInt(1000),
      balance: BigInt(0),
      status: DueStatus.PAID,
      dueDate: new Date('2026-01-01'),
    });

    await expect(
      lateFees.assessLateFee(tenantA, userA, settledDue.id, {
        feeAmountMinor: '100',
      }),
    ).rejects.toThrow(/already settled/i);
  });

  it('29. waives assessed late fee with mandatory reason, updating lateFeeAmount and writing LATE_FEE_WAIVED ledger', async () => {
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(300),
      dueDate: new Date('2026-01-01'),
    });

    const waived = await lateFees.waiveLateFee(tenantA, adminA, due.id, {
      amountMinor: '200',
      reason: 'First-time waiver approved by school administrator',
    });

    expect(waived.lateFeeAmountMinor).toBe('100'); // 300 - 200 = 100

    const stored = await prisma.due.findUnique({ where: { id: due.id } });
    expect(stored!.lateFeeAmount).toBe(BigInt(100));

    // Ledger entry check
    const log = await prisma.financialTransactionLog.findFirst({
      where: {
        tenantId: tenantA,
        referenceEntityId: due.id,
        eventType: 'LATE_FEE_WAIVED',
      },
    });
    expect(log).not.toBeNull();
    expect(log!.amount).toBe(BigInt(200));
  });

  it('30. rejects late fee waiver exceeding available unsettled late fee or missing reason', async () => {
    const due = await makeDue({
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(100),
    });

    // Exceeds available late fee
    await expect(
      lateFees.waiveLateFee(tenantA, adminA, due.id, {
        amountMinor: '500',
        reason: 'Too large',
      }),
    ).rejects.toThrow(/exceeds available unsettled late fee/i);

    // Missing reason
    await expect(
      lateFees.waiveLateFee(tenantA, adminA, due.id, {
        amountMinor: '50',
        reason: '',
      }),
    ).rejects.toThrow(/Mandatory waiver reason/i);
  });

  it('31. rejects cross-tenant late fee assessment and waiver', async () => {
    const dueB = await makeDue({
      tenantId: tenantB,
      personId: personB,
      net: BigInt(1000),
      balance: BigInt(1000),
      lateFee: BigInt(150),
      dueDate: new Date('2026-01-01'),
    });

    await expect(
      lateFees.assessLateFee(tenantA, userA, dueB.id, {
        feeAmountMinor: '100',
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    await expect(
      lateFees.waiveLateFee(tenantA, adminA, dueB.id, {
        amountMinor: '50',
        reason: 'Cross-tenant illegal waiver',
      }),
    ).rejects.toThrow(/not found in this tenant/i);
  });
});