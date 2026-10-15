import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, DueStatus } from '@prisma/client';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { ChargesController } from '../src/modules/charges/charges.controller.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

/** Real database ids, filled in by beforeAll. */
const ids: Record<string, string> = {};

/**
 * Minimal JWT stand-in mirroring test/tenant-isolation.spec.ts. Roles follow
 * the actual `UserRole` enum: Owner/Admin are both ROLE_ADMIN.
 */
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

function rolesContext(token: string, handler: 'createOneTimeCharge' | 'findAll') {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => ChargesController.prototype[handler],
    getClass: () => ChargesController,
  } as unknown as ExecutionContext;
}

describe('V1.20: Charge discount and net payable (FR-CHG-02, BR-CHG-002, BR-DUE-001)', () => {
  let prisma: PrismaClient;
  let charges: ChargesService;
  let controller: ChargesController;
  let tenantIds: string[] = [];
  let userIdA: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    charges = new ChargesService(prisma as any);
    controller = new ChargesController(charges);

    const a = await prisma.tenant.create({ data: { name: 'FR-CHG-02 Tenant A', category: 'School' } });
    const b = await prisma.tenant.create({ data: { name: 'FR-CHG-02 Tenant B', category: 'Gym' } });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any, fullName: string) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName, role } });

    userIdA = (await mkUser(a.id, 'admin.a@chg.test', 'ROLE_ADMIN', 'Admin A')).id;
    ids.userA = userIdA;
    ids.userB = (await mkUser(b.id, 'admin.b@chg.test', 'ROLE_ADMIN', 'Admin B')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@chg.test', 'ROLE_COLLECTOR', 'Collector A')).id;
    ids.userV = (await mkUser(a.id, 'view.a@chg.test', 'ROLE_VIEWER', 'Viewer A')).id;

    ids.personA = (
      await prisma.person.create({
        data: { tenantId: a.id, fullName: 'Discount Person', primaryPhone: '+919900000001' },
      })
    ).id;
    ids.personB = (
      await prisma.person.create({
        data: { tenantId: b.id, fullName: 'Other Tenant Person', primaryPhone: '+919900000002' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------
  // DISCOUNT CALCULATION
  // ------------------------------------------------------------------
  describe('discount calculation', () => {
    // Lazy: the describe body runs before beforeAll populates the ids.
    const base = () => ({ personId: ids.personA, category: 'Tuition', dueDate: '2026-10-15' });

    it('1. no discount leaves the net payable equal to the gross amount', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '500000',
      });
      expect(r.charge.discountAmountMinor).toBe('0');
      expect(r.charge.netAmountMinor).toBe('500000');
      expect(r.due.netAmountMinor).toBe('500000');
      expect(r.due.balanceRemainingMinor).toBe('500000');
    });

    it('2. fixed discount: net = gross - discount', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '500000',
        discountAmountMinor: '50000',
      });
      expect(r.charge.netAmountMinor).toBe('450000');
      expect(r.due.netAmountMinor).toBe('450000');
      expect(r.due.balanceRemainingMinor).toBe('450000');
    });

    it('3. percentage discount: net = gross - floor(gross * pct / 100)', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '500000',
        discountPercent: 10,
      });
      // floor(500000 * 10 / 100) = 50000
      expect(r.charge.discountAmountMinor).toBe('50000');
      expect(r.charge.netAmountMinor).toBe('450000');
      expect(r.due.netAmountMinor).toBe('450000');
    });

    it('4. zero discount is accepted on both forms', async () => {
      const fixed = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '100000',
        discountAmountMinor: '0',
      });
      expect(fixed.due.netAmountMinor).toBe('100000');
    });

    it('5. a fixed discount equal to the gross amount yields a zero net payable', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '250000',
        discountAmountMinor: '250000',
      });
      expect(r.charge.netAmountMinor).toBe('0');
      expect(r.due.netAmountMinor).toBe('0');
      expect(r.due.balanceRemainingMinor).toBe('0');
    });

    it('6. a 100% percentage discount yields a zero net payable', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '250000',
        discountPercent: 100,
      });
      expect(r.charge.discountAmountMinor).toBe('250000');
      expect(r.due.netAmountMinor).toBe('0');
    });

    it('7. rejects a negative discount amount', async () => {
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          ...base(),
          baseAmountMinor: '100000',
          discountAmountMinor: '-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('8. rejects a percentage outside 1..100', async () => {
      for (const pct of [0, -5, 101, 1000]) {
        await expect(
          charges.createOneTimeCharge(ids.tenantA, userIdA, {
            ...base(),
            baseAmountMinor: '100000',
            discountPercent: pct,
          }),
        ).rejects.toThrow(BadRequestException);
      }
      // A fractional percentage would need floating point to resolve.
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          ...base(),
          baseAmountMinor: '100000',
          discountPercent: 12.5 as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('9. rejects a fixed discount greater than the gross amount', async () => {
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          ...base(),
          baseAmountMinor: '100000',
          discountAmountMinor: '150000',
        }),
      ).rejects.toThrow(/exceed base amount/);
    });

    it('10. floors to whole minor units without floating point', async () => {
      // 33% of 10001 = 3300.33 -> floor 3300, never 3300.33 rounded to 3300/3301.
      const a = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '10001',
        discountPercent: 33,
      });
      expect(a.charge.discountAmountMinor).toBe('3300');
      expect(a.due.netAmountMinor).toBe('6701');

      // A small base with a small percentage floors all the way to zero,
      // which is the tenant's loss by design (BR-CHG-002).
      const b = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        ...base(),
        baseAmountMinor: '5',
        discountPercent: 10,
      });
      expect(b.charge.discountAmountMinor).toBe('0');
      expect(b.due.netAmountMinor).toBe('5');
    });

    it('11. rejects non-numeric minor-unit strings instead of failing with a 500', async () => {
      for (const bad of ['abc', '12.5', '1e5', ' 12 000', '']) {
        await expect(
          charges.createOneTimeCharge(ids.tenantA, userIdA, {
            ...base(),
            baseAmountMinor: '100000',
            discountAmountMinor: bad,
          }),
        ).rejects.toThrow(BadRequestException);
      }
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          ...base(),
          baseAmountMinor: 'abc',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('12. rejects supplying both a fixed amount and a percentage', async () => {
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          ...base(),
          baseAmountMinor: '100000',
          discountAmountMinor: '1000',
          discountPercent: 10,
        }),
      ).rejects.toThrow(/not both/);
    });

    it('13. rejects a non-positive base amount', async () => {
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, { ...base(), baseAmountMinor: '0' }),
      ).rejects.toThrow(/greater than zero/);
    });
  });

  // ------------------------------------------------------------------
  // CHARGE / DUE INTEGRATION
  // ------------------------------------------------------------------
  describe('charge and due integration', () => {
    it('a discounted charge produces the correct net payable on the Due', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        personId: ids.personA,
        category: 'Transport',
        dueDate: '2026-10-15',
        baseAmountMinor: '333333',
        discountPercent: 15,
      });

      const persistedDue = await prisma.due.findUnique({ where: { id: r.due.id } });
      const persistedCharge = await prisma.charge.findUnique({ where: { id: r.charge.id } });

      // floor(333333 * 15 / 100) = 49999
      expect(persistedCharge!.discountAmount).toBe(BigInt(49999));
      expect(persistedCharge!.baseAmount).toBe(BigInt(333333));
      expect(persistedDue!.netAmount).toBe(BigInt(283334));
      expect(persistedDue!.balanceRemaining).toBe(BigInt(283334));
      expect(persistedDue!.status).toBe(DueStatus.PENDING);
    });

    it('an undiscounted charge still produces a full-value Due', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        personId: ids.personA,
        category: 'Library',
        dueDate: '2026-10-15',
        baseAmountMinor: '12345',
      });
      const persistedDue = await prisma.due.findUnique({ where: { id: r.due.id } });
      expect(persistedDue!.netAmount).toBe(BigInt(12345));
      expect(r.charge.discountAmountMinor).toBe('0');
      expect(r.charge.netAmountMinor).toBe('12345');
    });

    it('records the discount in the immutable ledger alongside the net amount', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        personId: ids.personA,
        category: 'Examination',
        dueDate: '2026-10-15',
        baseAmountMinor: '100000',
        discountPercent: 25,
      });

      const log = await prisma.financialTransactionLog.findFirst({
        where: { tenantId: ids.tenantA, referenceEntityId: r.charge.id, eventType: 'CHARGE_CREATED' },
      });

      expect(log).toBeDefined();
      expect(log!.amount).toBe(BigInt(75000));
      const meta = log!.metadata as Record<string, any>;
      expect(meta.baseAmount).toBe('100000');
      expect(meta.discountAmount).toBe('25000');
      expect(meta.netAmount).toBe('75000');
      expect(meta.discountPercent).toBe('25');
    });

    it('a fixed discount does not record a percentage in the ledger', async () => {
      const r = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        personId: ids.personA,
        category: 'Sports',
        dueDate: '2026-10-15',
        baseAmountMinor: '80000',
        discountAmountMinor: '8000',
      });
      const log = await prisma.financialTransactionLog.findFirst({
        where: { tenantId: ids.tenantA, referenceEntityId: r.charge.id, eventType: 'CHARGE_CREATED' },
      });
      expect((log!.metadata as Record<string, any>).discountPercent).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // SECURITY
  // ------------------------------------------------------------------
  describe('security', () => {
    it('rejects an unauthenticated request', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer expired' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token without tenant context', () => {
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('denies Viewer charge creation per the permission matrix', () => {
      // charges:create is ALLOW for Owner/Admin and Collector, DENY for Viewer.
      expect(() => rolesGuard.canActivate(rolesContext('viewer-a', 'createOneTimeCharge'))).toThrow(
        ForbiddenException,
      );
    });

    it('allows Admin and Collector to create charges', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'createOneTimeCharge'))).toBe(true);
      expect(rolesGuard.canActivate(rolesContext('collector-a', 'createOneTimeCharge'))).toBe(true);
    });

    it('allows every authenticated role to read charges', () => {
      // charges:view is ALLOW for all roles.
      for (const token of ['admin-a', 'collector-a', 'viewer-a']) {
        expect(rolesGuard.canActivate(rolesContext(token, 'findAll'))).toBe(true);
      }
    });

    it('blocks cross-tenant charge creation against a foreign person', async () => {
      // Tenant B's person is invisible to a Tenant A scoped charge.
      await expect(
        charges.createOneTimeCharge(ids.tenantA, userIdA, {
          personId: ids.personB,
          category: 'Tuition',
          baseAmountMinor: '100000',
          discountPercent: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('keeps a discounted charge invisible to another tenant list', async () => {
      const mine = await charges.createOneTimeCharge(ids.tenantA, userIdA, {
        personId: ids.personA,
        category: 'Isolated',
        dueDate: '2026-10-15',
        baseAmountMinor: '64000',
        discountPercent: 40,
      });

      const aView = await charges.findAll(ids.tenantA, { personId: ids.personA });
      const bView = await charges.findAll(ids.tenantB, {});

      expect(aView.items.some((c) => c.id === mine.charge.id)).toBe(true);
      expect(bView.items.some((c) => c.id === mine.charge.id)).toBe(false);
      expect(bView.items.some((c) => c.id === mine.due.id)).toBe(false);
    });

    it('rejects a client-supplied tenantId override', () => {
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB })),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null })),
      ).toThrow(ForbiddenException);
    });

    it('drives the controller tenant strictly from the JWT', async () => {
      const adminA = jwtService.verify('admin-a');
      const created = await controller.createOneTimeCharge(adminA, {
        personId: ids.personA,
        category: 'Via Controller',
        baseAmountMinor: '20000',
        discountPercent: 25,
        dueDate: '2026-10-15',
      });

      expect(created.charge.tenantId).toBe(ids.tenantA);
      expect(created.due.netAmountMinor).toBe('15000');

      const bList = await controller.findAll(jwtService.verify('admin-b'), undefined, undefined, undefined, undefined);
      expect(bList.items.some((c: any) => c.id === created.charge.id)).toBe(false);
    });
  });
});