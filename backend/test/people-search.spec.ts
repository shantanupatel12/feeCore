import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  UnauthorizedException,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, PersonStatus } from '@prisma/client';
import { PeopleService } from '../src/modules/people/people.service.js';
import { PeopleController } from '../src/modules/people/people.controller.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { QueryPeopleDto } from '../src/modules/people/dto/person.dto.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
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

/** The global pipe exactly as configured in src/main/main.ts. */
const globalPipe = () =>
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

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

/** Runs a query object through the global pipe exactly as Nest would. */
async function pipeQuery(raw: Record<string, unknown>): Promise<QueryPeopleDto> {
  return globalPipe().transform(raw, { type: 'query', metatype: QueryPeopleDto }) as Promise<QueryPeopleDto>;
}

describe('V1.29: FR-PER-02 People search via ?query= (BR-02)', () => {
  let prisma: PrismaClient;
  let people: PeopleService;
  let controller: PeopleController;
  let tenantIds: string[] = [];
  let phoneSeq = 0;

  const nextPhone = () => `+91555${String(phoneSeq++).padStart(5, '0')}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    controller = new PeopleController(people);

    const a = await prisma.tenant.create({
      data: { name: 'FR-PER-02 Tenant A', category: 'School' },
    });
    const b = await prisma.tenant.create({
      data: { name: 'FR-PER-02 Tenant B', category: 'Gym' },
    });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName: email, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@per2.test', 'ROLE_ADMIN')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@per2.test', 'ROLE_ADMIN')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@per2.test', 'ROLE_COLLECTOR')).id;
    ids.userV = (await mkUser(a.id, 'view.a@per2.test', 'ROLE_VIEWER')).id;

    // Tenant A fixtures. Deliberately distinct across every searched field.
    await people.create(a.id, {
      fullName: 'Priya Verma',
      primaryPhone: nextPhone(),
      email: 'priya@per2.test',
    });
    await people.create(a.id, {
      fullName: 'Priyanka Sharma',
      primaryPhone: nextPhone(),
      email: 'priyanka@per2.test',
    });
    await people.create(a.id, {
      fullName: 'Rahul Kumar',
      primaryPhone: '+91555000999',
      email: 'rahul@per2.test',
    });
    await people.create(a.id, {
      fullName: 'Deepa Nair',
      primaryPhone: nextPhone(),
      email: 'unique-email-marker@per2.test',
    });
    await people.create(a.id, {
      fullName: 'Inactive Person',
      primaryPhone: nextPhone(),
      email: 'inactive@per2.test',
    });

    // Tenant B holds the names Tenant A searches for, to prove isolation.
    await people.create(b.id, {
      fullName: 'Priya Verma Tenant B',
      primaryPhone: nextPhone(),
      email: 'b.priya@per2.test',
    });
  });

  /** Controller call with the same DTO pass-through the route performs. */
  async function callController(token: string, raw: Record<string, unknown>) {
    const dto = await pipeQuery(raw);
    return controller.findAll(jwtService.verify(token), dto);
  }

  afterAll(async () => {
    for (const t of tenantIds) {
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.due.deleteMany({ where: { tenantId: t } });
      await prisma.charge.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  describe('FUNCTIONAL - ?query= is the SRS parameter', () => {
    it('1. ?query= returns the matching person by name', async () => {
      const r = await callController('admin-a', { query: 'Priya Verma' });
      expect(r.total).toBe(1);
      expect(r.items[0].fullName).toBe('Priya Verma');
      expect(r.items[0].email).toBe('priya@per2.test');
    });

    it('2. ?query= excludes non-matching people', async () => {
      const r = await callController('admin-a', { query: 'Priya Verma' });
      const names = r.items.map((p) => p.fullName);
      expect(names).not.toContain('Priyanka Sharma');
      expect(names).not.toContain('Rahul Kumar');
      expect(names).not.toContain('Priya Verma Tenant B');

      // A term matching nothing yields an empty page, not everyone.
      const none = await callController('admin-a', { query: 'NoSuchPersonAnywhere' });
      expect(none.total).toBe(0);
      expect(none.items).toEqual([]);
    });

    it('2b. partial name search matches multiple people', async () => {
      const r = await callController('admin-a', { query: 'Priya' });
      const names = r.items.map((p) => p.fullName).sort();
      expect(names).toEqual(['Priya Verma', 'Priyanka Sharma']);
    });

    it('2c. ?query= searches phone and email as FR-PER-02 requires', async () => {
      const byPhone = await callController('admin-a', { query: '+91555000999' });
      expect(byPhone.total).toBe(1);
      expect(byPhone.items[0].fullName).toBe('Rahul Kumar');

      const byEmail = await callController('admin-a', { query: 'unique-email-marker' });
      expect(byEmail.total).toBe(1);
      expect(byEmail.items[0].fullName).toBe('Deepa Nair');
    });

    it('2d. ?query= matching is case-insensitive', async () => {
      const r = await callController('admin-a', { query: 'rAhUl' });
      expect(r.total).toBe(1);
      expect(r.items[0].fullName).toBe('Rahul Kumar');
    });

    it('3. empty / whitespace / absent query behaviour', async () => {
      const all = await callController('admin-a', {});
      expect(all.total).toBe(5);

      // An empty string is falsy in the service and lists everyone, matching
      // the pre-existing ?search= behaviour rather than matching nobody.
      expect((await callController('admin-a', { query: '' })).total).toBe(5);
      // Whitespace trims to empty and likewise lists everyone.
      expect((await callController('admin-a', { query: '   ' })).total).toBe(5);

      // Non-string values are rejected by the DTO.
      await expect(pipeQuery({ query: 123 })).rejects.toThrow();
      await expect(pipeQuery({ query: ['a'] })).rejects.toThrow();
    });

    it('4. pagination still works with ?query=', async () => {
      const p1 = await callController('admin-a', { query: 'Priya', page: 1, limit: 1 });
      expect(p1.page).toBe(1);
      expect(p1.limit).toBe(1);
      expect(p1.total).toBe(2);
      expect(p1.totalPages).toBe(2);
      expect(p1.items).toHaveLength(1);

      const p2 = await callController('admin-a', { query: 'Priya', page: 2, limit: 1 });
      expect(p2.items).toHaveLength(1);
      expect(p2.items[0].id).not.toBe(p1.items[0].id);

      // Paging is also honoured when unfiltered.
      const all1 = await callController('admin-a', { page: 1, limit: 2 });
      expect(all1.total).toBe(5);
      expect(all1.totalPages).toBe(3);
      expect(all1.items).toHaveLength(2);
    });

    it('5. the response envelope and shape are unchanged', async () => {
      const r = await callController('admin-a', { query: 'Priya Verma' });
      expect(Object.keys(r).sort()).toEqual(['items', 'limit', 'page', 'total', 'totalPages']);

      const item: any = r.items[0];
      for (const key of [
        'id', 'tenantId', 'fullName', 'primaryPhone', 'secondaryPhone', 'email',
        'address', 'status', 'customData', 'createdAt', 'updatedAt', 'advanceBalanceMinor',
      ]) {
        expect(item).toHaveProperty(key);
      }
      // BR-02: full contact details and custom fields are returned.
      expect(item.secondaryPhone).toBeNull();
      expect(item.customData).toEqual({});
      // BIGINT exposed as an exact minor-unit string.
      expect(item.advanceBalanceMinor).toBe('0');
      expect(typeof item.advanceBalanceMinor).toBe('string');
    });

    it('5b. the status filter still works alongside ?query=', async () => {
      const inactive = await prisma.person.findFirst({
        where: { tenantId: ids.tenantA, fullName: 'Inactive Person' },
      });
      await prisma.person.update({ where: { id: inactive!.id }, data: { status: PersonStatus.INACTIVE } });
      try {
        const r = await callController('admin-a', { query: 'Person', status: PersonStatus.INACTIVE });
        expect(r.total).toBe(1);
        expect(r.items[0].fullName).toBe('Inactive Person');
      } finally {
        await prisma.person.update({ where: { id: inactive!.id }, data: { status: PersonStatus.ACTIVE } });
      }
    });
  });

  describe('FUNCTIONAL - ?search= backward compatibility and precedence', () => {
    it('6. the existing ?search= alias still works', async () => {
      // This is pre-existing behaviour asserted by test/people.spec.ts:145.
      const r = await callController('admin-a', { search: 'Priya Verma' });
      expect(r.total).toBe(1);
      expect(r.items[0].fullName).toBe('Priya Verma');

      expect((await callController('admin-a', { search: 'Rahul' })).total).toBe(1);
      expect((await callController('admin-a', { search: 'Priya' })).total).toBe(2);
    });

    it('7. when both are supplied, ?query= wins and they are never combined', async () => {
      // `query` matches one person, `search` matches two. The result must be the
      // `query` result alone - not the union and not the intersection.
      const r = await callController('admin-a', { query: 'Rahul', search: 'Priya' });
      expect(r.total).toBe(1);
      expect(r.items[0].fullName).toBe('Rahul Kumar');

      // Reversed emphasis: `query` is authoritative regardless of ordering.
      const r2 = await callController('admin-a', { query: 'Priya Verma', search: 'Rahul' });
      expect(r2.total).toBe(1);
      expect(r2.items[0].fullName).toBe('Priya Verma');

      // A `search` that matches nothing cannot widen a `query` result.
      const r3 = await callController('admin-a', { query: 'Rahul', search: 'zzzz-nothing' });
      expect(r3.total).toBe(1);
      expect(r3.items[0].fullName).toBe('Rahul Kumar');

      // An empty `query` string still takes precedence over a real `search`,
      // because precedence is decided on presence, not on truthiness. This is
      // asserted explicitly so the documented rule is unambiguous.
      const r4 = await callController('admin-a', { query: '', search: 'Rahul' });
      expect(r4.total).toBe(5);
    });

    it('7b. precedence holds for non-matching terms too', async () => {
      const r = await callController('admin-a', { query: 'NoSuchName', search: 'Rahul' });
      expect(r.total).toBe(0);
    });
  });

  describe('FUNCTIONAL - unknown parameters', () => {
    it('8. an unknown query parameter is rejected by forbidNonWhitelisted', async () => {
      await expect(pipeQuery({ bogus: 'x' })).rejects.toThrow();
      await expect(pipeQuery({ query: 'a', bogus: 'x' })).rejects.toThrow();
      await expect(pipeQuery({ sortBy: 'name' })).rejects.toThrow();
    });

    it('8b. non-integer paging is now a 400 instead of a driver 500', async () => {
      await expect(pipeQuery({ page: 'abc' })).rejects.toThrow();
      await expect(pipeQuery({ limit: 'abc' })).rejects.toThrow();
      // Out-of-range values are still clamped by the service, as before.
      expect((await pipeQuery({ page: '0' })).page).toBe(0);
      expect((await pipeQuery({ limit: '5000' })).limit).toBe(5000);
      const clamped = await callController('admin-a', { limit: '5000' });
      expect(clamped.limit).toBe(100);
      const lowPage = await callController('admin-a', { page: '0' });
      expect(lowPage.page).toBe(1);
    });
  });

  describe('SECURITY', () => {
    it('9. unauthenticated requests are rejected with 401', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
    });

    it('10. an invalid token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer invalid-token' })),
      ).toThrow(UnauthorizedException);
    });

    it('11. an expired token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer expired' })),
      ).toThrow(UnauthorizedException);
    });

    it('12. a tenantless token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);
    });

    it('13. Tenant A cannot search Tenant B people', async () => {
      const aAll = await callController('admin-a', {});
      expect(aAll.items.every((p) => p.tenantId === ids.tenantA)).toBe(true);
      expect(aAll.total).toBe(5);

      const bAll = await callController('admin-b', {});
      expect(bAll.total).toBe(1);
      expect(bAll.items[0].fullName).toBe('Priya Verma Tenant B');

      // The name Tenant A searches for returns only Tenant A's person.
      const searchA = await callController('admin-a', { query: 'Priya Verma' });
      expect(searchA.total).toBe(1);
      expect(searchA.items[0].fullName).toBe('Priya Verma');
      expect(searchA.items[0].tenantId).toBe(ids.tenantA);

      // And the service layer agrees when called directly with a tenant id.
      expect((await people.findAll(ids.tenantA, { search: 'Priya Verma' })).total).toBe(1);
    });

    it('13b. every read role can search; roles are unchanged', async () => {
      // people:view is ALLOW for Admin, Collector and Viewer, and the route
      // declares no @Roles, so all three retain access.
      for (const token of ['admin-a', 'collector-a', 'viewer-a']) {
        const r = await callController(token, { query: 'Rahul' });
        expect(r.total).toBe(1);
        expect(r.items[0].fullName).toBe('Rahul Kumar');
      }
    });

    it('14. a tenantId query override is rejected', async () => {
      await expect(pipeQuery({ tenantId: ids.tenantB })).rejects.toThrow();
      await expect(pipeQuery({ tenantId: null })).rejects.toThrow();
      await expect(pipeQuery({ tenantId: [ids.tenantB] })).rejects.toThrow();
      await expect(pipeQuery({ tenantId: { id: ids.tenantB } })).rejects.toThrow();
      await expect(pipeQuery({ query: 'Rahul', tenantId: ids.tenantB })).rejects.toThrow();
    });

    it('15. a cross-tenant person cannot be discovered through search', async () => {
      // Tenant B's person has a name, phone and email that a Tenant A search
      // would otherwise match on.
      const bPerson = await prisma.person.findFirst({
        where: { tenantId: ids.tenantB },
      });
      const term = bPerson!.primaryPhone;

      const aByPhone = await callController('admin-a', { query: term });
      expect(aByPhone.total).toBe(0);

      const aByEmail = await callController('admin-a', { query: 'b.priya' });
      expect(aByEmail.total).toBe(0);

      const aByName = await callController('admin-a', { query: 'Priya Verma Tenant B' });
      expect(aByName.total).toBe(0);

      // Tenant B can still find its own person.
      const bByPhone = await callController('admin-b', { query: term });
      expect(bByPhone.total).toBe(1);
      expect(bByPhone.items[0].id).toBe(bPerson!.id);
    });

    it('15b. path/body tenant overrides cannot affect ownership', () => {
      for (const attempt of [
        makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
      ]) {
        expect(() => authGuard.canActivate(attempt)).toThrow();
      }
    });

    it('15c. the controller ignores any tenantId present in the query object', async () => {
      // Bypassing the pipe entirely (as a compromised in-process caller could)
      // still cannot widen the scope, because the controller passes only the
      // four known keys to the service.
      const r = await controller.findAll(jwtService.verify('admin-a'), {
        tenantId: ids.tenantB,
      } as any);
      expect(r.items.every((p) => p.tenantId === ids.tenantA)).toBe(true);
    });
  });

  describe('DATA SAFETY', () => {
    it('16. GET /people causes no database mutation', async () => {
      const snapshot = async () => ({
        persons: await prisma.person.findMany({
          where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' },
        }),
        dues: await prisma.due.count({ where: { tenantId: { in: tenantIds } } }),
        payments: await prisma.payment.count({ where: { tenantId: { in: tenantIds } } }),
        receipts: await prisma.receipt.count({ where: { tenantId: { in: tenantIds } } }),
        allocations: await prisma.paymentAllocation.count({ where: { tenantId: { in: tenantIds } } }),
        logs: await prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } }),
      });

      const before = await snapshot();
      await callController('admin-a', { query: 'Priya' });
      await callController('admin-a', { query: 'Rahul', page: 1, limit: 5 });
      await callController('admin-a', { search: 'Deepa' });
      await callController('admin-b', {});
      await callController('viewer-a', { query: 'Person' });
      const after = await snapshot();

      expect(after).toEqual(before);
    });

    it('16b. the existing ?search= service contract still holds', async () => {
      // The behaviour test/people.spec.ts:145 depends on.
      const r = await people.findAll(ids.tenantA, { search: 'Priya Verma' });
      expect(r.total).toBe(1);
      expect(r.items[0].fullName).toBe('Priya Verma');
    });
  });
});