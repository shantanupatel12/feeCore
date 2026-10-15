import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  DueStatus,
  PaymentMode,
  UserRole,
} from '@prisma/client';
import {
  NotFoundException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ReceiptsService } from '../src/modules/receipts/receipts.service.js';
import { ReceiptsController } from '../src/modules/receipts/receipts.controller.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

describe('V1.12: Receipts (FR-RCP-01 / BR-RCP-001 / BR-RCP-002)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let receipts: ReceiptsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;
  let personB: string;
  let chargeA: string;

  let keySeq = 0;
  const nextKey = () => `receipt-key-${Date.now()}-${keySeq++}`;

  async function makeDue(opts?: {
    tenantId?: string;
    personId?: string;
    net?: bigint;
    category?: string;
  }) {
    return prisma.due.create({
      data: {
        tenantId: opts?.tenantId ?? tenantA,
        personId: opts?.personId ?? personA,
        chargeId: chargeA,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(opts?.net ?? 1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(opts?.net ?? 1000),
        status: DueStatus.PENDING,
      },
    });
  }

  async function pay(dueId: string, amount: string) {
    return payments.collectPayment(tenantA, adminA, {
      personId: personA,
      dueId,
      amountMinor: amount,
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({
      data: { name: 'Receipt Org A', category: 'School', currency: 'INR' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Receipt Org B', category: 'School', currency: 'INR' },
    });
    tenantB = tB.id;

    const u = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@receipts.test',
        passwordHash: 'dummyhash',
        fullName: 'Receipt Admin A',
        role: 'ROLE_ADMIN',
      },
    });
    adminA = u.id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Receipt Payer A',
          primaryPhone: '9200000001',
          email: 'payer.a@receipts.test',
          address: '12 Receipt Lane',
          advanceBalance: BigInt(0),
          customData: { flatNumber: 'A-12' },
        },
      })
    ).id;

    personB = (
      await prisma.person.create({
        data: {
          tenantId: tenantB,
          fullName: 'Receipt Payer B',
          primaryPhone: '9200000002',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    chargeA = (
      await prisma.charge.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          category: 'TUITION',
          description: 'Term 1 tuition',
          baseAmount: BigInt(1000),
          discountAmount: BigInt(0),
          createdByUserId: adminA,
        },
      })
    ).id;

    // Custom receipt prefix proves the number honours tenant settings.
    await prisma.tenantSettings.create({
      data: { tenantId: tenantA, receiptPrefix: 'INV' },
    });

    payments = new PaymentsService(prisma as any);
    receipts = new ReceiptsService(prisma as any);
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    for (const t of both) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
    }

    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: both } } });
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

  it('1. issues a gapless, prefixed, zero-padded receipt number', async () => {
    const due = await makeDue();
    const res = await pay(due.id, '1000');

    // BR-RCP-001: Prefix-FiscalYear-LPAD(seq, 6)
    expect(res.receipt.receiptNumber).toMatch(/^INV-\d{4}-\d{6}$/);

    const receipt = await prisma.receipt.findUnique({
      where: { id: res.receipt.id },
    });
    expect(receipt!.receiptNumber).toBe(res.receipt.receiptNumber);
  });

  it('2. sequences consecutively with no gaps', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const due = await makeDue();
      const res = await pay(due.id, '1000');
      numbers.push(res.receipt.receiptNumber);
    }

    const seqs = numbers.map((n) => Number(n.split('-')[2]));
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it('3. increments the sequence per tenant independently', async () => {
    const due = await makeDue();
    const res = await pay(due.id, '500');
    const tenantASeq = Number(res.receipt.receiptNumber.split('-')[2]);

    const tenantARow = await prisma.receiptSequence.findFirst({
      where: { tenantId: tenantA },
    });
    expect(tenantARow!.currentSequence).toBe(tenantASeq);

    // Tenant B has no sequence row yet: numbering must not collide.
    const tenantBRow = await prisma.receiptSequence.findFirst({
      where: { tenantId: tenantB },
    });
    expect(tenantBRow).toBeNull();
  });

  it('4. freezes a complete snapshot at issuance', async () => {
    const due = await makeDue({ net: 900 });
    const res = await pay(due.id, '900');

    const got = await receipts.getReceipt(tenantA, res.receipt.id);
    const s = got.snapshot as any;

    // Payer snapshot
    expect(s.payer.fullName).toBe('Receipt Payer A');
    expect(s.payer.primaryPhone).toBe('9200000001');
    expect(s.payer.email).toBe('payer.a@receipts.test');
    expect(s.payer.address).toBe('12 Receipt Lane');
    expect(s.payer.customData).toEqual({ flatNumber: 'A-12' });

    // Payment snapshot
    expect(s.payment.totalAmountMinor).toBe('900');
    expect(s.payment.paymentMode).toBe('CASH');
    expect(s.payment.collectorUserId).toBe(adminA);
    expect(typeof s.payment.paymentDate).toBe('string');

    // Organisation snapshot
    expect(s.organization.name).toBe('Receipt Org A');
    expect(s.organization.currency).toBe('INR');
    expect(s.organization.receiptPrefix).toBe('INV');

    // Itemised allocation breakdown
    expect(s.allocations).toHaveLength(1);
    expect(s.allocations[0].category).toBe('TUITION');
    expect(s.allocations[0].description).toBe('Term 1 tuition');
    expect(s.allocations[0].totalAllocatedMinor).toBe('900');

    // Template version tag
    expect(s.templateVersion).toBe('v1.0');
  });

  it('5. snapshot is immutable across later payer and tenant edits', async () => {
    const due = await makeDue({ net: 700 });
    const res = await pay(due.id, '700');

    const before = await receipts.getReceipt(tenantA, res.receipt.id);

    // Mutate the live entities after issuance.
    await prisma.person.update({
      where: { id: personA },
      data: { fullName: 'RENAMED AFTER ISSUE', primaryPhone: '9999999999' },
    });
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { name: 'Renamed Org', currency: 'USD' },
    });

    const after = await receipts.getReceipt(tenantA, res.receipt.id);
    expect(after.snapshot).toEqual(before.snapshot);
    expect((after.snapshot as any).payer.fullName).toBe('Receipt Payer A');
    expect((after.snapshot as any).organization.name).toBe('Receipt Org A');

    // Restore for later assertions.
    await prisma.person.update({
      where: { id: personA },
      data: { fullName: 'Receipt Payer A', primaryPhone: '9200000001' },
    });
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { name: 'Receipt Org A', currency: 'INR' },
    });
  });

  it('6. renders deterministically from the snapshot only', async () => {
    const due = await makeDue({ net: 600 });
    const res = await pay(due.id, '600');

    const html1 = await receipts.renderReceiptHtml(tenantA, res.receipt.id);
    const html2 = await receipts.renderReceiptHtml(tenantA, res.receipt.id);
    expect(html1).toBe(html2);

    expect(html1).toContain(res.receipt.receiptNumber);
    expect(html1).toContain('Receipt Payer A');
    expect(html1).toContain('TUITION');
    expect(html1).toContain('v1.0');
  });

  it('7. escapes payer-controlled content in the rendered receipt', async () => {
    const evil = await prisma.person.create({
      data: {
        tenantId: tenantA,
        fullName: '<script>alert(1)</script>',
        primaryPhone: '9200000003',
        advanceBalance: BigInt(0),
      },
    });

    const due = await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: evil.id,
        chargeId: chargeA,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(100),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(100),
        status: DueStatus.PENDING,
      },
    });

    const res = await payments.collectPayment(tenantA, adminA, {
      personId: evil.id,
      dueId: due.id,
      amountMinor: '100',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const html = await receipts.renderReceiptHtml(tenantA, res.receipt.id);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('8. rejects cross-tenant receipt reads', async () => {
    const due = await makeDue();
    const res = await pay(due.id, '500');

    await expect(
      receipts.getReceipt(tenantB, res.receipt.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      receipts.renderReceiptHtml(tenantB, res.receipt.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('9. rejects an unknown receipt id', async () => {
    await expect(
      receipts.getReceipt(
        tenantA,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('10. a failed payment neither persists a receipt nor burns a number', async () => {
    const beforeSeq =
      (
        await prisma.receiptSequence.findFirst({
          where: { tenantId: tenantA },
        })
      )!.currentSequence;
    const beforeCount = await prisma.receipt.count({
      where: { tenantId: tenantA },
    });

    // Overpay against a fully-allocated due: allocation ceiling rejects it.
    const due = await makeDue({ net: 200 });
    await expect(
      payments.collectPayment(tenantA, adminA, {
        personId: personA,
        dueId: due.id,
        amountMinor: '999999',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow();

    const afterSeq =
      (
        await prisma.receiptSequence.findFirst({
          where: { tenantId: tenantA },
        })
      )!.currentSequence;
    const afterCount = await prisma.receipt.count({
      where: { tenantId: tenantA },
    });

    // BR-RCP-001 rollback-safety invariant.
    expect(afterSeq).toBe(beforeSeq);
    expect(afterCount).toBe(beforeCount);
  });

  it('11. items multiple dues on a single multi-due receipt', async () => {
    const d1 = await makeDue({ net: 300 });
    const d2 = await makeDue({ net: 400 });

    const res = await payments.collectMultiDuePayment(tenantA, adminA, {
      personId: personA,
      paymentMode: PaymentMode.UPI,
      totalAmountMinor: '700',
      idempotencyKey: nextKey(),
      allocations: [
        { dueId: d1.id, amountMinor: '300' },
        { dueId: d2.id, amountMinor: '400' },
      ],
    });

    const got = await receipts.getReceipt(tenantA, res.receipt.id);
    const s = got.snapshot as any;

    expect(s.allocations).toHaveLength(2);
    expect(s.payment.totalAmountMinor).toBe('700');
    expect(
      s.allocations.reduce(
        (sum: bigint, a: any) => sum + BigInt(a.totalAllocatedMinor),
        BigInt(0),
      ).toString(),
    ).toBe('700');
  });

  it('12. links exactly one receipt to each payment', async () => {
    const d1 = await makeDue({ net: 450 });
    const res = await pay(d1.id, '450');

    const row = await prisma.receipt.findUnique({
      where: { id: res.receipt.id },
    });
    expect(row!.paymentId).toBe(res.payment.id);

    // 1:1 in both directions.
    const forPayment = await prisma.receipt.findMany({
      where: { paymentId: res.payment.id },
    });
    expect(forPayment).toHaveLength(1);

    // The allocation rows and the receipt agree on the same payment.
    const allocs = await prisma.paymentAllocation.findMany({
      where: { paymentId: res.payment.id },
    });
    expect(allocs.length).toBeGreaterThan(0);
    for (const a of allocs) {
      expect(a.tenantId).toBe(tenantA);
    }
  });

  it('13. retrieves a receipt by its payment id', async () => {
    const due = await makeDue({ net: 800 });
    const res = await pay(due.id, '800');

    const got = await receipts.getReceiptByPayment(tenantA, res.payment.id);

    expect(got.id).toBe(res.receipt.id);
    expect(got.receiptNumber).toBe(res.receipt.receiptNumber);
    expect(got.paymentId).toBe(res.payment.id);
  });

  it('14. rejects a by-payment lookup for a payment with no receipt', async () => {
    await expect(
      receipts.getReceiptByPayment(
        tenantA,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('15. refuses a by-payment lookup across tenants', async () => {
    const due = await makeDue({ net: 250 });
    const res = await pay(due.id, '250');

    // Tenant B holds a receipt for a payment that exists, but not this one.
    await expect(
      receipts.getReceiptByPayment(tenantB, res.payment.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('16. lists only the calling tenant receipts, newest first', async () => {
    const due = await makeDue({ net: 150 });
    await pay(due.id, '150');

    const listA = await receipts.listReceipts(tenantA);
    const listB = await receipts.listReceipts(tenantB);

    expect(listA.total).toBeGreaterThan(0);
    expect(listB.total).toBe(0);
    expect(listB.items).toHaveLength(0);

    // Every returned row genuinely belongs to the calling tenant.
    const persisted = await prisma.receipt.findMany({
      where: { id: { in: listA.items.map((r) => r.id) } },
    });
    expect(persisted.every((r) => r.tenantId === tenantA)).toBe(true);

    // Ordering is descending by issue time.
    const issued = listA.items.map((r) => new Date(r.issuedAt).getTime());
    for (let i = 1; i < issued.length; i++) {
      expect(issued[i]).toBeLessThanOrEqual(issued[i - 1]);
    }
  });

  it('17. filters the listing by person and paginates', async () => {
    const list = await receipts.listReceipts(tenantA, {
      personId: personA,
      page: 1,
      limit: 2,
    });

    expect(list.items.length).toBeLessThanOrEqual(2);
    expect(list.page).toBe(1);
    expect(list.limit).toBe(2);
    expect(list.totalPages).toBe(Math.ceil(list.total / 2));

    // A personId belonging to another tenant yields nothing for Tenant A.
    const foreign = await receipts.listReceipts(tenantA, { personId: personB });
    expect(foreign.total).toBe(0);
  });

  it('18. keeps receipt reads tenant-isolated for listing by another tenant', async () => {
    const due = await makeDue({ net: 120 });
    const res = await pay(due.id, '120');

    // The receipt id is real and readable by A, invisible to B.
    await expect(receipts.getReceipt(tenantA, res.receipt.id)).resolves.toBeTruthy();
    await expect(
      receipts.getReceipt(tenantB, res.receipt.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const listB = await receipts.listReceipts(tenantB);
    expect(listB.items.some((r) => r.id === res.receipt.id)).toBe(false);
  });
});

describe('V1.12b: Receipts RBAC and JWT tenant scoping', () => {
  const reflector = new Reflector();
  const rolesGuard = new RolesGuard(reflector);

  const tenantA = 'aaaaaaaa-1111-1111-1111-111111111111';
  const tenantB = 'bbbbbbbb-2222-2222-2222-222222222222';

  function contextFor(user: JwtPayload) {
    const request: Record<string, any> = {
      headers: {},
      // A hostile caller puts someone else's tenant in every slot.
      params: { tenantId: tenantB },
      query: { tenantId: tenantB },
      body: {},
      user,
    };

    return {
      ctx: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ReceiptsController.prototype.getReceipt,
        getClass: () => ReceiptsController,
      } as unknown as ExecutionContext,
      request,
    };
  }

  const viewer = {
    sub: 'u-viewer',
    tenantId: tenantA,
    email: 'v@a.com',
    role: UserRole.ROLE_VIEWER,
  } as JwtPayload;

  const collector = {
    sub: 'u-collector',
    tenantId: tenantA,
    email: 'c@a.com',
    role: UserRole.ROLE_COLLECTOR,
  } as JwtPayload;

  it('derives the tenant from the JWT, not the request params', async () => {
    const captured: string[] = [];
    const stub = {
      getReceipt: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new ReceiptsController(stub);
    await controller.getReceipt(viewer, 'any-receipt-id');

    // The URL claimed tenant B; the JWT tenant A must win.
    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);
  });

  it('derives the tenant from the JWT for listing too', async () => {
    const captured: string[] = [];
    const stub = {
      listReceipts: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new ReceiptsController(stub);
    await controller.listReceipts(viewer, undefined, 1, 10);

    expect(captured).toEqual([tenantA]);
  });

  it('derives the tenant from the JWT for by-payment lookup', async () => {
    const captured: string[] = [];
    const stub = {
      getReceiptByPayment: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new ReceiptsController(stub);
    await controller.getReceiptByPayment(viewer, 'some-payment-id');

    expect(captured).toEqual([tenantA]);
  });

  it('permits Viewer and Collector on read routes (receipts:view = ALLOW)', () => {
    // No @Roles() metadata is declared on the read routes, so the
    // guard must let every authenticated role through.
    expect(rolesGuard.canActivate(contextFor(viewer).ctx)).toBe(true);
    expect(rolesGuard.canActivate(contextFor(collector).ctx)).toBe(true);
  });

  it('refuses an unauthenticated caller', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, params: {}, query: {}, body: {} }),
      }),
      getHandler: () => ReceiptsController.prototype.getReceipt,
      getClass: () => ReceiptsController,
    } as unknown as ExecutionContext;

    // Force a role requirement so the guard has something to enforce.
    Reflect.defineMetadata(
      'roles',
      [UserRole.ROLE_ADMIN],
      ReceiptsController.prototype.getReceipt,
    );

    try {
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    } finally {
      Reflect.deleteMetadata(
        'roles',
        ReceiptsController.prototype.getReceipt,
      );
    }
  });
});