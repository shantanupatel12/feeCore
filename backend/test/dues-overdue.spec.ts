import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, DueStatus } from '@prisma/client';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { DuesController } from '../src/modules/dues/dues.controller.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { resolveTenantDate } from '../src/modules/payments/services/late-fee.service.js';
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

function rolesContext(token: string, handler: keyof DuesController) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => DuesController.prototype[handler],
    getClass: () => DuesController,
  } as unknown as ExecutionContext;
}

describe('V1.27: FR-DUE-02 overdue Due query (BR-10)', () => {
  let prisma: PrismaClient;
  let dues: DuesService;
  let tenantIds: string[] = [];
  let personA: string;
  let personB: string;
  let chargeSeq = 0;

  /** Calendar day offset from the tenant's "today". */
  const dayOffset = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const today = () => dayOffset(0);
  const yesterday = () => dayOffset(-1);
  const tomorrow = () => dayOffset(1);

  /**
   * Creates a Due directly so the stored `status` can be chosen freely,
   * independent of any late-fee rule.
   */
  async function makeDue(opts: {
    tenantId: string;
    personId: string;
    createdByUserId: string;
    dueDate: string;
    netAmount: string;
    balanceRemaining: string;
    status: DueStatus;
  }) {
    const charge = await prisma.charge.create({
      data: {
        tenantId: opts.tenantId,
        personId: opts.personId,
        category: `OverdueCat-${chargeSeq++}`,
        baseAmount: BigInt(opts.netAmount),
        createdByUserId: opts.createdByUserId,
      },
    });

    return prisma.due.create({
      data: {
        tenantId: opts.tenantId,
        personId: opts.personId,
        chargeId: charge.id,
        dueDate: new Date(`${opts.dueDate}T00:00:00Z`),
        netAmount: BigInt(opts.netAmount),
        balanceRemaining: BigInt(opts.balanceRemaining),
        status: opts.status,
      },
    });
  }

  const overdue = (tenantKey: string, query: any = {}) =>
    dues.findOverdue(jwtService.verify(tenantKey).tenantId, query);

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    dues = new DuesService(prisma as any);

    const a = await prisma.tenant.create({
      data: { name: 'FR-DUE-02 Tenant A', category: 'School', timezone: 'Asia/Kolkata' },
    });
    const b = await prisma.tenant.create({
      data: { name: 'FR-DUE-02 Tenant B', category: 'Gym', timezone: 'Asia/Kolkata' },
    });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName: email, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@due2.test', 'ROLE_ADMIN')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@due2.test', 'ROLE_ADMIN')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@due2.test', 'ROLE_COLLECTOR')).id;
    ids.userV = (await mkUser(a.id, 'view.a@due2.test', 'ROLE_VIEWER')).id;

    personA = (
      await prisma.person.create({
        data: { tenantId: a.id, fullName: 'Overdue Person A', primaryPhone: '+917000000001' },
      })
    ).id;
    personB = (
      await prisma.person.create({
        data: { tenantId: b.id, fullName: 'Overdue Person B', primaryPhone: '+917000000002' },
      })
    ).id;
  });

  afterAll(async () => {
    for (const t of tenantIds) {
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.lateFeeRule.deleteMany({ where: { tenantId: t } });
      await prisma.due.deleteMany({ where: { tenantId: t } });
      await prisma.charge.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
  });

  describe('FUNCTIONAL', () => {
    it('1. past due + positive balance is returned', async () => {
      await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: dayOffset(-10),
        netAmount: '500000',
        balanceRemaining: '500000',
        status: DueStatus.PENDING,
      });

      const r = await overdue('admin-a');
      expect(r.total).toBe(1);
      expect(r.items).toHaveLength(1);
      expect(r.items[0].status).toBe(DueStatus.OVERDUE);
      expect(r.items[0].balanceRemainingMinor).toBe('500000');
    });

    it('2. stored status PENDING is returned as OVERDUE (derived, not stored)', async () => {
      const due = await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: dayOffset(-5),
        netAmount: '100000',
        balanceRemaining: '40000',
        status: DueStatus.PENDING,
      });

      // The stored value really is PENDING.
      const stored = await prisma.due.findUnique({ where: { id: due.id } });
      expect(stored!.status).toBe(DueStatus.PENDING);

      const r = await overdue('admin-a');
      expect(r.total).toBe(1);
      expect(r.items[0].id).toBe(due.id);
      expect(r.items[0].status).toBe(DueStatus.OVERDUE);

      // V1.28 (FR-DUE-01): the stored-status filter used to miss this due
      // entirely (it returned 0) because it filtered the persisted column
      // before evaluation. It now agrees with the dedicated overdue route.
      const filtered = await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0].id).toBe(due.id);
      expect(filtered.items[0].status).toBe(DueStatus.OVERDUE);
    });

    it('3. returned with no late-fee rule configured and no fee assessed', async () => {
      expect(await prisma.lateFeeRule.count({ where: { tenantId: ids.tenantA } })).toBe(0);

      await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: dayOffset(-3),
        netAmount: '250000',
        balanceRemaining: '250000',
        status: DueStatus.PENDING,
      });

      const r = await overdue('admin-a');
      expect(r.total).toBe(1);
      // Nothing was assessed.
      const stored = await prisma.due.findMany({ where: { tenantId: ids.tenantA } });
      expect(stored[0].lateFeeAmount).toBe(BigInt(0));
      expect(stored[0].ruleLateFeeAmount).toBe(BigInt(0));
      expect(stored[0].status).toBe(DueStatus.PENDING);
    });

    it('4. due today + positive balance is NOT overdue', async () => {
      await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: today(),
        netAmount: '10000',
        balanceRemaining: '10000',
        status: DueStatus.PENDING,
      });
      expect((await overdue('admin-a')).total).toBe(0);
    });

    it('5. future due + positive balance is NOT overdue', async () => {
      await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: tomorrow(),
        netAmount: '10000',
        balanceRemaining: '10000',
        status: DueStatus.PENDING,
      });
      expect((await overdue('admin-a')).total).toBe(0);
    });

    it('6. past due + zero balance is NOT overdue', async () => {
      await makeDue({
        tenantId: ids.tenantA,
        personId: personA,
        createdByUserId: ids.userA,
        dueDate: dayOffset(-30),
        netAmount: '75000',
        balanceRemaining: '0',
        status: DueStatus.PAID,
      });
      expect((await overdue('admin-a')).total).toBe(0);
    });

    it('7. only qualifying dues are returned, ordered by due date', async () => {
      const wanted = [
        dayOffset(-2),
        dayOffset(-1),
        dayOffset(-40),
      ];
      for (const d of wanted) {
        await makeDue({
          tenantId: ids.tenantA,
          personId: personA,
          createdByUserId: ids.userA,
          dueDate: d,
          netAmount: '1000',
          balanceRemaining: '1000',
          status: DueStatus.PENDING,
        });
      }
      // Non-qualifying distractors.
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: today(), netAmount: '1000', balanceRemaining: '1000', status: DueStatus.PENDING,
      });
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-60), netAmount: '1000', balanceRemaining: '0', status: DueStatus.PAID,
      });
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-60), netAmount: '1000', balanceRemaining: '1000', status: DueStatus.VOIDED,
      });
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(+5), netAmount: '1000', balanceRemaining: '1000', status: DueStatus.PENDING,
      });

      const r = await overdue('admin-a');
      expect(r.total).toBe(3);
      const dates = r.items.map((d: any) => d.dueDate.toISOString().slice(0, 10));
      expect(dates).toEqual([...wanted].sort());
      expect(r.items.every((d: any) => d.status === DueStatus.OVERDUE)).toBe(true);
    });

    it('8. the response shape matches the existing dues contract', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-7), netAmount: '90000', balanceRemaining: '30000',
        status: DueStatus.PARTIALLY_PAID,
      });

      const over = await overdue('admin-a');
      const all = await dues.findAll(ids.tenantA, {});
      const a = over.items[0];
      const b: any = all.items.find((x: any) => x.id === a.id);

      // Same keys as the canonical list endpoint.
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const key of [
        'id', 'tenantId', 'personId', 'chargeId', 'dueDate', 'status',
        'netAmountMinor', 'lateFeeAmountMinor', 'balanceRemainingMinor',
        'ruleLateFeeAmount', 'cyclePeriodKey', 'recurringPlanId', 'createdAt', 'updatedAt',
      ]) {
        expect(a).toHaveProperty(key);
      }
      // Person/charge joins match the existing shape.
      expect(a.person.fullName).toBe('Overdue Person A');
      expect(a.charge.category).toMatch(/^OverdueCat-/);
      // Money is exact minor-unit strings.
      expect(a.netAmountMinor).toBe('90000');
      expect(a.balanceRemainingMinor).toBe('30000');
      expect(typeof a.balanceRemainingMinor).toBe('string');

      // Envelope matches findAll.
      expect(Object.keys(over).sort()).toEqual(Object.keys(all).sort());
      expect(over).toHaveProperty('total');
      expect(over).toHaveProperty('page');
      expect(over).toHaveProperty('limit');
      expect(over).toHaveProperty('totalPages');
    });

    it('9. the existing normal dues endpoint is unchanged', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-8), netAmount: '45000', balanceRemaining: '45000',
        status: DueStatus.PENDING,
      });
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: tomorrow(), netAmount: '55000', balanceRemaining: '55000',
        status: DueStatus.PENDING,
      });

      const all = await dues.findAll(ids.tenantA, {});
      // Both dues are listed.
      expect(all.total).toBe(2);
      // And the list still derives OVERDUE for display on the past-due one.
      const past = all.items.find((d: any) => d.balanceRemainingMinor === '45000');
      expect(past.status).toBe(DueStatus.OVERDUE);
      // Filtering by person still works.
      expect((await dues.findAll(ids.tenantA, { personId: personA })).total).toBe(2);
      // Search still works.
      expect((await dues.findAll(ids.tenantA, { search: 'Overdue Person A' })).total).toBe(2);
      // Non-overdue status filters keep their stored-column behaviour; only
      // OVERDUE became real-time in V1.28 (FR-DUE-01).
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PENDING })).total).toBe(2);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PAID })).total).toBe(0);
      // One due is 8 days past with a balance: genuinely overdue despite its
      // stored status being PENDING.
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE })).total).toBe(1);
    });
  });

  describe('SECURITY', () => {
    it('10. unauthenticated requests are rejected with 401', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
    });

    it('11. an invalid token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer not-a-real-token' })),
      ).toThrow(UnauthorizedException);
    });

    it('12. an expired token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer expired' })),
      ).toThrow(UnauthorizedException);
    });

    it('13. a tenantless JWT is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);
    });

    it('14. no role is denied: dues:view is ALLOW for Admin, Collector and Viewer', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'findOverdue'))).toBe(true);
      expect(rolesGuard.canActivate(rolesContext('collector-a', 'findOverdue'))).toBe(true);
      expect(rolesGuard.canActivate(rolesContext('viewer-a', 'findOverdue'))).toBe(true);
      // Sanity check that the guard really does deny a non-view role elsewhere,
      // so the passes above are meaningful rather than vacuous.
      expect(() => rolesGuard.canActivate(rolesContext('viewer-a', 'assessLateFees'))).toThrow(
        ForbiddenException,
      );
    });

    it('15. Tenant A cannot see Tenant B overdue dues', async () => {
      const bDue = await makeDue({
        tenantId: ids.tenantB, personId: personB, createdByUserId: ids.userB,
        dueDate: dayOffset(-15), netAmount: '700000', balanceRemaining: '700000',
        status: DueStatus.PENDING,
      });
      const aDue = await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-6), netAmount: '60000', balanceRemaining: '60000',
        status: DueStatus.PENDING,
      });

      const forA = await overdue('admin-a');
      const forB = await overdue('admin-b');

      expect(forA.items.map((d: any) => d.id)).toEqual([aDue.id]);
      expect(forA.items.some((d: any) => d.id === bDue.id)).toBe(false);
      expect(forA.items.some((d: any) => d.tenantId === ids.tenantB)).toBe(false);
      expect(forA.items.some((d: any) => d.personName === 'Overdue Person B')).toBe(false);

      expect(forB.items.map((d: any) => d.id)).toEqual([bDue.id]);
      expect(forB.items.some((d: any) => d.id === aDue.id)).toBe(false);
    });

    it('16. a client-supplied tenantId cannot change the tenant scope', () => {
      for (const attempt of [
        makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: [ids.tenantB] }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: { id: ids.tenantB } }),
      ]) {
        expect(() => authGuard.canActivate(attempt)).toThrow(ForbiddenException);
      }
    });

    it('16b. the controller derives the tenant only from the JWT', async () => {
      await makeDue({
        tenantId: ids.tenantB, personId: personB, createdByUserId: ids.userB,
        dueDate: dayOffset(-9), netAmount: '8000', balanceRemaining: '8000',
        status: DueStatus.PENDING,
      });

      const controller = new DuesController(dues, {} as any, {} as any);
      // Calling through the controller with an admin-a user can only ever see
      // tenant A, because the path/query tenant is never consulted.
      const r = await controller.findOverdue(jwtService.verify('admin-a'), { tenantId: ids.tenantB } as any);
      expect(r.items.every((d: any) => d.tenantId === ids.tenantA)).toBe(true);
      expect(r.total).toBe(0);
    });
  });

  describe('READ-ONLY', () => {
    /** Deep snapshot of every table the requirement protects. */
    async function snapshot() {
      const [duesR, charges, people, payments, allocations, receipts, refunds, logs] =
        await Promise.all([
          prisma.due.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.charge.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.person.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.payment.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.paymentAllocation.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.receipt.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.refund.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.financialTransactionLog.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
        ]);
      return { dues: duesR, charges, people, payments, allocations, receipts, refunds, logs };
    }

    it('17. the GET causes no database mutation at all', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-12), netAmount: '120000', balanceRemaining: '45000',
        status: DueStatus.PARTIALLY_PAID,
      });

      const before = await snapshot();
      await overdue('admin-a');
      await overdue('admin-a', { personId: personA });
      await overdue('admin-a', { search: 'Overdue Person' });
      await overdue('admin-b');
      const after = await snapshot();

      expect(after).toEqual(before);
      expect(after.dues[0].status).toBe(DueStatus.PARTIALLY_PAID);
    });

    it('18. no late fee is assessed and no late-fee rule is created', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-20), netAmount: '200000', balanceRemaining: '200000',
        status: DueStatus.PENDING,
      });

      await overdue('admin-a');

      expect(await prisma.lateFeeRule.count({ where: { tenantId: ids.tenantA } })).toBe(0);
      const stored = await prisma.due.findMany({ where: { tenantId: ids.tenantA } });
      for (const d of stored) {
        expect(d.lateFeeAmount).toBe(BigInt(0));
        expect(d.ruleLateFeeAmount).toBe(BigInt(0));
        expect(d.status).toBe(DueStatus.PENDING);
      }
      expect(await prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } })).toBe(0);
    });

    it('19. no ledger entry is written', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-4), netAmount: '330000', balanceRemaining: '330000',
        status: DueStatus.PENDING,
      });

      const before = await prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } });
      for (let i = 0; i < 3; i += 1) {
        await overdue('admin-a');
      }
      expect(await prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } })).toBe(before);
      expect(before).toBe(0);
    });

    it('20. no payment, receipt, allocation or refund is created or changed', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-25), netAmount: '540000', balanceRemaining: '540000',
        status: DueStatus.PENDING,
      });

      const counts = () =>
        Promise.all([
          prisma.payment.count({ where: { tenantId: { in: tenantIds } } }),
          prisma.receipt.count({ where: { tenantId: { in: tenantIds } } }),
          prisma.paymentAllocation.count({ where: { tenantId: { in: tenantIds } } }),
          prisma.refund.count({ where: { tenantId: { in: tenantIds } } }),
        ]).then(([payments, receipts, allocations, refunds]) => ({
          payments, receipts, allocations, refunds,
        }));

      const before = await counts();
      await overdue('admin-a');
      await overdue('admin-b');
      expect(await counts()).toEqual(before);
      expect(before).toEqual({ payments: 0, receipts: 0, allocations: 0, refunds: 0 });
    });
  });

  describe('DATE BOUNDARIES', () => {
    it('21. exactly today is not overdue, exactly yesterday is', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: today(), netAmount: '11000', balanceRemaining: '11000', status: DueStatus.PENDING,
      });
      expect((await overdue('admin-a')).total).toBe(0);

      await prisma.due.deleteMany({ where: { tenantId: ids.tenantA } });
      await prisma.charge.deleteMany({ where: { tenantId: ids.tenantA } });

      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: yesterday(), netAmount: '11000', balanceRemaining: '11000', status: DueStatus.PENDING,
      });
      const r = await overdue('admin-a');
      expect(r.total).toBe(1);
      expect(r.items[0].status).toBe(DueStatus.OVERDUE);
    });

    it('22. every boundary holds for a range of offsets', async () => {
      // Past offsets are overdue; today and future are not.
      for (const [offset, expectOverdue] of [
        [-1, true], [-2, true], [-30, true], [-365, true],
        [0, false], [1, false], [7, false], [365, false],
      ] as Array<[number, boolean]>) {
        await prisma.due.deleteMany({ where: { tenantId: ids.tenantA } });
        await prisma.charge.deleteMany({ where: { tenantId: ids.tenantA } });
        await makeDue({
          tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
          dueDate: dayOffset(offset), netAmount: '1000', balanceRemaining: '1000',
          status: DueStatus.PENDING,
        });
        expect((await overdue('admin-a')).total).toBe(expectOverdue ? 1 : 0);
      }
    });

    it('23. future due dates are never overdue', async () => {
      for (const offset of [1, 2, 30, 400]) {
        await prisma.due.deleteMany({ where: { tenantId: ids.tenantA } });
        await prisma.charge.deleteMany({ where: { tenantId: ids.tenantA } });
        await makeDue({
          tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
          dueDate: dayOffset(offset), netAmount: '2000', balanceRemaining: '2000',
          status: DueStatus.PENDING,
        });
        expect((await overdue('admin-a')).total).toBe(0);
      }
    });

    it('24. a past due with zero balance is excluded, and a tiny balance is not', async () => {
      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-50), netAmount: '5000', balanceRemaining: '0',
        status: DueStatus.PAID,
      });
      expect((await overdue('admin-a')).total).toBe(0);

      await makeDue({
        tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
        dueDate: dayOffset(-50), netAmount: '5000', balanceRemaining: '1',
        status: DueStatus.PARTIALLY_PAID,
      });
      const r = await overdue('admin-a');
      expect(r.total).toBe(1);
      expect(r.items[0].balanceRemainingMinor).toBe('1');
    });

    it('25. the calendar day is resolved in the tenant timezone, not UTC', async () => {
      /*
       * Fix the instant so the two timezones are guaranteed to be on
       * different calendar days: 2026-06-15T12:00Z is still 2026-06-15 in
       * UTC but already 2026-06-16 in Pacific/Kiritimati (UTC+14).
       *
       * Only `Date` is faked, so Prisma's real sockets and timers are
       * unaffected.
       */
      const tzTenant = await prisma.tenant.create({
        data: { name: 'FR-DUE-02 TZ Tenant', category: 'School', timezone: 'Pacific/Kiritimati' },
      });
      const utcTenant = await prisma.tenant.create({
        data: { name: 'FR-DUE-02 UTC Tenant', category: 'School', timezone: 'UTC' },
      });
      const mk = async (tenantId: string, email: string) => {
        const u = await prisma.user.create({
          data: { tenantId, email, passwordHash: 'x', fullName: email, role: 'ROLE_ADMIN' },
        });
        const p = await prisma.person.create({
          data: { tenantId, fullName: 'TZ Person', primaryPhone: '+9170000000' + Math.floor(Math.random() * 90 + 10) },
        });
        return { userId: u.id, personId: p.id };
      };
      const tz = await mk(tzTenant.id, 'tz@due2.test');
      const utc = await mk(utcTenant.id, 'utc@due2.test');

      // The very same calendar due date in both tenants.
      const dueDate = '2026-06-15';

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
      try {
        // Guard the premise of the test itself.
        expect(resolveTenantDate(new Date(), 'UTC')).toBe('2026-06-15');
        expect(resolveTenantDate(new Date(), 'Pacific/Kiritimati')).toBe('2026-06-16');

        const kiritimatiDue = await makeDue({
          tenantId: tzTenant.id, personId: tz.personId, createdByUserId: tz.userId,
          dueDate, netAmount: '60000', balanceRemaining: '60000', status: DueStatus.PENDING,
        });
        const utcDue = await makeDue({
          tenantId: utcTenant.id, personId: utc.personId, createdByUserId: utc.userId,
          dueDate, netAmount: '60000', balanceRemaining: '60000', status: DueStatus.PENDING,
        });

        const inKiritimati = await dues.findOverdue(tzTenant.id, {});
        const inUtc = await dues.findOverdue(utcTenant.id, {});

        // Kiritimati's calendar day is already 2026-06-16, so the 06-15 due is
        // past due there; UTC still considers it due today, so it is not.
        expect(inKiritimati.total).toBe(1);
        expect(inKiritimati.items[0].id).toBe(kiritimatiDue.id);
        expect(inKiritimati.items[0].status).toBe(DueStatus.OVERDUE);
        expect(inUtc.total).toBe(0);
        expect(inUtc.items.some((d: any) => d.id === utcDue.id)).toBe(false);
      } finally {
        vi.useRealTimers();
        await prisma.due.deleteMany({ where: { tenantId: { in: [tzTenant.id, utcTenant.id] } } });
        await prisma.charge.deleteMany({ where: { tenantId: { in: [tzTenant.id, utcTenant.id] } } });
        await prisma.person.deleteMany({ where: { tenantId: { in: [tzTenant.id, utcTenant.id] } } });
        await prisma.user.deleteMany({ where: { tenantId: { in: [tzTenant.id, utcTenant.id] } } });
        await prisma.tenant.deleteMany({ where: { id: { in: [tzTenant.id, utcTenant.id] } } });
      }
    });
  });
});