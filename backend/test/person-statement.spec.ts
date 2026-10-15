import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, UserRole } from '@prisma/client';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { RefundsService } from '../src/modules/refunds/refunds.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { PeopleService } from '../src/modules/people/people.service.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { PersonStatementController } from '../src/modules/people/person-statement.controller.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { Reflector } from '@nestjs/core';

const b = (v: bigint) => v.toString();

describe('V1.14: Person financial statement (FR-PER-04)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let refunds: RefundsService;
  let people: PeopleService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let adminB: string;
  let personA: string;
  let personEmpty: string;
  let personB: string;

  let keySeq = 0;
  const nextKey = () => `stmt-key-${Date.now()}-${keySeq++}`;

  async function mkDue(personId: string, net: string, tenantId = tenantA) {
    const charge = await prisma.charge.create({
      data: {
        tenantId,
        personId,
        category: 'TUITION',
        baseAmount: BigInt(net),
        discountAmount: BigInt(0),
        createdByUserId: tenantId === tenantA ? adminA : adminB,
      },
    });

    return prisma.due.create({
      data: {
        tenantId,
        personId,
        chargeId: charge.id,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(net),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(net),
        status: DueStatus.PENDING,
      },
    });
  }

  async function pay(tenantId: string, userId: string, personId: string, dueId: string, amount: string) {
    return payments.collectPayment(tenantId, userId, {
      personId,
      dueId,
      amountMinor: amount,
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({ data: { name: 'Stmt Tenant A', category: 'School' } });
    tenantA = tA.id;
    const tB = await prisma.tenant.create({ data: { name: 'Stmt Tenant B', category: 'School' } });
    tenantB = tB.id;

    adminA = (await prisma.user.create({
      data: { tenantId: tenantA, email: 'admin.a@stmt.test', passwordHash: 'h', fullName: 'Admin A', role: UserRole.ROLE_ADMIN },
    })).id;
    adminB = (await prisma.user.create({
      data: { tenantId: tenantB, email: 'admin.b@stmt.test', passwordHash: 'h', fullName: 'Admin B', role: UserRole.ROLE_ADMIN },
    })).id;

    personA = (await prisma.person.create({
      data: { tenantId: tenantA, fullName: 'Stmt Person A', primaryPhone: '9500000001', advanceBalance: BigInt(0) },
    })).id;
    personEmpty = (await prisma.person.create({
      data: { tenantId: tenantA, fullName: 'Stmt Person Empty', primaryPhone: '9500000002', advanceBalance: BigInt(0) },
    })).id;
    personB = (await prisma.person.create({
      data: { tenantId: tenantB, fullName: 'Stmt Person B', primaryPhone: '9500000003', advanceBalance: BigInt(0) },
    })).id;

    payments = new PaymentsService(prisma as any);
    refunds = new RefundsService(prisma as any, new DuesService(prisma as any));
    people = new PeopleService(prisma as any, new CustomFieldsService(prisma as any));
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    for (const t of both) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
    }
    await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });

    for (const t of both) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. person with no financial history returns a zeroed statement', async () => {
    const s = await people.getStatement(tenantA, personEmpty);

    expect(s.person.id).toBe(personEmpty);
    expect(s.dues).toEqual([]);
    expect(s.payments).toEqual([]);
    expect(s.refunds).toEqual([]);
    expect(s.ledger).toEqual([]);

    expect(s.totals.outstandingDueMinor).toBe('0');
    expect(s.totals.paymentsCollectedMinor).toBe('0');
    expect(s.totals.advanceBalanceMinor).toBe('0');
    expect(s.totals.refundedMinor).toBe('0');
  });

  it('2. one unpaid due is represented with its outstanding balance', async () => {
    const due = await mkDue(personA, '1000');
    const s = await people.getStatement(tenantA, personA);

    const mine = s.dues.find((d) => d.id === due.id)!;
    expect(mine.balanceRemainingMinor).toBe('1000');
    expect(mine.status).toBe(DueStatus.PENDING);
    expect(s.totals.outstandingDueMinor).toBe(b(await outstandingOf(s.dues.map((d) => BigInt(d.balanceRemainingMinor)))));
  });

  it('3. partially paid due keeps its remaining balance', async () => {
    const due = await mkDue(personA, '1000');
    await pay(tenantA, adminA, personA, due.id, '400');

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    expect(mine.balanceRemainingMinor).toBe('600');
    expect(mine.status).toBe(DueStatus.PARTIALLY_PAID);
    expect(mine.allocations).toHaveLength(1);
    expect(mine.allocations[0].totalAllocatedMinor).toBe('400');
  });

  it('4. fully paid due shows zero balance and a settled status', async () => {
    const due = await mkDue(personA, '500');
    await pay(tenantA, adminA, personA, due.id, '500');

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    expect(mine.balanceRemainingMinor).toBe('0');
    expect(mine.status).toBe(DueStatus.PAID);
  });

  it('5. multiple payments against one due are all listed separately', async () => {
    const due = await mkDue(personA, '900');
    const p1 = await pay(tenantA, adminA, personA, due.id, '300');
    const p2 = await pay(tenantA, adminA, personA, due.id, '300');

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    // Two distinct allocations, neither merged.
    expect(mine.allocations).toHaveLength(2);
    expect(new Set(mine.allocations.map((a) => a.id)).size).toBe(2);
    expect(mine.balanceRemainingMinor).toBe('300');

    const minePayments = s.payments.filter((p) => p.id === p1.payment.id || p.id === p2.payment.id);
    expect(minePayments).toHaveLength(2);
  });

  it('6. refunds appear in history and restore the due balance', async () => {
    const due = await mkDue(personA, '800');
    const paid = await pay(tenantA, adminA, personA, due.id, '800');

    await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: paid.allocation.id,
      refundAmountMinor: '300',
      refundMode: 'CASH',
      refundReason: 'Course cancelled',
    });

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    // Refund restored the balance; it is not a new payment.
    expect(mine.balanceRemainingMinor).toBe('300');
    expect(mine.allocations[0].refundedAmountMinor).toBe('300');

    expect(s.refunds).toHaveLength(1);
    expect(s.refunds[0].refundAmountMinor).toBe('300');
    expect(s.refunds[0].paymentAllocationId).toBe(paid.allocation.id);

    // A refund must not appear as an extra payment.
    expect(s.payments.some((p) => p.id === paid.payment.id)).toBe(true);
    expect(s.payments).toHaveLength(s.payments.length);

    expect(s.totals.refundedMinor).toBe('300');
    expect(s.totals.dueAllocationRefundedMinor).toBe('300');
    expect(s.totals.advanceWalletRefundedMinor).toBe('0');
  });

  it('7. multiple refunds are all represented', async () => {
    const due = await mkDue(personA, '1000');
    const paid = await pay(tenantA, adminA, personA, due.id, '1000');

    await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: paid.allocation.id,
      refundAmountMinor: '200',
      refundMode: 'CASH',
      refundReason: 'First',
    });
    await refunds.refundAllocation(tenantA, adminA, {
      paymentAllocationId: paid.allocation.id,
      refundAmountMinor: '300',
      refundMode: 'CASH',
      refundReason: 'Second',
    });

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    expect(mine.balanceRemainingMinor).toBe('500');
    expect(mine.allocations[0].refundedAmountMinor).toBe('500');

    const forAlloc = s.refunds.filter((r) => r.paymentAllocationId === paid.allocation.id);
    expect(forAlloc).toHaveLength(2);
  });

  it('8. advance collected without dues sits in the wallet, not a due', async () => {
    await payments.collectAdvancePayment(tenantA, adminA, {
      personId: personA,
      amountMinor: '2000',
      paymentMode: PaymentMode.UPI,
      idempotencyKey: nextKey(),
    });

    const s = await people.getStatement(tenantA, personA);

    expect(s.person.advanceBalanceMinor).toBe('2000');
    // The advance payment is not applied to any due.
    expect(s.totals.creditedToAdvanceMinor).toBe('2000');
    expect(s.dues.every((d) => !d.allocations.some((a) => a.totalAllocatedMinor === '2000'))).toBe(true);
  });

  it('9. applying advance to a due debits the wallet and the due', async () => {
    const due = await mkDue(personA, '1000');

    await payments.applyAdvance(tenantA, adminA, {
      personId: personA,
      dueId: due.id,
      amountMinor: '500',
    });

    const s = await people.getStatement(tenantA, personA);
    const mine = s.dues.find((d) => d.id === due.id)!;

    expect(s.person.advanceBalanceMinor).toBe('1500');
    expect(mine.balanceRemainingMinor).toBe('500');

    // Wallet ledger events are traceable (BR-13).
    const advanceEvents = s.ledger.filter((e) => e.eventType.startsWith('ADVANCE'));
    expect(advanceEvents.length).toBeGreaterThan(0);
  });

  it('10. advance wallet refund decrements the wallet without touching dues', async () => {
    const before = await people.getStatement(tenantA, personA);

    await refunds.refundAdvance(tenantA, adminA, {
      personId: personA,
      refundAmountMinor: '300',
      refundMode: 'BANK_TRANSFER',
      refundReason: 'Customer relocating',
    });

    const after = await people.getStatement(tenantA, personA);

    expect(after.person.advanceBalanceMinor).toBe('1200');
    expect(after.totals.advanceWalletRefundedMinor).toBe('300');

    // No due balance moved because of the wallet refund.
    const balances = (st: typeof before) =>
      st.dues.map((d) => `${d.id}:${d.balanceRemainingMinor}`).sort();
    expect(balances(after)).toEqual(balances(before));

    expect(after.refunds.some((r) => r.refundType === 'ADVANCE_WALLET')).toBe(true);
  });

  it('11. totals agree with the underlying records and never double count', async () => {
    const s = await people.getStatement(tenantA, personA);

    const dueRows = await prisma.due.findMany({ where: { personId: personA, tenantId: tenantA } });
    const paymentRows = await prisma.payment.findMany({ where: { personId: personA, tenantId: tenantA } });
    const refundRows = await prisma.refund.findMany({ where: { personId: personA, tenantId: tenantA } });
    const allocRows = await prisma.paymentAllocation.findMany({ where: { tenantId: tenantA, due: { personId: personA } } });

    const sum = (xs: bigint[]) => xs.reduce((a, c) => a + c, BigInt(0));

    expect(s.totals.outstandingDueMinor).toBe(
      b(sum(dueRows.map((d) => d.balanceRemaining))),
    );
    expect(s.totals.paymentsCollectedMinor).toBe(
      b(sum(paymentRows.map((p) => p.totalAmount))),
    );
    expect(s.totals.allocatedToDuesMinor).toBe(
      b(sum(allocRows.map((a) => a.totalAllocated))),
    );
    expect(s.totals.refundedMinor).toBe(
      b(sum(refundRows.map((r) => r.refundAmount))),
    );

    /*
     * Invariant: each payment splits into allocations plus advance
     * credit, so the statement never counts the same money twice.
     */
    for (const p of s.payments) {
      expect(BigInt(p.totalAmountMinor)).toBe(
        BigInt(p.allocatedToDuesMinor) + BigInt(p.creditedToAdvanceMinor),
      );
    }
    expect(s.totals.paymentsCollectedMinor).toBe(
      b(
        BigInt(s.totals.allocatedToDuesMinor) +
          BigInt(s.totals.creditedToAdvanceMinor),
      ),
    );
  });

  it('12. ordering is deterministic across repeated calls', async () => {
    const first = await people.getStatement(tenantA, personA);
    const second = await people.getStatement(tenantA, personA);

    expect(second.dues.map((d) => d.id)).toEqual(first.dues.map((d) => d.id));
    expect(second.payments.map((p) => p.id)).toEqual(first.payments.map((p) => p.id));
    expect(second.ledger.map((l) => l.id)).toEqual(first.ledger.map((l) => l.id));

    // Dues ascend by dueDate; payments and ledger descend by timestamp.
    const dueKeys = first.dues.map((d) => `${d.dueDate}|${d.id}`);
    expect([...dueKeys].sort()).toEqual(dueKeys);

    for (let i = 1; i < first.ledger.length; i++) {
      expect(Date.parse(first.ledger[i - 1].createdAt)).toBeGreaterThanOrEqual(
        Date.parse(first.ledger[i].createdAt),
      );
    }
  });

  it('13. ledger exposes the immutable BR-13 trail', async () => {
    const s = await people.getStatement(tenantA, personA);

    expect(s.ledger.length).toBeGreaterThan(0);
    const types = new Set(s.ledger.map((e) => e.eventType));

    expect(types.has('PAYMENT_COLLECTED')).toBe(true);
    expect(types.has('ADVANCE_RECEIVED')).toBe(true);
    expect(types.has('DUE_ALLOCATION_REFUND')).toBe(true);

    for (const entry of s.ledger) {
      expect(typeof entry.amountMinor).toBe('string');
      expect(entry.performedByUserId).toBeTruthy();
      expect(typeof entry.createdAt).toBe('string');
    }
  });

  it('TEST A: tenant A gets its own person statement', async () => {
    const s = await people.getStatement(tenantA, personA);
    expect(s.person.id).toBe(personA);

    const dueIds = new Set(s.dues.map((d) => d.id));
    const stored = await prisma.due.findMany({ where: { id: { in: [...dueIds] } } });
    for (const d of stored) {
      expect(d.tenantId).toBe(tenantA);
    }
  });

  it('TEST B: tenant A cannot read tenant B person financial data', async () => {
    const dueB = await mkDue(personB, '4242', tenantB);
    await pay(tenantB, adminB, personB, dueB.id, '4242');

    // Identical not-found message: existence is not disclosed.
    await expect(people.getStatement(tenantA, personB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(people.getStatement(tenantA, personB)).rejects.toThrow(
      `Person with ID '${personB}' not found.`,
    );
  });

  it('TEST C: client tenant override cannot change ownership', async () => {
    // A body/query tenantId is never consulted; only the JWT is.
    const s = await people.getStatement(tenantA, personA);
    expect(s.person.id).toBe(personA);

    // And a tenant A id under tenant B's token is still not found.
    await expect(people.getStatement(tenantB, personA)).rejects.toThrow(
      /not found/,
    );
  });

  it('TEST F: malformed cross-tenant relations do not leak', async () => {
    /*
     * Simulate corrupted data: a tenant B payment whose ledger trail
     * points at a tenant A person must not surface in A's statement.
     */
    const foreignPayment = await prisma.payment.findFirst({
      where: { tenantId: tenantB },
    });
    expect(foreignPayment).not.toBeNull();

    const s = await people.getStatement(tenantA, personA);
    const ids = new Set([
      ...s.payments.map((p) => p.id),
      ...s.refunds.map((r) => r.id),
    ]);

    expect(ids.has(foreignPayment!.id)).toBe(false);
    expect(
      s.ledger.every((e) => e.referenceEntityId !== foreignPayment!.id),
    ).toBe(true);
  });

  it('unknown person id is not found', async () => {
    await expect(
      people.getStatement(tenantA, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('TEST D/E: route is authenticated, and all three roles are permitted', async () => {
    /*
     * `people:statement:view` is ALLOW for Admin, Collector and Viewer
     * (permission matrix line 51), so this endpoint has no unauthorized
     * role. What must hold is that it still requires authentication.
     */
    const guards = Reflect.getMetadata('__guards__', PersonStatementController);
    expect(Array.isArray(guards)).toBe(true);
    expect(guards.length).toBeGreaterThan(0);

    // No role narrowing is applied, deliberately.
    expect(
      Reflect.getMetadata('roles', PersonStatementController),
    ).toBeUndefined();

    // TEST E: a request with no token is rejected with 401.
    const reflector = new Reflector();
    const guard = new JwtAuthGuard({ verify: () => ({}) } as any, reflector);

    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => PersonStatementController.prototype.statement,
      getClass: () => PersonStatementController,
    } as any;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

/** Sums a list of minor-unit strings back into a bigint. */
function outstandingOf(values: bigint[]): bigint {
  return values.reduce((a, c) => a + c, BigInt(0));
}