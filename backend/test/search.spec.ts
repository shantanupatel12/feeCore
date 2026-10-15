import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, UserRole } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

import { SearchService } from '../src/modules/search/search.service.js';
import { SearchController } from '../src/modules/search/search.controller.js';
import { SearchQueryDto } from '../src/modules/search/dto/search-query.dto.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { OrganizationsService } from '../src/modules/organizations/organizations.service.js';

describe('V1.18: Global search (FR-SRH-01)', () => {
  let prisma: PrismaClient;
  let search: SearchService;
  let payments: PaymentsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let adminB: string;
  let personA: string;
  let personB: string;

  // Receipt numbers are the real issued ones, discovered after issue.
  let receiptNumberA: string;
  let receiptNumberB: string;

  let keySeq = 0;
  const nextKey = () => `srch-key-${Date.now()}-${keySeq++}`;

  const userFor = (tenantId: string, role: UserRole) =>
    ({ sub: 'u', tenantId, email: 'x@y.z', role }) as JwtPayload;

  async function issueReceipt(tenantId: string, userId: string, personId: string) {
    const charge = await prisma.charge.create({
      data: {
        tenantId,
        personId,
        category: 'FEE',
        baseAmount: BigInt(100),
        discountAmount: BigInt(0),
        createdByUserId: userId,
      },
    });
    const due = await prisma.due.create({
      data: {
        tenantId,
        personId,
        chargeId: charge.id,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(100),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(100),
        status: DueStatus.PENDING,
      },
    });

    const paid = await payments.collectPayment(tenantId, userId, {
      dueId: due.id,
      amountMinor: '100',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });
    return paid.receipt!.receiptNumber;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantA = (await prisma.tenant.create({ data: { name: 'Srch Tenant A', category: 'School' } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: 'Srch Tenant B', category: 'School' } })).id;

    adminA = (await prisma.user.create({
      data: { tenantId: tenantA, email: 'admin.a@srch.test', passwordHash: 'h', fullName: 'Srch Admin A', role: UserRole.ROLE_ADMIN },
    })).id;
    adminB = (await prisma.user.create({
      data: { tenantId: tenantB, email: 'admin.b@srch.test', passwordHash: 'h', fullName: 'Srch Admin B', role: UserRole.ROLE_ADMIN },
    })).id;

    personA = (await prisma.person.create({
      data: {
        tenantId: tenantA,
        fullName:  'Ananya Sharma',
        primaryPhone: '9900001111',
        secondaryPhone: '9900002222',
        email: 'ananya.sharma@example.com',
        customData: { flatNumber: 'A-7' },
        advanceBalance: BigInt(0),
      },
    })).id;

    personB = (await prisma.person.create({
      data: {
        tenantId: tenantB,
        fullName: 'Bilal Rahman',
        primaryPhone: '9900003333',
        email: 'bilal.rahman@example.com',
        advanceBalance: BigInt(0),
      },
    })).id;

    // Extra tenant A people to prove multi-match behaviour.
    await prisma.person.create({
      data: { tenantId: tenantA, fullName: 'Ananya Verma', primaryPhone: '9900004444', advanceBalance: BigInt(0) },
    });

    // Services must exist before the fixture receipts are issued.
    search = new SearchService(prisma as any);
    payments = new PaymentsService(prisma as any);

    /*
     * Receipt numbers are unique per tenant, not globally, so two
     * tenants using the default prefix both start at REC-<year>-000001.
     * Give B a distinct prefix so the cross-tenant assertions below
     * test real isolation rather than a coincidental string match.
     */
    await new OrganizationsService(prisma as any).updateReceiptConfig(tenantB, {
      receiptPrefix: 'BORG',
    });

    receiptNumberA = await issueReceipt(tenantA, adminA, personA);
    receiptNumberB = await issueReceipt(tenantB, adminB, personB);
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
    }
    await prisma.due.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const t of [tenantA, tenantB]) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. finds a person by full name', async () => {
    const res = await search.search(tenantA, { q: 'Ananya Sharma' } as SearchQueryDto);

    expect(res.people).toHaveLength(1);
    expect(res.people[0].id).toBe(personA);
  });

  it('2. finds people by partial name (multiple matches)', async () => {
    const res = await search.search(tenantA, { q: 'Ananya' } as SearchQueryDto);

    expect(res.people).toHaveLength(2);
    expect(res.people.every((p) => p.fullName.includes('Ananya'))).toBe(true);
  });

  it('3. is case-insensitive on name', async () => {
    // 'AnAnYa' is a real substring of 'Ananya' but differs in case, so this
    // exercises case-insensitivity rather than an accidental non-match.
    const res = await search.search(tenantA, { q: 'AnAnYa' } as SearchQueryDto);
    expect(res.people).toHaveLength(2);
  });

  it('4. finds a person by primary phone', async () => {
    const res = await search.search(tenantA, { q: '9900001111' } as SearchQueryDto);
    expect(res.people).toHaveLength(1);
    expect(res.people[0].id).toBe(personA);
  });

  it('5. finds a person by partial phone digits', async () => {
    const res = await search.search(tenantA, { q: '0001111' } as SearchQueryDto);
    expect(res.people.map((p) => p.id)).toContain(personA);
  });

  it('6. finds a person by secondary phone', async () => {
    const res = await search.search(tenantA, { q: '9900002222' } as SearchQueryDto);
    expect(res.people.map((p) => p.id)).toEqual([personA]);
  });

  it('7. finds a person by email, including a partial email', async () => {
    const full = await search.search(tenantA, { q: 'ananya.sharma@example.com' } as SearchQueryDto);
    expect(full.people.map((p) => p.id)).toEqual([personA]);

    const partial = await search.search(tenantA, { q: 'sharma@' } as SearchQueryDto);
    expect(partial.people.map((p) => p.id)).toEqual([personA]);
  });

  it('8. finds a receipt by its number', async () => {
    const res = await search.search(tenantA, { q: receiptNumberA } as SearchQueryDto);

    expect(res.receipts).toHaveLength(1);
    expect(res.receipts[0].receiptNumber).toBe(receiptNumberA);
    expect(res.people).toHaveLength(0);
  });

  it('9. finds a receipt by a partial number', async () => {
    const prefix = receiptNumberA.slice(0, receiptNumberA.length - 4);
    const res = await search.search(tenantA, { q: prefix } as SearchQueryDto);
    expect(res.receipts.map((r) => r.receiptNumber)).toContain(receiptNumberA);
  });

  it('10. returns contact details and custom fields (BR-02)', async () => {
    const res = await search.search(tenantA, { q: 'Ananya Sharma' } as SearchQueryDto);
    const p = res.people[0];

    expect(p.primaryPhone).toBe('9900001111');
    expect(p.secondaryPhone).toBe('9900002222');
    expect(p.email).toBe('ananya.sharma@example.com');
    expect(p.customData).toEqual({ flatNumber: 'A-7' });
  });

  it('11. does not expose internal person fields', async () => {
    const res = await search.search(tenantA, { q: 'Ananya Sharma' } as SearchQueryDto);
    const p = res.people[0] as Record<string, unknown>;

    expect(p.tenantId).toBeUndefined();
    expect(p.advanceBalance).toBeUndefined();
  });

  it('12. tenant isolation: A never sees tenant B records', async () => {
    const byName = await search.search(tenantA, { q: 'Bilal' } as SearchQueryDto);
    expect(byName.people).toEqual([]);

    const byPhone = await search.search(tenantA, { q: '9900003333' } as SearchQueryDto);
    expect(byPhone.people).toEqual([]);

    const byEmail = await search.search(tenantA, { q: 'bilal.rahman' } as SearchQueryDto);
    expect(byEmail.people).toEqual([]);

    const byReceipt = await search.search(tenantA, { q: receiptNumberB } as SearchQueryDto);
    expect(byReceipt.receipts).toEqual([]);
  });

  it('13. tenant B sees only its own records', async () => {
    const res = await search.search(tenantB, { q: 'Bilal' } as SearchQueryDto);
    expect(res.people.map((p) => p.id)).toEqual([personB]);

    const rec = await search.search(tenantB, { q: receiptNumberB } as SearchQueryDto);
    expect(rec.receipts).toHaveLength(1);

    const other = await search.search(tenantB, { q: 'Ananya' } as SearchQueryDto);
    expect(other.people).toEqual([]);
  });

  it('14. an unrelated query returns nothing', async () => {
    const res = await search.search(tenantA, { q: 'zzzz-no-such-record' } as SearchQueryDto);

    expect(res.people).toEqual([]);
    expect(res.receipts).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('15. a blank query resolves to an empty result, not a scan', async () => {
    for (const q of ['', '   ', '\t']) {
      const res = await search.search(tenantA, { q } as SearchQueryDto);
      expect(res.people).toEqual([]);
      expect(res.receipts).toEqual([]);
      expect(res.total).toBe(0);
    }
  });

  it('16. missing q is rejected by DTO validation', () => {
    const missing = plainToInstance(SearchQueryDto, {});
    expect(validateSync(missing).length).toBeGreaterThan(0);

    const empty = plainToInstance(SearchQueryDto, { q: '' });
    expect(validateSync(empty).length).toBeGreaterThan(0);

    const tooLong = plainToInstance(SearchQueryDto, { q: 'x'.repeat(256) });
    expect(validateSync(tooLong).length).toBeGreaterThan(0);

    const badLimit = plainToInstance(SearchQueryDto, { q: 'ok', limit: 999 });
    expect(validateSync(badLimit).length).toBeGreaterThan(0);

    const good = plainToInstance(SearchQueryDto, { q: 'Ananya' });
    expect(validateSync(good)).toHaveLength(0);
  });

  it('17. limit bounds the result set', async () => {
    const res = await search.search(tenantA, { q: 'Ananya', limit: 1 } as SearchQueryDto);
    expect(res.people).toHaveLength(1);
    expect(res.limit).toBe(1);
  });

  it('18. a client tenantId cannot override the JWT tenant', async () => {
    const captured: string[] = [];
    const stub = {
      search: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new SearchController(stub);
    await controller.search(userFor(tenantA, UserRole.ROLE_ADMIN), {
      q: 'Bilal',
      tenantId: tenantB,
    } as any);

    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);

    const dto = plainToInstance(SearchQueryDto, { q: 'x', tenantId: tenantB });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
      .toBeGreaterThan(0);
  });

  it('19. unauthenticated search is rejected', () => {
    const guard = new JwtAuthGuard({ verify: () => ({}) } as any, new Reflector());
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => SearchController.prototype.search,
      getClass: () => SearchController,
    } as any;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('20. all three roles may search (people:view and receipts:view are ALLOW)', () => {
    // No role narrowing is applied, so the guard must not be present.
    expect(Reflect.getMetadata('roles', SearchController)).toBeUndefined();

    const guards = Reflect.getMetadata('__guards__', SearchController);
    expect(Array.isArray(guards)).toBe(true);
    expect(guards).toHaveLength(1);
  });
});
