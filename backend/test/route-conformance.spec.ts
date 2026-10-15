import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum.js';
import { PrismaClient } from '@prisma/client';
import { PeopleService } from '../src/modules/people/people.service.js';
import { PeopleController } from '../src/modules/people/people.controller.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { DuesController } from '../src/modules/dues/dues.controller.js';
import { GenerateDuesDto } from '../src/modules/dues/dto/due.dto.js';
import { RefundsService } from '../src/modules/refunds/refunds.service.js';
import { RefundsController } from '../src/modules/refunds/refunds.controller.js';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller.js';
import { ReportsService } from '../src/modules/reports/services/reports.service.js';
import { ReportsController } from '../src/modules/reports/controllers/reports.controller.js';
import { RouteAliasesController } from '../src/modules/route-aliases/route-aliases.controller.js';
import {
  QueryPeopleDto,
  resolvePeopleSearchTerm,
} from '../src/modules/people/dto/person.dto.js';
import { DashboardQueryDto } from '../src/modules/dashboard/dto/dashboard-query.dto.js';
import {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../src/modules/reports/validators/reports-query.dto.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

/**
 * V1.30 route conformance (FR-PER-02, FR-REC-02, FR-REF-01, FR-DSH-01,
 * FR-REP-01, FR-REP-02).
 *
 * Route paths are verified from Nest's own `@Controller`/`@Get`/`@Post`
 * metadata, so a path can never be asserted by restating it: renaming a route
 * in source immediately breaks these assertions.
 *
 * Behaviour is verified by driving the real controller handlers with the real
 * services against a real database, comparing each alias against the
 * pre-existing `tenants/:tenantId/...` route, and running every alias through
 * the real `JwtAuthGuard`, `RolesGuard` and the global `ValidationPipe`.
 *
 * Handlers are invoked directly rather than over HTTP on purpose. Nest's DI
 * container needs the `design:paramtypes` metadata that only tsc emits
 * (`nest build`); vitest transforms with esbuild, which drops it, so
 * `Test.createTestingModule` cannot resolve any constructor parameter. Direct
 * instantiation is also what every other spec in this suite does. The
 * production bootstrap path itself is covered by `npm run build`, which does
 * compile the same metadata.
 */
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
      // Same behaviour as jsonwebtoken on a malformed/expired token.
      throw new Error('invalid or expired token');
    }
    return found;
  },
};

const reflector = new Reflector();
const authGuard = new JwtAuthGuard(jwtService as any, reflector as any);
const rolesGuard = new RolesGuard(reflector as any);

/** The global pipe exactly as configured in src/main/main.ts. */
const globalPipe = () =>
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/**
 * Builds an ExecutionContext whose handler/class are the *real* controller
 * prototypes, so `RolesGuard` and `JwtAuthGuard` read the real `@Roles` and
 * `@Public` metadata rather than a stub.
 */
function makeContext(
  handlerOwner: object,
  handlerName: string,
  req: { headers: Record<string, any>; params?: Record<string, any>; query?: Record<string, any>; body?: any },
): ExecutionContext {
  const request: Record<string, any> = { headers: req.headers };
  if (req.params) request.params = req.params;
  if (req.query) request.query = req.query;
  if (req.body !== undefined) request.body = req.body;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (handlerOwner as any).prototype[handlerName],
    getClass: () => handlerOwner,
  } as unknown as ExecutionContext;
}

async function pipeQuery<T>(raw: Record<string, unknown>, metatype: any): Promise<T> {
  return globalPipe().transform(raw, { type: 'query', metatype }) as Promise<T>;
}

/** Runs both global guards, exactly as Nest does for a protected route. */
function authorize(
  handlerOwner: object,
  handlerName: string,
  token: string | null,
  extra?: { params?: Record<string, any>; query?: Record<string, any>; body?: any },
): void {
  const headers: Record<string, any> = token ? { authorization: `Bearer ${token}` } : {};
  const ctx = makeContext(handlerOwner, handlerName, {
    headers,
    params: extra?.params,
    query: extra?.query,
    body: extra?.body,
  });
  authGuard.canActivate(ctx);
  rolesGuard.canActivate(ctx);
}

