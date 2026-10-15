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

describe('V1.28: FR-DUE-01 real-time Due status and status filtering', () => {
  let prisma: PrismaClient;
  let dues: DuesService;
  let tenantIds: string[] = [];
  let personA: string;
  let personB: string;
  let chargeSeq = 0;

  const dayOffset = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

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
        category: `Due01Cat-${chargeSeq++}`,
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

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    dues = new DuesService(prisma as any);

    const a = await prisma.tenant.create({
      data: { name: 'FR-DUE-01 Tenant A', category: 'School', timezone: 'Asia/Kolkata' },
    });
    const b = await prisma.tenant.create({
      data: { name: 'FR-DUE-01 Tenant B', category: 'Gym', timezone: 'Asia/Kolkata' },
    });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName: email, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@due01.test', 'ROLE_ADMIN')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@due01.test', 'ROLE_ADMIN')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@due01.test', 'ROLE_COLLECTOR')).id;
    ids.userV = (await mkUser(a.id, 'view.a@due01.test', 'ROLE_VIEWER')).id;

    personA = (
      await prisma.person.create({
        data: { tenantId: a.id, fullName: 'Due01 Person A', primaryPhone: '+916000000001' },
      })
    ).id;
    personB = (
      await prisma.person.create({
        data: { tenantId: b.id, fullName: 'Due01 Person B', primaryPhone: '+916000000002' },
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

  const mkA = (o: Partial<Parameters<typeof makeDue>[0]> = {}) =>
    makeDue({
      tenantId: ids.tenantA, personId: personA, createdByUserId: ids.userA,
      dueDate: dayOffset(-5), netAmount: '500000', balanceRemaining: '500000',
      status: DueStatus.PENDING, ...o,
    } as Parameters<typeof makeDue>[0]);

  describe('A/B/I - real-time OVERDUE classification and filtering', () => {
    it('A. a stored-PENDING, genuinely overdue Due appears in GET /dues as OVERDUE', async () => {
      const due = await mkA();

      const r = await dues.findAll(ids.tenantA, {});
      const row = r.items.find((d: any) => d.id === due.id);
      expect(row).toBeDefined();
      expect(row.status).toBe(DueStatus.OVERDUE);
      // The stored value is untouched.
      expect((await prisma.due.findUnique({ where: { id: due.id } }))!.status).toBe(DueStatus.PENDING);
    });

    it('B. GET /dues?status=OVERDUE returns it despite stored PENDING', async () => {
      const overdueDue = await mkA({ dueDate: dayOffset(-3) });
      // Distractors that must not appear.
      await mkA({ dueDate: dayOffset(0), netAmount: '1000', balanceRemaining: '1000' });
      await mkA({ dueDate: dayOffset(9), netAmount: '1000', balanceRemaining: '1000' });
      await mkA({ dueDate: dayOffset(-9), netAmount: '1000', balanceRemaining: '0', status: DueStatus.PAID });
      await mkA({ dueDate: dayOffset(-9), netAmount: '1000', balanceRemaining: '1000', status: DueStatus.VOIDED });

      const r = await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
      expect(r.total).toBe(1);
      expect(r.items.map((d: any) => d.id)).toEqual([overdueDue.id]);
      expect(r.items[0].status).toBe(DueStatus.OVERDUE);

      // And it agrees with the dedicated FR-DUE-02 route.
      const viaOverdue = await dues.findOverdue(ids.tenantA, {});
      expect(viaOverdue.items.map((d: any) => d.id)).toEqual(r.items.map((d: any) => d.id));
    });

    it('I. classification works purely from read state; stored status is unchanged', async () => {
      const due = await mkA();
      const before = await prisma.due.findUnique({ where: { id: due.id } });

      await dues.findAll(ids.tenantA, {});
      await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
      await dues.findAll(ids.tenantA, { status: DueStatus.PENDING });
      await dues.findOne(ids.tenantA, due.id);

      const after = await prisma.due.findUnique({ where: { id: due.id } });
      expect(after).toEqual(before);
      expect(after!.status).toBe(DueStatus.PENDING);
      expect(after!.balanceRemaining).toBe(BigInt(500000));
    });
  });

  describe('C - GET /dues/:id', () => {
    it('C. the detail endpoint reports the same real-time status', async () => {
      const due = await mkA({ dueDate: dayOffset(-2), netAmount: '90000', balanceRemaining: '100' });
      const detail = await dues.findOne(ids.tenantA, due.id);
      expect(detail.status).toBe(DueStatus.OVERDUE);
      expect(detail.balanceRemainingMinor).toBe('100');
      // List and detail agree.
      const list = await dues.findAll(ids.tenantA, {});
      const row = list.items.find((d: any) => d.id === due.id);
      expect(row.status).toBe(detail.status);
    });
  });

  describe('D/E/F/G - negative cases', () => {
    it('D. a Due dated today is not OVERDUE', async () => {
      const due = await mkA({ dueDate: dayOffset(0) });
      expect((await dues.findOne(ids.tenantA, due.id)).status).not.toBe(DueStatus.OVERDUE);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE })).total).toBe(0);
    });

    it('E. a future Due is not OVERDUE', async () => {
      const due = await mkA({ dueDate: dayOffset(4) });
      expect((await dues.findOne(ids.tenantA, due.id)).status).not.toBe(DueStatus.OVERDUE);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE })).total).toBe(0);
    });

    it('F. a past Due with zero balance is PAID, not OVERDUE', async () => {
      const due = await mkA({ dueDate: dayOffset(-30), netAmount: '5000', balanceRemaining: '0', status: DueStatus.PAID });
      expect((await dues.findOne(ids.tenantA, due.id)).status).toBe(DueStatus.PAID);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE })).total).toBe(0);
    });

    it('G. a VOIDED Due preserves its exclusion and never becomes OVERDUE', async () => {
      const due = await mkA({ dueDate: dayOffset(-30), status: DueStatus.VOIDED });
      expect((await dues.findOne(ids.tenantA, due.id)).status).toBe(DueStatus.VOIDED);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE })).total).toBe(0);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.VOIDED })).total).toBe(1);
      // Still listed by the unfiltered list, as VOIDED.
      const all = await dues.findAll(ids.tenantA, {});
      expect(all.items.find((d: any) => d.id === due.id)!.status).toBe(DueStatus.VOIDED);
    });
  });

  describe('H - tenant timezone boundary with deterministic fake time', () => {
    it('H. the same Due is overdue for one tenant timezone and not for another', async () => {
      /*
       * 2026-06-15T18:30Z is still 2026-06-15 in UTC but already 2026-06-16 in
       * Asia/Kolkata (UTC+5:30). A Due dated 2026-06-15 with a positive balance
       * is therefore overdue for the IST tenant and merely due-today for the
       * UTC tenant. Only `Date` is faked, so Prisma's sockets are untouched.
       */
      const istTenant = await prisma.tenant.create({
        data: { name: 'FR-DUE-01 IST', category: 'School', timezone: 'Asia/Kolkata' },
      });
      const utcTenant = await prisma.tenant.create({
        data: { name: 'FR-DUE-01 UTC', category: 'School', timezone: 'UTC' },
      });
      const mk = async (tenantId: string, email: string) => {
        const u = await prisma.user.create({
          data: { tenantId, email, passwordHash: 'x', fullName: email, role: 'ROLE_ADMIN' },
        });
        const p = await prisma.person.create({
          data: { tenantId, fullName: 'TZ Person', primaryPhone: '+9160000000' + Math.floor(Math.random() * 90 + 10) },
        });
        return { userId: u.id, personId: p.id };
      };
      const ist = await mk(istTenant.id, 'ist@due01.test');
      const utc = await mk(utcTenant.id, 'utc@due01.test');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T18:30:00Z'));
      try {
        expect(resolveTenantDate(new Date(), 'UTC')).toBe('2026-06-15');
        expect(resolveTenantDate(new Date(), 'Asia/Kolkata')).toBe('2026-06-16');

        const istDue = await makeDue({
          tenantId: istTenant.id, personId: ist.personId, createdByUserId: ist.userId,
          dueDate: '2026-06-15', netAmount: '50000', balanceRemaining: '50000',
          status: DueStatus.PENDING,
        });
        const utcDue = await makeDue({
          tenantId: utcTenant.id, personId: utc.personId, createdByUserId: utc.userId,
          dueDate: '2026-06-15', netAmount: '50000', balanceRemaining: '50000',
          status: DueStatus.PENDING,
        });

        // Detail endpoint.
        expect((await dues.findOne(istTenant.id, istDue.id)).status).toBe(DueStatus.OVERDUE);
        expect((await dues.findOne(utcTenant.id, utcDue.id)).status).not.toBe(DueStatus.OVERDUE);

        // List endpoint.
        const istList = await dues.findAll(istTenant.id, {});
        expect(istList.items.find((d: any) => d.id === istDue.id)!.status).toBe(DueStatus.OVERDUE);
        const utcList = await dues.findAll(utcTenant.id, {});
        expect(utcList.items.find((d: any) => d.id === utcDue.id)!.status).not.toBe(DueStatus.OVERDUE);

        // Status filter.
        expect((await dues.findAll(istTenant.id, { status: DueStatus.OVERDUE })).total).toBe(1);
        expect((await dues.findAll(utcTenant.id, { status: DueStatus.OVERDUE })).total).toBe(0);
      } finally {
        vi.useRealTimers();
        const both = [istTenant.id, utcTenant.id];
        await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
        await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });
        await prisma.person.deleteMany({ where: { tenantId: { in: both } } });
        await prisma.user.deleteMany({ where: { tenantId: { in: both } } });
        await prisma.tenant.deleteMany({ where: { id: { in: both } } });
      }
    });
  });

  describe('J/K/L - other filters, pagination and shape preserved', () => {
    it('J. non-OVERDUE status filters keep stored-column behaviour', async () => {
      const pending = await mkA({ dueDate: dayOffset(4), netAmount: '1000', balanceRemaining: '1000' });
      const partial = await mkA({
        dueDate: dayOffset(4), netAmount: '2000', balanceRemaining: '500',
        status: DueStatus.PARTIALLY_PAID,
      });
      const paid = await mkA({
        dueDate: dayOffset(-9), netAmount: '3000', balanceRemaining: '0', status: DueStatus.PAID,
      });

      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PENDING })).total).toBe(1);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PARTIALLY_PAID })).total).toBe(1);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PAID })).total).toBe(1);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PENDING })).items[0].id).toBe(pending.id);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PARTIALLY_PAID })).items[0].id).toBe(partial.id);
      expect((await dues.findAll(ids.tenantA, { status: DueStatus.PAID })).items[0].id).toBe(paid.id);

      // personId and search filters are unaffected.
      expect((await dues.findAll(ids.tenantA, { personId: personA })).total).toBe(3);
      expect((await dues.findAll(ids.tenantA, { search: 'Due01 Person A' })).total).toBe(3);
    });

    it('K. pagination and the response envelope are unchanged', async () => {
      for (let i = 0; i < 7; i++) {
        await mkA({ dueDate: dayOffset(-(i + 1)), netAmount: '1000', balanceRemaining: '1000' });
      }

      const p1 = await dues.findAll(ids.tenantA, {});
      expect(Object.keys(p1).sort()).toEqual(['items', 'limit', 'page', 'total', 'totalPages']);
      expect(p1.page).toBe(1);
      expect(p1.limit).toBe(20);
      expect(p1.total).toBe(7);
      expect(p1.totalPages).toBe(1);
      expect(p1.items).toHaveLength(7);

      const limited = await dues.findAll(ids.tenantA, { limit: 3, page: 2 });
      expect(limited.page).toBe(2);
      expect(limited.limit).toBe(3);
      expect(limited.total).toBe(7);
      expect(limited.totalPages).toBe(3);
      expect(limited.items).toHaveLength(3);
      expect(limited.items.map((d: any) => d.id)).not.toContain(p1.items[0].id);

      // The OVERDUE branch honours the same envelope and paging.
      const over = await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
      expect(Object.keys(over).sort()).toEqual(['items', 'limit', 'page', 'total', 'totalPages']);
      expect(over.total).toBe(7);
      const overPage = await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE, limit: 2, page: 2 });
      expect(overPage.totalPages).toBe(4);
      expect(overPage.items).toHaveLength(2);
    });

    it('L. the Due response shape is unchanged', async () => {
      const due = await mkA({ netAmount: '123457', balanceRemaining: '23457' });
      const detail = await dues.findOne(ids.tenantA, due.id);
      const list = await dues.findAll(ids.tenantA, {});
      const row: any = list.items.find((d: any) => d.id === due.id);

      for (const key of [
        'id', 'tenantId', 'personId', 'chargeId', 'recurringPlanId', 'cyclePeriodKey',
        'dueDate', 'netAmountMinor', 'lateFeeAmountMinor', 'ruleLateFeeAmount',
        'balanceRemainingMinor', 'status', 'createdAt', 'updatedAt', 'person', 'charge',
      ]) {
        expect(detail).toHaveProperty(key);
      }
      // BigInt money stays exact minor-unit strings, never a float.
      expect(detail.netAmountMinor).toBe('123457');
      expect(detail.balanceRemainingMinor).toBe('23457');
      expect(typeof detail.balanceRemainingMinor).toBe('string');
      // person/charge selects are unchanged on the list endpoint.
      expect(Object.keys(row.person).sort()).toEqual(['fullName', 'id', 'primaryPhone']);
      expect(Object.keys(row.charge).sort()).toEqual(['category', 'description']);
    });
  });

  describe('M/N - tenant isolation and authentication', () => {
    it('M. Tenant A never sees Tenant B dues, through either endpoint or filter', async () => {
      const bDue = await mkA({
        tenantId: ids.tenantB, personId: personB, createdByUserId: ids.userB,
        dueDate: dayOffset(-4), netAmount: '800000', balanceRemaining: '800000',
      });
      const aDue = await mkA({ dueDate: dayOffset(-4), netAmount: '80000', balanceRemaining: '80000' });

      const listA = await dues.findAll(ids.tenantA, {});
      expect(listA.items.every((d: any) => d.tenantId === ids.tenantA)).toBe(true);
      expect(listA.items.some((d: any) => d.id === bDue.id)).toBe(false);

      const filterA = await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
      expect(filterA.items.map((d: any) => d.id)).toEqual([aDue.id]);

      // Cross-tenant detail read is a 404.
      await expect(dues.findOne(ids.tenantA, bDue.id)).rejects.toThrow(/not found/i);
    });

    it('N. authentication, roles and tenantId overrides are unchanged', async () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer invalid-token' })),
      ).toThrow(UnauthorizedException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer expired' })),
      ).toThrow(UnauthorizedException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);

      // Collector and Viewer keep read access on both GET routes.
      for (const token of ['collector-a', 'viewer-a']) {
        expect(rolesGuard.canActivate(rolesContext(token, 'findAll'))).toBe(true);
        expect(rolesGuard.canActivate(rolesContext(token, 'findOverdue'))).toBe(true);
        expect(rolesGuard.canActivate(rolesContext(token, 'findOne'))).toBe(true);
      }
      // And write routes are still Admin-gated, so the reads are not vacuous.
      expect(() => rolesGuard.canActivate(rolesContext('viewer-a', 'assessLateFees'))).toThrow(
        ForbiddenException,
      );

      // tenantId overrides are rejected by the guard.
      for (const attempt of [
        makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: [ids.tenantB] }),
      ]) {
        expect(() => authGuard.canActivate(attempt)).toThrow(ForbiddenException);
      }

      // The controller ignores any query-supplied tenantId.
      await mkA({ dueDate: dayOffset(-1) });
      const controller = new DuesController(dues, {} as any, {} as any);
      const r = await controller.findAll(jwtService.verify('admin-a'), { tenantId: ids.tenantB } as any);
      expect(r.items.every((d: any) => d.tenantId === ids.tenantA)).toBe(true);
    });
  });

  describe('O - read-only financial safety', () => {
    it('O. no financial or master record changes when dues are queried', async () => {
      const due = await mkA({ netAmount: '750000', balanceRemaining: '450000', status: DueStatus.PARTIALLY_PAID });
      const other = await mkA({ dueDate: dayOffset(2), netAmount: '1000', balanceRemaining: '1000' });

      const snapshot = async () => {
        const [d, c, p, pay, alloc, rec, ref, logs] = await Promise.all([
          prisma.due.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.charge.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.person.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.payment.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.paymentAllocation.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.receipt.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.refund.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
          prisma.financialTransactionLog.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
        ]);
        return { d, c, p, pay, alloc, rec, ref, logs };
      };

      const before = await snapshot();
      // Exercise every read path repeatedly.
      for (let i = 0; i < 3; i++) {
        await dues.findAll(ids.tenantA, {});
        await dues.findAll(ids.tenantA, { status: DueStatus.OVERDUE });
        await dues.findAll(ids.tenantA, { status: DueStatus.PENDING });
        await dues.findAll(ids.tenantB, { status: DueStatus.OVERDUE });
        await dues.findOverdue(ids.tenantA, {});
        await dues.findOne(ids.tenantA, due.id);
        await dues.findOne(ids.tenantA, other.id);
      }
      const after = await snapshot();

      expect(after).toEqual(before);
      // Every money field is bit-for-bit identical.
      const byId = new Map(before.d.map((x) => [x.id, x]));
      for (const row of after.d) {
        const prev: any = byId.get(row.id);
        expect(row.netAmount).toBe(prev.netAmount);
        expect(row.balanceRemaining).toBe(prev.balanceRemaining);
        expect(row.lateFeeAmount).toBe(prev.lateFeeAmount);
        expect(row.ruleLateFeeAmount).toBe(prev.ruleLateFeeAmount);
        expect(row.status).toBe(prev.status);
      }
      // No late fee was assessed and no ledger row written.
      expect(after.logs.length).toBe(before.logs.length);
      expect(await prisma.lateFeeRule.count({ where: { tenantId: { in: tenantIds } } })).toBe(0);
      expect(after.pay.length).toBe(before.pay.length);
      expect(after.rec.length).toBe(before.rec.length);
      expect(after.alloc.length).toBe(before.alloc.length);
      expect(after.ref.length).toBe(before.ref.length);
      expect(after.c.length).toBe(before.c.length);
      // Explicit timeout: this case issues ~23 read batches plus two
      // eight-table snapshots, which can exceed vitest's 5s default when the
      // full suite runs its files in parallel. No assertion is relaxed.
    }, 60000);
  });
});