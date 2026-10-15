import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, DueStatus, LateFeeCalculationType } from '@prisma/client';
import { LateFeeRulesService, calculateRuleLateFee } from '../src/modules/charges/late-fee-rules.service.js';
import { LateFeeRulesController } from '../src/modules/charges/late-fee-rules.controller.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { LateFeeService, daysBetween, resolveTenantDate } from '../src/modules/payments/services/late-fee.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { RefundsService } from '../src/modules/refunds/refunds.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { DuesController } from '../src/modules/dues/dues.controller.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

const ids: Record<string, string> = {};

const jwtService = {
  verify: (token: string): JwtPayload => {
    const byToken: Record<string, JwtPayload> = {
      'admin-a': { sub: ids.userA, tenantId: ids.tenantA, email: 'a@x.com', role: 'ROLE_ADMIN' },
      'admin-b': { sub: ids.userB, tenantId: ids.tenantB, email: 'b@x.com', role: 'ROLE_ADMIN' },
      'collector-a': { sub: ids.userC, tenantId: ids.tenantA, email: 'c@x.com', role: 'ROLE_COLLECTOR' },
      'viewer-a': { sub: ids.userV, tenantId: ids.tenantA, email: 'v@x.com', role: 'ROLE_VIEWER' },
    };
    if (token === 'tenantless') {
      return { sub: 'x', email: 't@x.com', role: 'ROLE_ADMIN' } as unknown as JwtPayload;
    }
    if (token === 'expired') {
      throw new Error('bad token');
    }
    const found = byToken[token];
    if (!found) {
      throw new Error('bad token');
    }
    return found;
  },
};

const reflector = new Reflector();
const authGuard = new JwtAuthGuard(jwtService as any, reflector as any);
const rolesGuard = new RolesGuard(reflector as any);