describe('V1.30: SRS route conformance', () => {
  let prisma: PrismaClient;
  let people: PeopleService;
  let duesService: DuesService;
  let refunds: RefundsService;
  let dashboard: DashboardService;
  let reports: ReportsService;
  let aliases: RouteAliasesController;
  let peopleController: PeopleController;
  let dashboardController: DashboardController;
  let reportsController: ReportsController;
  let refundsController: RefundsController;
  let duesController: DuesController;
  let tenantIds: string[] = [];
  let allocationA: string;
  let allocationB: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const payload = (token: string): JwtPayload => jwtService.verify(token);

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    const charges = new ChargesService(prisma as any);
    const payments = new PaymentsService(prisma as any);
    duesService = new DuesService(prisma as any);
    refunds = new RefundsService(prisma as any, duesService);
    dashboard = new DashboardService(prisma as any);
    reports = new ReportsService(prisma as any);

    aliases = new RouteAliasesController(people, duesService, refunds, dashboard, reports);
    peopleController = new PeopleController(people);
    dashboardController = new DashboardController(dashboard);
    reportsController = new ReportsController(reports);
    refundsController = new RefundsController(refunds);
    duesController = new DuesController(duesService);

    const a = await prisma.tenant.create({
      data: { name: 'FR-Route Tenant A', category: 'School', timezone: 'Asia/Kolkata' },
    });
    const b = await prisma.tenant.create({
      data: { name: 'FR-Route Tenant B', category: 'Gym', timezone: 'Asia/Kolkata' },
    });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName: email, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@route.test', 'ROLE_ADMIN')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@route.test', 'ROLE_ADMIN')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@route.test', 'ROLE_COLLECTOR')).id;
    ids.userV = (await mkUser(a.id, 'view.a@route.test', 'ROLE_VIEWER')).id;

    await people.create(a.id, { fullName: 'Route Person Alpha', primaryPhone: '+917770000001', email: 'alpha@route.test' });
    const personA = (
      await people.create(a.id, { fullName: 'Route Person Beta', primaryPhone: '+917770000002' })
    ).id;
    await people.create(a.id, { fullName: 'Route Person Gamma', primaryPhone: '+917770000003' });
    const personB = (
      await people.create(b.id, { fullName: 'Route Person Alpha', primaryPhone: '+917770000099' })
    ).id;

    const chargeA = await charges.createOneTimeCharge(a.id, ids.userA, {
      personId: personA, category: 'Tuition', baseAmountMinor: '800000', dueDate: '2026-05-10',
    });
    const payA = await payments.collectPayment(a.id, ids.userA, {
      dueId: chargeA.due.id, amountMinor: '600000', paymentMode: 'CASH' as any,
      idempotencyKey: 'route-a-1', referenceNumber: 'CASH/A/1',
    });
    allocationA = payA.allocation.id;

    const chargeB = await charges.createOneTimeCharge(b.id, ids.userB, {
      personId: personB, category: 'Gym Fee', baseAmountMinor: '450000', dueDate: '2026-05-11',
    });
    const payB = await payments.collectPayment(b.id, ids.userB, {
      dueId: chargeB.due.id, amountMinor: '450000', paymentMode: 'UPI' as any,
      idempotencyKey: 'route-b-1',
    });
    allocationB = payB.allocation.id;
  }, 120000);

  afterAll(async () => {
    for (const t of tenantIds) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.due.deleteMany({ where: { tenantId: t } });
      await prisma.recurringPlan.deleteMany({ where: { tenantId: t } });
      await prisma.charge.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
    }
    await prisma.$disconnect();
  }, 120000);

  describe('route registration — read from Nest decorator metadata', () => {
    /** `prefix + path` and HTTP verb, exactly as Nest resolves them. */
    const route = (owner: any, handler: string) => {
      const proto = owner.prototype;
      const prefix = Reflect.getMetadata(PATH_METADATA, owner) ?? '';
      const path = Reflect.getMetadata(PATH_METADATA, proto[handler]) ?? '';
      const method = Reflect.getMetadata(METHOD_METADATA, proto[handler]);
      const verb = Object.keys(RequestMethod).find(
        (k) => (RequestMethod as any)[k] === method,
      );
      const join = `${prefix}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
      return { path: join.startsWith('/') ? join : `/${join}`, verb };
    };

    it('1. all six SRS-documented paths are registered', () => {
      expect(route(RouteAliasesController, 'searchPeople')).toEqual({
        path: '/people',
        verb: 'GET',
      });
      expect(route(RouteAliasesController, 'generateDues')).toEqual({
        path: '/jobs/generate-dues',
        verb: 'POST',
      });
      expect(route(RouteAliasesController, 'refundAllocation')).toEqual({
        path: '/refunds/due-allocation',
        verb: 'POST',
      });
      expect(route(RouteAliasesController, 'dashboardMetrics')).toEqual({
        path: '/dashboard/metrics',
        verb: 'GET',
      });
      expect(route(RouteAliasesController, 'collectionReport')).toEqual({
        path: '/reports/collections',
        verb: 'GET',
      });
      expect(route(RouteAliasesController, 'duesReport')).toEqual({
        path: '/reports/dues',
        verb: 'GET',
      });
    });

    it('2. every pre-existing tenants/:tenantId route is still registered', () => {
      expect(route(PeopleController, 'findAll')).toEqual({
        path: '/tenants/:tenantId/people',
        verb: 'GET',
      });
      expect(route(DuesController, 'generateDues')).toEqual({
        path: '/tenants/:tenantId/dues/generate',
        verb: 'POST',
      });
      expect(route(RefundsController, 'refundAllocation')).toEqual({
        path: '/tenants/:tenantId/refunds/allocations',
        verb: 'POST',
      });
      expect(route(DashboardController, 'getMetrics')).toEqual({
        path: '/tenants/:tenantId/dashboard/metrics',
        verb: 'GET',
      });
      expect(route(ReportsController, 'collectionReport')).toEqual({
        path: '/tenants/:tenantId/reports/collections',
        verb: 'GET',
      });
      expect(route(ReportsController, 'duesReport')).toEqual({
        path: '/tenants/:tenantId/reports/dues',
        verb: 'GET',
      });
    });

    it('3. the alias controller adds only those six paths', () => {
      const handlers = Object.getOwnPropertyNames(RouteAliasesController.prototype).filter(
        (n) => n !== 'constructor' && typeof (RouteAliasesController.prototype as any)[n] === 'function',
      );
      expect(handlers.sort()).toEqual([
        'collectionReport',
        'dashboardMetrics',
        'duesReport',
        'generateDues',
        'refundAllocation',
        'searchPeople',
      ]);
    });

    it('4. role restrictions on each alias match the protected original exactly', () => {
      const rolesOf = (owner: any, handler: string) =>
        Reflect.getMetadata(ROLES_KEY, owner.prototype[handler]);

      // generate-dues: Admin + Collector, on both paths.
      expect(rolesOf(RouteAliasesController, 'generateDues')).toEqual(
        rolesOf(DuesController, 'generateDues'),
      );
      expect(rolesOf(RouteAliasesController, 'generateDues')).toEqual([
        'ROLE_ADMIN',
        'ROLE_COLLECTOR',
      ]);

      // due-allocation: Admin only, on both paths.
      expect(rolesOf(RouteAliasesController, 'refundAllocation')).toEqual(
        rolesOf(RefundsController, 'refundAllocation'),
      );
      expect(rolesOf(RouteAliasesController, 'refundAllocation')).toEqual(['ROLE_ADMIN']);

      // Read routes are ALLOW for every role, so neither side narrows.
      for (const [owner, handler] of [
        [RouteAliasesController, 'searchPeople'],
        [RouteAliasesController, 'dashboardMetrics'],
        [RouteAliasesController, 'collectionReport'],
        [RouteAliasesController, 'duesReport'],
      ] as const) {
        expect(rolesOf(owner, handler)).toBeUndefined();
      }
      for (const [owner, handler] of [
        [PeopleController, 'findAll'],
        [DashboardController, 'getMetrics'],
        [ReportsController, 'collectionReport'],
        [ReportsController, 'duesReport'],
      ] as const) {
        expect(rolesOf(owner, handler)).toBeUndefined();
      }
    });
  });

  describe('security — every alias', () => {
    const aliasesUnderTest: Array<[any, string]> = [
      [RouteAliasesController, 'searchPeople'],
      [RouteAliasesController, 'dashboardMetrics'],
      [RouteAliasesController, 'collectionReport'],
      [RouteAliasesController, 'duesReport'],
      [RouteAliasesController, 'generateDues'],
      [RouteAliasesController, 'refundAllocation'],
    ];

    it('5. unauthenticated requests are rejected with 401', () => {
      for (const [owner, handler] of aliasesUnderTest) {
        expect(() => authorize(owner, handler, null)).toThrow(UnauthorizedException);
      }
    });

    it('6. an invalid or expired JWT is rejected with 401', () => {
      for (const token of ['garbage', 'expired-token-value']) {
        for (const [owner, handler] of aliasesUnderTest) {
          expect(() => authorize(owner, handler, token)).toThrow(UnauthorizedException);
        }
      }
    });

    it('7. a tenantless JWT is rejected with 401', () => {
      for (const [owner, handler] of aliasesUnderTest) {
        expect(() => authorize(owner, handler, 'tenantless')).toThrow(UnauthorizedException);
      }
    });

    it('8. no alias carries @Public', () => {
      const PUBLIC = 'isPublic';
      for (const [owner, handler] of aliasesUnderTest) {
        expect(Reflect.getMetadata(PUBLIC, (owner as any).prototype[handler])).toBeUndefined();
      }
    });

    it('9. RBAC denies the roles the originals deny', () => {
      // generate-dues: Viewer denied, Collector allowed.
      expect(() => authorize(RouteAliasesController, 'generateDues', 'viewer-a')).toThrow(
        ForbiddenException,
      );
      expect(() => authorize(DuesController, 'generateDues', 'viewer-a')).toThrow(
        ForbiddenException,
      );
      authorize(RouteAliasesController, 'generateDues', 'collector-a');
      authorize(DuesController, 'generateDues', 'collector-a');

      // due-allocation: Admin only, so Collector and Viewer are both denied.
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => authorize(RouteAliasesController, 'refundAllocation', token)).toThrow(
          ForbiddenException,
        );
        expect(() => authorize(RefundsController, 'refundAllocation', token)).toThrow(
          ForbiddenException,
        );
      }
      authorize(RouteAliasesController, 'refundAllocation', 'admin-a');
      authorize(RefundsController, 'refundAllocation', 'admin-a');
    });

    it('10. tenantId cannot be overridden through query, body or path', () => {
      for (const token of ['collector-a', 'viewer-a', 'admin-a']) {
        for (const value of [ids.tenantB, '', 'null', '[]', `["${ids.tenantB}"]`, '{"id":"x"}']) {
          expect(
            () =>
              authorize(RouteAliasesController, 'searchPeople', token, {
                query: { query: 'Route', tenantId: value },
              }),
            `${token}/${value}`,
          ).toThrow(ForbiddenException);
        }
        expect(() =>
          authorize(RouteAliasesController, 'generateDues', token, { body: { tenantId: ids.tenantB } }),
        ).toThrow(ForbiddenException);
        expect(() =>
          authorize(RouteAliasesController, 'refundAllocation', token, {
            body: { tenantId: ids.tenantB },
          }),
        ).toThrow(ForbiddenException);
        // A matching tenantId is accepted, so the guard is a check and not a
        // blanket refusal of the key.
        authorize(RouteAliasesController, 'searchPeople', token, {
          query: { query: 'Route', tenantId: ids.tenantA },
        });
      }
    });

    it('11. a tenantId key is rejected by the global pipe as well', async () => {
      await expect(
        pipeQuery({ query: 'Route', tenantId: ids.tenantB }, QueryPeopleDto),
      ).rejects.toThrow();
      await expect(pipeQuery({ tenantId: ids.tenantB }, DashboardQueryDto)).rejects.toThrow();
      await expect(
        pipeQuery({ tenantId: ids.tenantB }, CollectionReportQueryDto),
      ).rejects.toThrow();
      await expect(pipeQuery({ tenantId: ids.tenantB }, DuesReportQueryDto)).rejects.toThrow();
      // Unknown keys are refused on the original routes too.
      await expect(pipeQuery({ bogus: '1' }, QueryPeopleDto)).rejects.toThrow();
    });
  });

  describe('tenant isolation', () => {
    const callSearch = async (user: JwtPayload, dto: QueryPeopleDto) =>
      aliases.searchPeople(user, dto);

    it('12. an alias never returns another tenant data', async () => {
      const a = await callSearch(payload('admin-a'), {} as QueryPeopleDto);
      expect(a.total).toBe(3);
      expect(a.items.every((p: any) => p.tenantId === ids.tenantA)).toBe(true);

      const b = await callSearch(payload('admin-b'), {} as QueryPeopleDto);
      expect(b.total).toBe(1);
      expect(b.items[0].tenantId).toBe(ids.tenantB);
      expect(b.items[0].fullName).toBe('Route Person Alpha');
    });

    it('13. dashboard metrics differ per tenant', async () => {
      const a = await aliases.dashboardMetrics(payload('admin-a'), {} as any);
      const b = await aliases.dashboardMetrics(payload('admin-b'), {} as any);
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('14. collection reports are tenant-scoped', async () => {
      const a = await aliases.collectionReport(payload('admin-a'), {} as any);
      const b = await aliases.collectionReport(payload('admin-b'), {} as any);
      expect(a.totals.grossCollectedMinor).toBe('600000');
      expect(b.totals.grossCollectedMinor).toBe('450000');
      expect(b.items.every((i: any) => i.personPrimaryPhone === '+917770000099')).toBe(true);
    });

    it('15. dues reports are tenant-scoped', async () => {
      const userA = payload('admin-a');
      const userB = payload('admin-b');
      const a = await aliases.duesReport(userA, {} as any);
      const b = await aliases.duesReport(userB, {} as any);

      // Person ids are the only per-row tenant evidence the report exposes,
      // so cross-check them against the owning tenant directly.
      const owns = async (personId: string) =>
        (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).tenantId;

      // Tenant B's only due is fully settled, so it reports nothing while
      // Tenant A still has an open balance — the two never overlap.
      expect(a.items.length).toBeGreaterThan(0);
      for (const item of a.items) {
        expect(await owns(item.personId)).toBe(ids.tenantA);
      }
      expect(b.items).toHaveLength(0);
      expect(a.totals.totalOutstandingMinor).toBe('200000');
      expect(b.totals.totalOutstandingMinor).toBe('0');
      expect(b.totals.openDueCount).toBe(0);
    });
  });

  describe('equivalence with the existing routes', () => {
    it('16. GET /people alias equals the existing route', async () => {
      const dto = await pipeQuery<QueryPeopleDto>({ query: 'Route' }, QueryPeopleDto);
      const alias = await aliases.searchPeople(payload('admin-a'), dto);
      const existing = await peopleController.findAll(payload('admin-a'), dto);
      expect(alias).toEqual(existing);
    });

    it('17. FR-PER-02 search behaviour', async () => {
      const q = async (raw: Record<string, unknown>) =>
        aliases.searchPeople(
          payload('admin-a'),
          await pipeQuery<QueryPeopleDto>(raw, QueryPeopleDto),
        );

      expect((await q({ query: 'Route' })).total).toBe(3);
      expect((await q({ query: 'Beta' })).items[0].fullName).toBe('Route Person Beta');
      expect((await q({ query: '+917770000003' })).items[0].fullName).toBe('Route Person Gamma');
      expect((await q({ query: 'alpha@route.test' })).total).toBe(1);
      expect((await q({ query: 'NoSuchPerson' })).items).toEqual([]);

      const paged = await q({ query: 'Route', page: 2, limit: 2 });
      expect(paged.page).toBe(2);
      expect(paged.limit).toBe(2);
      expect(paged.total).toBe(3);
      expect(paged.totalPages).toBe(2);
      expect(paged.items).toHaveLength(1);

      // Backward-compatible ?search= alias, and ?query= wins over it.
      expect((await q({ search: 'Beta' })).total).toBe(1);
      expect((await q({ query: 'Beta', search: 'Route' })).items[0].fullName).toBe(
        'Route Person Beta',
      );
      expect(resolvePeopleSearchTerm({ query: 'a', search: 'b' } as any)).toBe('a');
    });

    it('18. dashboard and report aliases equal the existing routes', async () => {
      // `aliases.dashboardMetrics` is a one-line delegation, so alias and
      // original produce byte-identical payloads for the same tenant date.
      const user = payload('admin-a');
      const cases: Array<[string, Record<string, unknown>, any, any, any]> = [
        ['dashboard/metrics {}', {}, DashboardQueryDto, (t: string, q: any) => dashboard.getMetrics(t, q), (u: any, q: any) => aliases.dashboardMetrics(u, q)],
        ['reports/collections {}', {}, CollectionReportQueryDto, (t: string, q: any) => reports.collectionReport(t, q), (u: any, q: any) => aliases.collectionReport(u, q)],
        ['reports/dues {}', {}, DuesReportQueryDto, (t: string, q: any) => reports.duesReport(t, q), (u: any, q: any) => aliases.duesReport(u, q)],
        ['dashboard/metrics asOf', { asOf: '2026-05-20' }, DashboardQueryDto, (t: string, q: any) => dashboard.getMetrics(t, q), (u: any, q: any) => aliases.dashboardMetrics(u, q)],
        ['reports/collections range', { from: '2026-01-01', to: '2026-12-31' }, CollectionReportQueryDto, (t: string, q: any) => reports.collectionReport(t, q), (u: any, q: any) => aliases.collectionReport(u, q)],
        ['reports/dues OVERDUE', { status: 'OVERDUE' }, DuesReportQueryDto, (t: string, q: any) => reports.duesReport(t, q), (u: any, q: any) => aliases.duesReport(u, q)],
      ];
      for (const [label, raw, meta, svcFn, aliasFn] of cases) {
        const dto = await pipeQuery<any>(raw, meta);
        const resAlias = await aliasFn(user, dto);
        const resSvc = await svcFn(user.tenantId, dto);
        if (label.startsWith('dashboard/metrics') && !raw.asOf) {
          expect({ ...resAlias, asOf: undefined, currentPeriod: { ...resAlias.currentPeriod, to: undefined } }).toEqual(
            { ...resSvc, asOf: undefined, currentPeriod: { ...resSvc.currentPeriod, to: undefined } },
          );
        } else {
          expect(resAlias, label).toEqual(resSvc);
        }
      }

      // The pre-existing controller handlers, called the same way the alias
      // calls its service, must agree too.
      const dashDto = await pipeQuery<DashboardQueryDto>({ asOf: '2026-10-01' }, DashboardQueryDto);
      expect(await aliases.dashboardMetrics(user, dashDto)).toEqual(
        await dashboardController.getMetrics(user, dashDto),
      );
      const colDto = await pipeQuery<CollectionReportQueryDto>(
        {},
        CollectionReportQueryDto,
      );
      expect(await aliases.collectionReport(user, colDto)).toEqual(
        await reportsController.collectionReport(user, colDto),
      );
      const dueDto = await pipeQuery<DuesReportQueryDto>({}, DuesReportQueryDto);
      expect(await aliases.duesReport(user, dueDto)).toEqual(
        await reportsController.duesReport(user, dueDto),
      );
    });

    it('19. report filters are honoured identically on the alias', async () => {
      const byMode = await aliases.collectionReport(
        payload('admin-a'),
        await pipeQuery<CollectionReportQueryDto>(
          { paymentMode: 'CASH' },
          CollectionReportQueryDto,
        ),
      );
      expect(byMode.items).toHaveLength(1);
      expect(byMode.items[0].paymentMode).toBe('CASH');

      const noMatch = await aliases.collectionReport(
        payload('admin-a'),
        await pipeQuery<CollectionReportQueryDto>(
          { paymentMode: 'CHEQUE' },
          CollectionReportQueryDto,
        ),
      );
      expect(noMatch.items).toHaveLength(0);

      // Invalid enum and malformed dates are refused on both routes.
      await expect(
        pipeQuery<CollectionReportQueryDto>({ paymentMode: 'NOPE' }, CollectionReportQueryDto),
      ).rejects.toThrow();
      await expect(
        pipeQuery<CollectionReportQueryDto>({ from: 'not-a-date' }, CollectionReportQueryDto),
      ).rejects.toThrow();
      await expect(
        pipeQuery<DuesReportQueryDto>({ status: 'NOPE' }, DuesReportQueryDto),
      ).rejects.toThrow();
      await expect(
        pipeQuery<DashboardQueryDto>({ asOf: 'not-a-date' }, DashboardQueryDto),
      ).rejects.toThrow();
    });

    it('20. generate-dues alias is idempotent and creates no duplicates', async () => {
      /*
       * A recurring plan whose execution window is already closed, so the
       * alias is exercised on a plan that could create money if the guard
       * were missing, while the loop itself generates nothing.
       */
      const person = await prisma.person.create({
        data: {
          tenantId: ids.tenantA,
          fullName: 'Route Recurring Person',
          primaryPhone: '+917770000010',
        },
      });
      const plan = await prisma.recurringPlan.create({
        data: {
          tenantId: ids.tenantA,
          personId: person.id,
          category: 'Monthly Tuition',
          baseAmount: BigInt(50000),
          frequency: 'MONTHLY' as any,
          nextExecutionDate: new Date('2020-01-01'),
          startDate: new Date('2020-01-01'),
          endDate: new Date('2019-12-31'),
          status: 'ACTIVE' as any,
        },
      });

      const before = await prisma.due.count({ where: { tenantId: ids.tenantA } });

      // Empty body first: the documented no-argument form.
      const emptyDto = await pipeQuery<GenerateDuesDto>({}, GenerateDuesDto);
      const noArgs = await aliases.generateDues(payload('admin-a'), emptyDto);
      expect(noArgs.generatedCount).toBe(0);

      // Repeating the identical request must not create a second Due.
      for (const targetDate of ['2020-02-01', '2020-02-01', '2020-03-01']) {
        const dto = await pipeQuery<GenerateDuesDto>({ targetDate }, GenerateDuesDto);
        const res = await aliases.generateDues(payload('admin-a'), dto);
        expect(res.generatedCount).toBe(0);
        // Same result through the pre-existing route.
        const viaOriginal = await duesController.generateDues(payload('admin-a'), dto);
        expect(viaOriginal.generatedCount).toBe(0);
      }

      expect(await prisma.due.count({ where: { tenantId: ids.tenantA } })).toBe(before);

      await prisma.recurringPlan.deleteMany({ where: { tenantId: ids.tenantA } });
      await prisma.person.deleteMany({ where: { id: person.id } });
    }, 60000);
  });

  describe('financial safety', () => {
    it('21. read-only aliases cause zero writes', async () => {
      const snapshot = async () => ({
        dues: await prisma.due.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
        payments: await prisma.payment.count({ where: { tenantId: { in: tenantIds } } }),
        allocations: await prisma.paymentAllocation.findMany({
          where: { tenantId: { in: tenantIds } }, orderBy: { id: 'asc' },
        }),
        refunds: await prisma.refund.count({ where: { tenantId: { in: tenantIds } } }),
        receipts: await prisma.receipt.count({ where: { tenantId: { in: tenantIds } } }),
        logs: await prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } }),
      });

      const before = await snapshot();
      const empty = async <T>(meta: any) => pipeQuery<T>({}, meta);
      for (let i = 0; i < 3; i++) {
        for (const token of ['admin-a', 'admin-b']) {
          const user = payload(token);
          await aliases.searchPeople(user, await empty(QueryPeopleDto));
          await aliases.dashboardMetrics(user, await empty(DashboardQueryDto));
          await aliases.collectionReport(user, await empty(CollectionReportQueryDto));
          await aliases.duesReport(user, await empty(DuesReportQueryDto));
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it('22. refund allocation alias behaves identically to the original', async () => {
      const dto = {
        paymentAllocationId: allocationA,
        refundAmountMinor: '1000',
        refundMode: 'CASH' as const,
        refundReason: 'alias path',
      };
      const user = payload('admin-a');

      const alias = await aliases.refundAllocation(user, dto);
      expect(alias.refund.refundAmountMinor).toBe('1000');
      expect(alias.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(alias.allocation.refundedAmountMinor).toBe('1000');
      // Balance restoration is money math and must be exact.
      expect(alias.due.balanceRemainingMinor).toBe('201000');

      const stored = await prisma.refund.findUniqueOrThrow({
        where: { id: alias.refund.id },
        include: { paymentAllocation: true },
      });
      expect(stored.refundAmount).toBe(BigInt(1000));
      expect(stored.refundReason).toBe('alias path');
      expect(stored.refundMode).toBe('CASH');
      expect(stored.tenantId).toBe(ids.tenantA);
      // The tenant comes from the JWT, never from the body.
      expect(stored.processedByUserId).toBe(ids.userA);
      expect(stored.paymentAllocation?.refundedAmount).toBe(BigInt(1000));

      // One immutable ledger entry per refund.
      const logs = await prisma.financialTransactionLog.findMany({
        where: { tenantId: ids.tenantA, referenceEntityId: alias.refund.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].eventType).toBe('DUE_ALLOCATION_REFUND');
      expect(logs[0].amount).toBe(BigInt(1000));
      expect(logs[0].balanceSnapshot).toBe(BigInt(201000));

      // The pre-existing controller route runs the identical service call and
      // accumulates onto the same refundable ceiling.
      const viaController = await refundsController.refundAllocation(user, {
        ...dto,
        refundAmountMinor: '500',
        refundReason: 'original path',
      });
      expect(viaController.refund.refundAmountMinor).toBe('500');
      expect(viaController.allocation.refundedAmountMinor).toBe('1500');
      expect(viaController.due.balanceRemainingMinor).toBe('201500');

      const stillRefundable =
        allocationA && (await prisma.paymentAllocation.findUniqueOrThrow({ where: { id: allocationA } }));
      // 600000 paid - 1500 refunded is the remaining ceiling.
      expect(stillRefundable.totalAllocated - stillRefundable.refundedAmount).toBe(BigInt(598500));
    });

    it('23. refund rejections are identical and atomic on the alias', async () => {
      const base = {
        paymentAllocationId: allocationA,
        refundAmountMinor: '1',
        refundMode: 'CASH' as const,
        refundReason: 'ceiling check',
      };
      const user = payload('admin-a');
      const beforeRefunds = await prisma.refund.count({ where: { tenantId: ids.tenantA } });
      const beforeLogs = await prisma.financialTransactionLog.count({
        where: { tenantId: ids.tenantA },
      });
      const beforeAllocation = await prisma.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationA },
      });
      const beforeDue = await prisma.due.findUniqueOrThrow({ where: { id: beforeAllocation.dueId } });

      // Malformed, zero, negative and over-the-ceiling amounts are all refused.
      for (const bad of ['0', '-5', 'abc', '', '1.5', '99999999999']) {
        await expect(
          aliases.refundAllocation(user, { ...base, refundAmountMinor: bad }),
          bad,
        ).rejects.toThrow();
        // Identical outcome through the original route.
        await expect(
          refundsController.refundAllocation(user, { ...base, refundAmountMinor: bad }),
          bad,
        ).rejects.toThrow();
      }

      // A rejected refund leaves no Refund, no ledger entry, no allocation
      // movement and no Due movement behind.
      expect(await prisma.refund.count({ where: { tenantId: ids.tenantA } })).toBe(beforeRefunds);
      expect(
        await prisma.financialTransactionLog.count({ where: { tenantId: ids.tenantA } }),
      ).toBe(beforeLogs);
      const afterAllocation = await prisma.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationA },
      });
      expect(afterAllocation.refundedAmount).toBe(beforeAllocation.refundedAmount);
      const afterDue = await prisma.due.findUniqueOrThrow({
        where: { id: beforeAllocation.dueId },
      });
      expect(afterDue.balanceRemaining).toBe(beforeDue.balanceRemaining);
      expect(afterDue.status).toBe(beforeDue.status);
    });

    it('24. a cross-tenant allocation cannot be refunded through the alias', async () => {
      const user = payload('admin-a');
      const beforeB = await prisma.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationB },
      });
      const dueB = await prisma.due.findUniqueOrThrow({ where: { id: beforeB.dueId } });
      const beforeBRefunds = await prisma.refund.count({ where: { tenantId: ids.tenantB } });

      await expect(
        aliases.refundAllocation(user, {
          paymentAllocationId: allocationB,
          refundAmountMinor: '1000',
          refundMode: 'CASH',
          refundReason: 'cross tenant attempt',
        }),
      ).rejects.toThrow();

      // Nothing was written in either tenant.
      expect(
        await prisma.refund.count({
          where: { tenantId: ids.tenantA, refundReason: 'cross tenant attempt' },
        }),
      ).toBe(0);
      expect(await prisma.refund.count({ where: { tenantId: ids.tenantB } })).toBe(
        beforeBRefunds,
      );
      const afterB = await prisma.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationB },
      });
      expect(afterB.refundedAmount).toBe(BigInt(0));
      const afterDueB = await prisma.due.findUniqueOrThrow({ where: { id: dueB.id } });
      expect(afterDueB.balanceRemaining).toBe(dueB.balanceRemaining);
      expect(afterDueB.status).toBe(dueB.status);
    });
  });
});
