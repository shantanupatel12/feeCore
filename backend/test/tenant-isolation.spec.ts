import 'reflect-metadata';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { PrismaClient, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { Public } from '../src/modules/auth/decorators/public.decorator.js';
import { Roles, ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import { DuesController } from '../src/modules/dues/dues.controller.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { PeopleService } from '../src/modules/people/people.service.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const jwtService = {
  verify: (token: string): JwtPayload => {
    if (token === 'good-token') {
      return {
        sub: 'user-1',
        tenantId: TENANT_A,
        email: 'a@x.com',
        role: 'ROLE_ADMIN',
      };
    }
    if (token === 'tenantless-token') {
      // Token issued without tenant context.
      return {
        sub: 'user-2',
        email: 'b@x.com',
        role: 'ROLE_ADMIN',
      } as unknown as JwtPayload;
    }
    throw new Error('bad token');
  },
};

const reflector = new Reflector();

function makeContext(req: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function req(headers: Record<string, string>, extra: Record<string, any> = {}) {
  return {
    headers,
    params: {},
    query: {},
    body: {},
    ...extra,
  };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('Tenant isolation: authenticated tenant context is authoritative', () => {
  const guard = new JwtAuthGuard(jwtService as any, reflector);

  it('rejects a token that carries no tenant context (fail closed)', () => {
    const context = makeContext(req(bearer('tenantless-token')));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('still rejects an invalid token', () => {
    const context = makeContext(req(bearer('bad-token')));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a client-supplied tenantId from params, query or body', () => {
    for (const extra of [
      { params: { tenantId: TENANT_B } },
      { query: { tenantId: TENANT_B } },
      { body: { tenantId: TENANT_B } },
    ]) {
      const context = makeContext(req(bearer('good-token'), extra));

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('rejects a non-string tenantId (array / object query pollution)', () => {
    for (const extra of [
      { query: { tenantId: [TENANT_A, TENANT_B] } },
      { query: { tenantId: { tenantId: TENANT_A } } },
      { body: { tenantId: [TENANT_A] } },
    ]) {
      const context = makeContext(req(bearer('good-token'), extra));

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('rejects an empty-string tenantId rather than skipping the check', () => {
    const context = makeContext(req(bearer('good-token'), { query: { tenantId: '' } }));

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an explicitly supplied null tenantId', () => {
    const context = makeContext(req(bearer('good-token'), { body: { tenantId: null } }));

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('still allows an absent tenantId', () => {
    const request = req(bearer('good-token'));

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.user.tenantId).toBe(TENANT_A);
  });

  it('allows a matching tenantId and exposes the JWT tenant', () => {
    const request = req(bearer('good-token'), {
      params: { tenantId: TENANT_A },
    });

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.user.tenantId).toBe(TENANT_A);
  });

  it('leaves @Public() routes unguarded so auth flows still work', () => {
    class PublicController {
      @Public()
      login() {
        return null;
      }
    }

    const context = {
      switchToHttp: () => ({ getRequest: () => req({}) }),
      getHandler: () => PublicController.prototype.login,
      getClass: () => PublicController,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('Tenant isolation: guards are registered application-wide', () => {
  it('binds JwtAuthGuard and RolesGuard as global APP_GUARDs', () => {
    const guardTokens = Reflect.getMetadata('providers', AuthModule) ?? [];

    const globalGuards = (guardTokens as any[])
      .filter((p) => p && typeof p === 'object' && p.provide === APP_GUARD)
      .map((p) => p.useClass);

    expect(globalGuards).toContain(JwtAuthGuard);
    expect(globalGuards).toContain(RolesGuard);
  });
});

describe('Regression: RBAC role enforcement is preserved', () => {
  const rolesGuard = new RolesGuard(reflector);

  function roleContext(required: UserRole[] | undefined, user?: JwtPayload) {
    class TargetController {
      handler() {
        return null;
      }
    }

    if (required) {
      Roles(...required)(TargetController.prototype, 'handler', Object.getOwnPropertyDescriptor(TargetController.prototype, 'handler')!);
    }

    const request: Record<string, any> = { headers: {}, params: {}, query: {}, body: {} };
    if (user) request.user = user;

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => TargetController.prototype.handler,
      getClass: () => TargetController,
    } as unknown as ExecutionContext;
  }

  const admin = { sub: 'u1', tenantId: TENANT_A, email: 'a@x.com', role: UserRole.ROLE_ADMIN } as JwtPayload;
  const viewer = { sub: 'u2', tenantId: TENANT_A, email: 'v@x.com', role: UserRole.ROLE_VIEWER } as JwtPayload;

  it('allows a user holding a required role', () => {
    expect(
      rolesGuard.canActivate(roleContext([UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR], admin)),
    ).toBe(true);
  });

  it('denies a user lacking the required role', () => {
    expect(() =>
      rolesGuard.canActivate(roleContext([UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR], viewer)),
    ).toThrow(ForbiddenException);
  });

  it('permits routes that declare no role requirement', () => {
    expect(rolesGuard.canActivate(roleContext(undefined, viewer))).toBe(true);
  });

  it('denies an unauthenticated request on a role-protected route', () => {
    expect(() => rolesGuard.canActivate(roleContext([UserRole.ROLE_ADMIN], undefined)))
      .toThrow(ForbiddenException);
  });
});

describe('Tenant isolation: DuesController ignores client-supplied tenantId', () => {
  const captured: { tenantId: string | undefined }[] = [];

  const service = {
    findAll: (tenantId: string) => {
      captured.push({ tenantId });
      return [];
    },
    findOne: (tenantId: string) => {
      captured.push({ tenantId });
      return null;
    },
    generateDues: (tenantId: string) => {
      captured.push({ tenantId });
      return {};
    },
  };

  const controller = new DuesController(service as any);
  const user = { tenantId: TENANT_A } as JwtPayload;

  beforeEach(() => {
    captured.length = 0;
  });

  it('findAll scopes to the JWT tenant, not the URL tenant', async () => {
    await controller.findAll(user, {} as any);

    expect(captured[0].tenantId).toBe(TENANT_A);
    expect(captured[0].tenantId).not.toBe(TENANT_B);
  });

  it('findOne scopes to the JWT tenant', async () => {
    await controller.findOne(user, 'due-1');

    expect(captured[0].tenantId).toBe(TENANT_A);
  });

  it('generateDues scopes to the JWT tenant', async () => {
    await controller.generateDues(user, {} as any);

    expect(captured[0].tenantId).toBe(TENANT_A);
  });

  it('never passes an undefined tenant to the service (no unscoped query)', async () => {
    await controller.findAll(user, {} as any);
    await controller.findOne(user, 'due-1');
    await controller.generateDues(user, {} as any);

    for (const call of captured) {
      expect(call.tenantId).toBeDefined();
      expect(call.tenantId).not.toBe('');
    }
  });
});

describe('Tenant isolation: end-to-end service scoping against the database', () => {
  let prisma: PrismaClient;
  let duesService: DuesService;
  let peopleService: PeopleService;
  let customFieldsService: CustomFieldsService;

  let tenantAId: string;
  let tenantBId: string;
  let personAId: string;
  let dueAId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    duesService = new DuesService(prisma as any);
    customFieldsService = new CustomFieldsService(prisma as any);
    peopleService = new PeopleService(prisma as any, customFieldsService);

    const tenantA = await prisma.tenant.create({
      data: { name: 'Isolation Tenant A', category: 'School' },
    });
    tenantAId = tenantA.id;

    const tenantB = await prisma.tenant.create({
      data: { name: 'Isolation Tenant B', category: 'Gym' },
    });
    tenantBId = tenantB.id;

    const personA = await peopleService.create(tenantAId, {
      fullName: 'Tenant A Student',
      primaryPhone: '+919000000001',
    });
    personAId = personA.id;

    // A user must exist for both tenants so due generation can attribute a creator.
    await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'iso-admin@tenant-a.com',
        passwordHash: 'dummyhash',
        fullName: 'Isolation Admin',
        role: UserRole.ROLE_ADMIN,
      },
    });

    await prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: 'iso-admin@tenant-b.com',
        passwordHash: 'dummyhash',
        fullName: 'Isolation Admin B',
        role: UserRole.ROLE_ADMIN,
      },
    });

    const plan = await prisma.recurringPlan.create({
      data: {
        tenantId: tenantAId,
        personId: personAId,
        category: 'Tuition',
        baseAmount: BigInt(100000),
        frequency: 'MONTHLY',
        anchorDay: 1,
        startDate: new Date('2026-01-01'),
        nextExecutionDate: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });

    await duesService.generateDues(tenantAId, {
      recurringPlanId: plan.id,
      targetDate: '2026-01-01',
    });

    const dueA = await prisma.due.findFirst({ where: { tenantId: tenantAId } });
    dueAId = dueA!.id;
  });

  afterAll(async () => {
    if (tenantAId && tenantBId) {
      const ids = { in: [tenantAId, tenantBId] };
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: ids } });
      await prisma.due.deleteMany({ where: { tenantId: ids } });
      await prisma.charge.deleteMany({ where: { tenantId: ids } });
      await prisma.recurringPlan.deleteMany({ where: { tenantId: ids } });
      await prisma.person.deleteMany({ where: { tenantId: ids } });
      await prisma.user.deleteMany({ where: { tenantId: ids } });
      await prisma.tenant.deleteMany({ where: { id: ids } });
    }
    await prisma.$disconnect();
  });

  it('Positive: Tenant A reads and writes its own data', async () => {
    const listA = await duesService.findAll(tenantAId);
    expect(listA.total).toBeGreaterThan(0);

    const dueA = await duesService.findOne(tenantAId, dueAId);
    expect(dueA.id).toBe(dueAId);

    const personA = await peopleService.findOne(tenantAId, personAId);
    expect(personA.tenantId).toBe(tenantAId);

    const updated = await peopleService.update(tenantAId, personAId, { fullName: 'Tenant A Student Updated' });
    expect(updated.fullName).toBe('Tenant A Student Updated');
  });

  it('Negative (Read): Tenant A cannot read Tenant B data via dues listing', async () => {
    const listA = await duesService.findAll(tenantAId);
    const listB = await duesService.findAll(tenantBId);

    expect(listB.total).toBe(0);
    expect(listA.items.every((d) => d.tenantId === tenantAId)).toBe(true);
  });

  it('Negative (Read): Tenant A cannot fetch a Tenant A-owned record while scoped as Tenant B', async () => {
    await expect(duesService.findOne(tenantBId, dueAId)).rejects.toThrow(NotFoundException);
    await expect(peopleService.findOne(tenantBId, personAId)).rejects.toThrow(/not found/i);
  });

  it('Negative (Write): Tenant A cannot modify Tenant B data', async () => {
    const personB = await prisma.person.create({
      data: { tenantId: tenantBId, fullName: 'Tenant B Student', primaryPhone: '+919000000002' },
    });

    // Tenant B identity attempting to write Tenant A's person must not resolve.
    await expect(
      peopleService.update(tenantBId, personAId, { fullName: 'Hijacked' }),
    ).rejects.toThrow(/not found/i);

    const untouched = await prisma.person.findUnique({ where: { id: personAId } });
    expect(untouched!.fullName).toBe('Tenant A Student Updated');
    expect(untouched!.tenantId).toBe(tenantAId);

    // Creating a charge against another tenant's person is rejected.
    await expect(
      new ChargesService(prisma as any).createOneTimeCharge(tenantBId, 'any-user', {
        personId: personAId,
        category: 'Hijack',
        baseAmountMinor: '1000',
        dueDate: '2026-12-01',
      }),
    ).rejects.toThrow(/not found/i);

    await prisma.person.delete({ where: { id: personB.id } });
  });

  it('Negative (Write): due generation cannot be redirected into another tenant', async () => {
    const result = await duesService.generateDues(tenantBId, { targetDate: '2026-06-01' });

    expect(result.generatedCount).toBe(0);
    const leaked = await prisma.due.count({ where: { tenantId: tenantBId } });
    expect(leaked).toBe(0);
  });
});