function makeContext(headers: Record<string, string>, params: Record<string, any> = {}, body?: any): ExecutionContext {
  const request: Record<string, any> = { headers };
  if (Object.keys(params).length > 0) request.params = params;
  if (body !== undefined) request.body = body;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function rolesContext(token: string, controller: any, handler: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe('V1.21: FR-CHG-03 late fee rules (BR-CHG-003, BR-DUE-001, ADR-012)', () => {
  let prisma: PrismaClient;
  let rules: LateFeeRulesService;
  let charges: ChargesService;
  let lateFees: LateFeeService;
  let payments: PaymentsService;
  let refunds: RefundsService;
  let ruleController: LateFeeRulesController;
  let tenantIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    rules = new LateFeeRulesService(prisma as any);
    charges = new ChargesService(prisma as any);
    lateFees = new LateFeeService(prisma as any);
    // These services build their own collaborators by default, matching
    // test/payments.spec.ts and test/refunds.spec.ts.
    payments = new PaymentsService(prisma as any);
    refunds = new RefundsService(prisma as any, new DuesService(prisma as any));
    ruleController = new LateFeeRulesController(rules);

    const a = await prisma.tenant.create({
      data: { name: 'FR-CHG-03 Tenant A', category: 'School', timezone: 'Asia/Kolkata' },
    });
    const b = await prisma.tenant.create({
      data: { name: 'FR-CHG-03 Tenant B', category: 'Gym', timezone: 'Asia/Kolkata' },
    });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any, fullName: string) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@lf.test', 'ROLE_ADMIN', 'Admin A')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@lf.test', 'ROLE_ADMIN', 'Admin B')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@lf.test', 'ROLE_COLLECTOR', 'Collector A')).id;
    ids.userV = (await mkUser(a.id, 'view.a@lf.test', 'ROLE_VIEWER', 'Viewer A')).id;

    let phone = 0;
    ids.personA = (
      await prisma.person.create({
        data: { tenantId: a.id, fullName: 'Late Fee Person', primaryPhone: `+9199300${String(phone++).padStart(5, '0')}` },
      })
    ).id;
    ids.personB = (
      await prisma.person.create({
        data: { tenantId: b.id, fullName: 'Other Tenant', primaryPhone: `+9199300${String(phone++).padStart(5, '0')}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.receipt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.receiptSequence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.lateFeeRule.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  });

  let keySeq = 0;
  const nextKey = () => `lf-key-${Date.now()}-${keySeq++}`;

  /**
   * Each case starts from a clean tenant A so the tenant-wide sweep only
   * sees the dues the case itself created; otherwise assessedCount would
   * accumulate across tests.
   */
  async function resetTenantA() {
    await prisma.refund.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.receipt.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.payment.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.due.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.charge.deleteMany({ where: { tenantId: ids.tenantA } });
    await prisma.lateFeeRule.deleteMany({ where: { tenantId: ids.tenantA } });
  }

  /** Creates a one-time charge + its Due through the real charge path. */
  async function makeDue(opts: {
    tenantId?: string;
    personId?: string;
    userId?: string;
    net: string;
    dueDate: string;
    discountAmountMinor?: string;
    discountPercent?: number;
  }) {
    const r = await charges.createOneTimeCharge(
      opts.tenantId ?? ids.tenantA,
      opts.userId ?? ids.userA,
      {
        personId: opts.personId ?? ids.personA,
        category: 'Tuition',
        baseAmountMinor: opts.net,
        discountAmountMinor: opts.discountAmountMinor,
        discountPercent: opts.discountPercent,
        dueDate: opts.dueDate,
      },
    );
    return { charge: r.charge, due: r.due };
  }

  // ------------------------------------------------------------------
  // RULE CONFIGURATION
  // ------------------------------------------------------------------
  describe('rule configuration', () => {
    beforeEach(async () => {
      await prisma.lateFeeRule.deleteMany({ where: { tenantId: ids.tenantA } });
    });

    it('creates a FIXED rule', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '50000',
      });
      expect(rule.calculationType).toBe('FIXED');
      expect(rule.amountMinor).toBe(BigInt(50000));
      expect(rule.tenantId).toBe(ids.tenantA);
    });

    it('creates a DAILY rule', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      expect(rule.calculationType).toBe('DAILY');
    });

    it('reads the tenant rule and rejects a foreign id', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      expect(await rules.findAll(ids.tenantA)).toHaveLength(1);
      expect(await rules.findOne(ids.tenantA, rule.id)).toBeDefined();
      await expect(rules.findOne(ids.tenantB, rule.id)).rejects.toThrow(NotFoundException);
    });

    it('updates the rule amount and type', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const updated = await rules.update(ids.tenantA, rule.id, { amountMinor: '9000' });
      expect(updated.amountMinor).toBe(BigInt(9000));

      const retyped = await rules.update(ids.tenantA, rule.id, {
        calculationType: LateFeeCalculationType.DAILY,
      });
      expect(retyped.calculationType).toBe('DAILY');
    });

    it('rejects invalid rule type and amount', async () => {
      await expect(
        rules.create(ids.tenantA, {
          calculationType: 'WEEKLY' as any,
          amountMinor: '1000',
        }),
      ).rejects.toThrow();

      for (const bad of ['0', '-100', 'abc', '10.5', '']) {
        await expect(
          rules.create(ids.tenantA, {
            calculationType: LateFeeCalculationType.FIXED,
            amountMinor: bad,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects a second rule for the same tenant', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '1000',
      });
      await expect(
        rules.create(ids.tenantA, {
          calculationType: LateFeeCalculationType.DAILY,
          amountMinor: '2000',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows each tenant its own rule', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '1000',
      });
      const b = await rules.create(ids.tenantB, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '2000',
      });
      expect(b.tenantId).toBe(ids.tenantB);
      expect((await rules.findAll(ids.tenantB)).map((r) => r.amountMinor.toString())).toEqual(['2000']);
    });
  });

  // ------------------------------------------------------------------
  // CALCULATION / IDEMPOTENCY
  // ------------------------------------------------------------------
  describe('calculation and repeated evaluation', () => {
    beforeEach(async () => {
      await resetTenantA();
    });

    it('assesses no fee before the due date', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-10');
      expect(res.assessedCount).toBe(0);

      const stored = await prisma.due.findUnique({ where: { id: due.id } });
      expect(stored!.lateFeeAmount).toBe(BigInt(0));
      expect(stored!.status).toBe(DueStatus.PENDING);
    });

    it('assesses no fee on the due date itself (CurrentDate > DueDate)', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-10');
      expect(res.assessedCount).toBe(0);
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(0));
    });

    it('assesses a FIXED fee once, on the first overdue day', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-11');
      expect(res.assessedCount).toBe(1);

      const stored = await prisma.due.findUnique({ where: { id: due.id } });
      expect(stored!.lateFeeAmount).toBe(BigInt(5000));
      expect(stored!.status).toBe(DueStatus.OVERDUE);
      // Principal is untouched: netAmount/balanceRemaining stay principal-only.
      expect(stored!.netAmount).toBe(BigInt(50000));
      expect(stored!.balanceRemaining).toBe(BigInt(50000));
    });

    it('a repeated FIXED evaluation does not double-charge', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-11');
      const second = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-11');
      expect(second.assessedCount).toBe(0);

      const third = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-25');
      expect(third.assessedCount).toBe(0);

      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(5000));
    });

    it('accrues a DAILY fee per overdue day', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-11');
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(1000));

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-13');
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(3000));

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-20');
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(10000));
    });

    it('a repeated DAILY evaluation on the same day adds nothing', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-15');
      const before = (await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount;

      for (let i = 0; i < 3; i += 1) {
        const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-15');
        expect(res.assessedCount).toBe(0);
      }

      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(before);
      expect(before).toBe(BigInt(5000)); // 5 days
    });

    it('charges only the additional days when the rule amount changes between runs', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12'); // 2 days
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(2000));

      // Raising the per-day rate raises the target; only the delta is charged.
      await rules.update(ids.tenantA, rule.id, { amountMinor: '1500' });
      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');
      // target = 1500 * 2 = 3000, delta = 1000
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(3000));
    });

    it('never reduces an already charged fee when the rule is lowered', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-15'); // 5 days
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(5000));

      await rules.update(ids.tenantA, rule.id, { amountMinor: '100' });
      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-15');
      expect(res.assessedCount).toBe(0);
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(5000));
    });

    it('assesses nothing when the tenant has no rule configured', async () => {
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });
      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-04-10');
      expect(res.ruleConfigured).toBe(false);
      expect(res.assessedCount).toBe(0);
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(0));
    });

    it('skips a fully settled Due', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: due.id,
        amountMinor: '50000',
        paymentMode: 'CASH' as any,
        idempotencyKey: nextKey(),
      });

      const stored = await prisma.due.findUnique({ where: { id: due.id } });
      expect(stored!.status).toBe(DueStatus.PAID);
      expect(stored!.balanceRemaining).toBe(BigInt(0));

      const res = await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-20');
      expect(res.assessedCount).toBe(0);
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.lateFeeAmount).toBe(BigInt(0));
    });

    it('applies the principal-first priority after a late fee is accrued', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });
      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');

      // Pay 30000 of 50000 principal: late fee must stay untouched.
      const res = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: due.id,
        amountMinor: '30000',
        paymentMode: 'CASH' as any,
        idempotencyKey: nextKey(),
      });

      expect(res.allocation!.allocatedPrincipalMinor).toBe('30000');
      expect(res.allocation!.allocatedLateFeeMinor).toBe('0');

      const after = await prisma.due.findUnique({ where: { id: due.id } });
      expect(after!.balanceRemaining).toBe(BigInt(20000));
      expect(after!.lateFeeAmount).toBe(BigInt(5000));

      // The late fee is then collectable on top of the remaining principal.
      const res2 = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: due.id,
        amountMinor: '25000',
        paymentMode: 'CASH' as any,
        idempotencyKey: nextKey(),
      });
      expect(res2.allocation!.allocatedPrincipalMinor).toBe('20000');
      expect(res2.allocation!.allocatedLateFeeMinor).toBe('5000');

      const finalDue = await prisma.due.findUnique({ where: { id: due.id } });
      expect(finalDue!.balanceRemaining).toBe(BigInt(0));
      expect(finalDue!.status).toBe(DueStatus.PAID);
    });

    it('a refund allocation remains consistent after a late fee', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { charge, due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });
      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');

      const paid = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: due.id,
        amountMinor: '55000',
        paymentMode: 'CASH' as any,
        idempotencyKey: nextKey(),
      });
      const allocationId = paid.allocation!.id;

      const refunded = await refunds.refundAllocation(ids.tenantA, ids.userA, {
        paymentAllocationId: allocationId,
        refundAmountMinor: '5000',
        refundMode: 'CASH',
        refundReason: 'partial refund after late fee',
      });

      const after = await prisma.due.findUnique({ where: { id: due.id } });
      expect(refunded.due.balanceRemainingMinor).toBe('5000');
      // Principal refund reopens the balance; the late fee is not disturbed.
      expect(after!.lateFeeAmount).toBe(BigInt(5000));
      expect(after!.balanceRemaining).toBe(BigInt(5000));
      expect(charge.id).toBeDefined();
    });

    it('writes one ledger entry per assessment and none for a repeat run', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const { due } = await makeDue({ net: '50000', dueDate: '2026-03-10' });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');
      const first = await prisma.financialTransactionLog.count({
        where: { tenantId: ids.tenantA, referenceEntityId: due.id, eventType: 'LATE_FEE_ASSESSED' },
      });
      expect(first).toBe(1);

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');
      const second = await prisma.financialTransactionLog.count({
        where: { tenantId: ids.tenantA, referenceEntityId: due.id, eventType: 'LATE_FEE_ASSESSED' },
      });
      expect(second).toBe(1);

      const log = await prisma.financialTransactionLog.findFirst({
        where: { tenantId: ids.tenantA, referenceEntityId: due.id, eventType: 'LATE_FEE_ASSESSED' },
      });
      const meta = log!.metadata as Record<string, any>;
      expect(meta.calculationType).toBe('DAILY');
      expect(meta.overdueDays).toBe(2);
      expect(meta.amountPerUnitMinor).toBe('1000');
      expect(meta.assessedLateFeeMinor).toBe('2000');
    });

    it('V1.20 regression: a discounted charge still produces the correct net, with the late fee kept separate', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });
      const { due } = await makeDue({
        net: '500000',
        discountPercent: 10,
        dueDate: '2026-03-10',
      });
      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-12');

      const stored = await prisma.due.findUnique({ where: { id: due.id } });
      // 500000 - 10% = 450000 principal, plus an isolated 5000 late fee.
      expect(stored!.netAmount).toBe(BigInt(450000));
      expect(stored!.balanceRemaining).toBe(BigInt(450000));
      expect(stored!.lateFeeAmount).toBe(BigInt(5000));
    });

    it('evaluates a tenant timezone calendar day, not the UTC date', () => {
      // 2026-03-10 20:00 UTC is already 2026-03-11 in Asia/Kolkata (+05:30).
      const instant = new Date('2026-03-10T20:00:00Z');
      expect(resolveTenantDate(instant, 'Asia/Kolkata')).toBe('2026-03-11');
      expect(resolveTenantDate(instant, 'UTC')).toBe('2026-03-10');
      expect(() => resolveTenantDate(instant, 'Not/AZone')).toThrow(BadRequestException);
    });

    it('day arithmetic matches the documented boundary', () => {
      expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
      expect(daysBetween('2026-03-10', '2026-03-11')).toBe(1);
      expect(daysBetween('2026-03-10', '2026-03-31')).toBe(21);
      // Across a DST boundary in Asia/Kolkata's absence of DST, and a month edge.
      expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    });

    it('rule fee formula is exact integer minor units', () => {
      expect(calculateRuleLateFee(LateFeeCalculationType.FIXED, BigInt(500), 9)).toBe(BigInt(500));
      expect(calculateRuleLateFee(LateFeeCalculationType.DAILY, BigInt(100), 7)).toBe(BigInt(700));
      // Never negative.
      expect(calculateRuleLateFee(LateFeeCalculationType.DAILY, BigInt(100), 0)).toBe(BigInt(0));
      expect(calculateRuleLateFee(LateFeeCalculationType.DAILY, BigInt(100), -3)).toBe(BigInt(0));
    });

    it('does not assess a late fee for another tenant in the same sweep', async () => {
      await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.DAILY,
        amountMinor: '1000',
      });
      const bDue = await makeDue({
        tenantId: ids.tenantB,
        userId: ids.userB,
        personId: ids.personB,
        net: '50000',
        dueDate: '2026-03-10',
      });

      await lateFees.evaluateOverdueDues(ids.tenantA, ids.userA, '2026-03-15');
      expect((await prisma.due.findUnique({ where: { id: bDue.due.id } }))!.lateFeeAmount).toBe(BigInt(0));
    });
  });

  // ------------------------------------------------------------------
  // SECURITY
  // ------------------------------------------------------------------
  describe('security', () => {
    beforeEach(async () => {
      await resetTenantA();
    });

    it('rejects unauthenticated requests', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer expired' }))).toThrow(
        UnauthorizedException,
      );
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('denies Collector and Viewer rule management and the sweep trigger', () => {
      // dues:recalculate and the SoD principle put rule changes at Owner/Admin.
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => rolesGuard.canActivate(rolesContext(token, LateFeeRulesController, 'create'))).toThrow(
          ForbiddenException,
        );
        expect(() => rolesGuard.canActivate(rolesContext(token, LateFeeRulesController, 'update'))).toThrow(
          ForbiddenException,
        );
        expect(() => rolesGuard.canActivate(rolesContext(token, DuesController, 'assessLateFees'))).toThrow(
          ForbiddenException,
        );
      }
    });

    it('allows Admin to manage rules and trigger the sweep', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', LateFeeRulesController, 'create'))).toBe(true);
      expect(rolesGuard.canActivate(rolesContext('admin-a', DuesController, 'assessLateFees'))).toBe(true);
    });

    it('allows every authenticated role to read rules', () => {
      for (const token of ['admin-a', 'collector-a', 'viewer-a']) {
        expect(rolesGuard.canActivate(rolesContext(token, LateFeeRulesController, 'findAll'))).toBe(true);
      }
    });

    it('blocks cross-tenant read and update of a rule', async () => {
      const rule = await rules.create(ids.tenantA, {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '5000',
      });

      await expect(rules.findOne(ids.tenantB, rule.id)).rejects.toThrow(NotFoundException);
      await expect(
        rules.update(ids.tenantB, rule.id, { amountMinor: '1' }),
      ).rejects.toThrow(NotFoundException);

      expect((await rules.findOne(ids.tenantA, rule.id)).amountMinor).toBe(BigInt(5000));
    });

    it('rejects a client-supplied tenantId override', () => {
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null })),
      ).toThrow(ForbiddenException);
    });

    it('the controller derives the tenant only from the JWT', async () => {
      await prisma.lateFeeRule.deleteMany({ where: { tenantId: { in: tenantIds } } });

      const created = await ruleController.create(jwtService.verify('admin-a'), {
        calculationType: LateFeeCalculationType.FIXED,
        amountMinor: '7500',
      });
      expect(created.tenantId).toBe(ids.tenantA);
      // BR-CORE-001: BigInt serialized as a string.
      expect(created.amountMinor).toBe('7500');

      const bList = await ruleController.findAll(jwtService.verify('admin-b'));
      expect(bList).toHaveLength(0);
      await expect(
        ruleController.update(jwtService.verify('admin-b'), created.id, { amountMinor: '1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});