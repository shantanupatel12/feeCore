import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  UnprocessableEntityException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import {
  PrismaClient,
  PersonStatus,
  RecurringPlanStatus,
  RecurringFrequency,
  PaymentMode,
} from '@prisma/client';
import { PeopleService } from '../src/modules/people/people.service.js';
import { PeopleController } from '../src/modules/people/people.controller.js';
import { UpdatePersonDto } from '../src/modules/people/dto/person.dto.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { RecurringPlansService } from '../src/modules/charges/recurring-plans.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
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

function rolesContext(token: string, handler: keyof PeopleController) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => PeopleController.prototype[handler],
    getClass: () => PeopleController,
  } as unknown as ExecutionContext;
}

describe('V1.22: FR-PER-03 person soft deactivation (BR-REC-004, Edge Case 11)', () => {
  let prisma: PrismaClient;
  let people: PeopleService;
  let controller: PeopleController;
  let charges: ChargesService;
  let plans: RecurringPlansService;
  let payments: PaymentsService;
  let dues: DuesService;
  let tenantIds: string[] = [];
  let phoneSeq = 0;

  const nextPhone = () => `+9199500${String(phoneSeq++).padStart(5, '0')}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    controller = new PeopleController(people);
    charges = new ChargesService(prisma as any);
    plans = new RecurringPlansService(prisma as any);
    dues = new DuesService(prisma as any);
    payments = new PaymentsService(prisma as any);

    const a = await prisma.tenant.create({ data: { name: 'FR-PER-03 Tenant A', category: 'School' } });
    const b = await prisma.tenant.create({ data: { name: 'FR-PER-03 Tenant B', category: 'Gym' } });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any, fullName: string) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@per.test', 'ROLE_ADMIN', 'Admin A')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@per.test', 'ROLE_ADMIN', 'Admin B')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@per.test', 'ROLE_COLLECTOR', 'Collector A')).id;
    ids.userV = (await mkUser(a.id, 'view.a@per.test', 'ROLE_VIEWER', 'Viewer A')).id;
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.receiptSequence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.recurringPlan.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customFieldDefinition.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  });

  async function makePerson(opts: { tenantId?: string; name?: string } = {}) {
    return prisma.person.create({
      data: {
        tenantId: opts.tenantId ?? ids.tenantA,
        fullName: opts.name ?? 'Deactivation Subject',
        primaryPhone: nextPhone(),
      },
    });
  }

  describe('deactivation behaviour', () => {
    let personId: string;

    beforeEach(async () => {
      const p = await makePerson({ name: 'Subject' });
      personId = p.id;
    });

    it('1. an authorized admin deactivates their own tenant person', async () => {
      const res = await people.deactivate(ids.tenantA, personId);
      expect(res.id).toBe(personId);
      expect(res.status).toBe(PersonStatus.INACTIVE);
      // Response keeps the repository's BigInt-as-string convention.
      expect(res.advanceBalanceMinor).toBe('0');
    });

    it('2. the person row still exists after deactivation (no hard delete)', async () => {
      await people.deactivate(ids.tenantA, personId);
      const row = await prisma.person.findUnique({ where: { id: personId } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe(PersonStatus.INACTIVE);
      expect(row!.tenantId).toBe(ids.tenantA);
    });

    it('3. the state is persisted on the existing `status` field', async () => {
      const before = await prisma.person.findUnique({ where: { id: personId } });
      expect(before!.status).toBe(PersonStatus.ACTIVE);

      await people.deactivate(ids.tenantA, personId);

      const after = await prisma.person.findUnique({ where: { id: personId } });
      expect(after!.status).toBe(PersonStatus.INACTIVE);
      // updatedAt moved; nothing else about the row changed.
      expect(after!.fullName).toBe(before!.fullName);
      expect(after!.primaryPhone).toBe(before!.primaryPhone);
      expect(after!.createdAt).toEqual(before!.createdAt);
    });

    it('4. repeated deactivation is idempotent, not an error', async () => {
      const first = await people.deactivate(ids.tenantA, personId);
      const second = await people.deactivate(ids.tenantA, personId);
      const third = await people.deactivate(ids.tenantA, personId);

      expect(second.status).toBe(PersonStatus.INACTIVE);
      expect(third.status).toBe(PersonStatus.INACTIVE);
      expect(second.id).toBe(first.id);
      expect((await prisma.person.findUnique({ where: { id: personId } }))!.status).toBe(
        PersonStatus.INACTIVE,
      );
    });

    it('5. cross-tenant person is reported as not found', async () => {
      await expect(people.deactivate(ids.tenantB, personId)).rejects.toThrow(NotFoundException);
      // Still active in its real tenant.
      expect((await prisma.person.findUnique({ where: { id: personId } }))!.status).toBe(
        PersonStatus.ACTIVE,
      );
    });

    it('6. deactivating an unknown id is not found', async () => {
      await expect(
        people.deactivate(ids.tenantA, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('7. the controller derives the tenant only from the JWT', async () => {
      const res = await controller.deactivate(jwtService.verify('admin-a'), personId);
      expect(res.status).toBe(PersonStatus.INACTIVE);

      await expect(
        controller.deactivate(jwtService.verify('admin-b'), personId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('financial and historical preservation', () => {
    it('8. deactivation preserves dues, payments, allocations, ledger and advance balance', async () => {
      const person = await makePerson({ name: 'Financial Subject' });

      const created = await charges.createOneTimeCharge(ids.tenantA, ids.userA, {
        personId: person.id,
        category: 'Tuition',
        baseAmountMinor: '100000',
        dueDate: '2026-03-10',
      });

      const paid = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: created.due.id,
        amountMinor: '40000',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: `per-key-${Date.now()}-a`,
      });

      await prisma.person.update({
        where: { id: person.id },
        data: { advanceBalance: BigInt(2500) },
      });

      const before = {
        due: await prisma.due.findUnique({ where: { id: created.due.id } }),
        charge: await prisma.charge.findUnique({ where: { id: created.charge.id } }),
        payment: await prisma.payment.findUnique({ where: { id: paid.payment.id } }),
        alloc: await prisma.paymentAllocation.findUnique({ where: { id: paid.allocation!.id } }),
        logs: await prisma.financialTransactionLog.count({ where: { tenantId: ids.tenantA } }),
        person: await prisma.person.findUnique({ where: { id: person.id } }),
      };

      await people.deactivate(ids.tenantA, person.id);

      const after = {
        due: await prisma.due.findUnique({ where: { id: created.due.id } }),
        charge: await prisma.charge.findUnique({ where: { id: created.charge.id } }),
        payment: await prisma.payment.findUnique({ where: { id: paid.payment.id } }),
        alloc: await prisma.paymentAllocation.findUnique({ where: { id: paid.allocation!.id } }),
        logs: await prisma.financialTransactionLog.count({ where: { tenantId: ids.tenantA } }),
        person: await prisma.person.findUnique({ where: { id: person.id } }),
      };

      // No financial record was touched or rewritten.
      expect(after.due!.netAmount).toBe(before.due!.netAmount);
      expect(after.due!.balanceRemaining).toBe(before.due!.balanceRemaining);
      expect(after.due!.lateFeeAmount).toBe(before.due!.lateFeeAmount);
      expect(after.due!.status).toBe(before.due!.status);
      expect(after.charge!.baseAmount).toBe(before.charge!.baseAmount);
      expect(after.charge!.discountAmount).toBe(before.charge!.discountAmount);
      expect(after.payment!.totalAmount).toBe(before.payment!.totalAmount);
      expect(after.payment!.status).toBe(before.payment!.status);
      expect(after.alloc!.allocatedPrincipal).toBe(before.alloc!.allocatedPrincipal);
      expect(after.alloc!.totalAllocated).toBe(before.alloc!.totalAllocated);
      expect(after.logs).toBe(before.logs);
      // Advance balance untouched, ownership untouched, only status changed.
      expect(after.person!.advanceBalance).toBe(BigInt(2500));
      expect(after.person!.tenantId).toBe(ids.tenantA);
      expect(after.person!.status).toBe(PersonStatus.INACTIVE);
    });

    it('9. customData is preserved untouched', async () => {
      const customFields = new CustomFieldsService(prisma as any);
      await customFields.create(ids.tenantA, {
        fieldKey: 'flat_number',
        fieldLabel: 'Flat Number',
        dataType: 'TEXT' as any,
      });

      const person = await people.create(ids.tenantA, {
        fullName: 'Custom Data Subject',
        primaryPhone: nextPhone(),
        customData: { flat_number: 'C-7' },
      });

      await people.deactivate(ids.tenantA, person.id);

      const after = await prisma.person.findUnique({ where: { id: person.id } });
      expect(after!.customData).toEqual({ flat_number: 'C-7' });
      expect(after!.status).toBe(PersonStatus.INACTIVE);
    });

    it('10. a deactivated person remains readable in list, detail and search results', async () => {
      const person = await makePerson({ name: 'Still Findable' });
      await people.deactivate(ids.tenantA, person.id);

      const detail = await people.findOne(ids.tenantA, person.id);
      expect(detail.id).toBe(person.id);
      expect(detail.status).toBe(PersonStatus.INACTIVE);

      // Unfiltered listing still includes them: history stays queryable.
      const all = await people.findAll(ids.tenantA);
      expect(all.items.some((p: any) => p.id === person.id)).toBe(true);

      // The existing status filter can narrow to active people.
      const activeOnly = await people.findAll(ids.tenantA, { status: 'ACTIVE' });
      expect(activeOnly.items.some((p: any) => p.id === person.id)).toBe(false);

      const inactiveOnly = await people.findAll(ids.tenantA, { status: 'INACTIVE' });
      expect(inactiveOnly.items.some((p: any) => p.id === person.id)).toBe(true);
    });

    it('11. active person behaviour is unchanged', async () => {
      const person = await makePerson({ name: 'Still Active' });
      const res = await people.findOne(ids.tenantA, person.id);
      expect(res.status).toBe(PersonStatus.ACTIVE);
      expect(res.advanceBalanceMinor).toBe('0');
    });
  });

  describe('documented downstream effects', () => {
    it('12. BR-REC-004: active recurring plans are suspended to PAUSED', async () => {
      const person = await makePerson({ name: 'Plan Holder' });
      const active = await plans.create(ids.tenantA, {
        personId: person.id,
        category: 'Hostel',
        baseAmountMinor: '300000',
        frequency: RecurringFrequency.MONTHLY,
        anchorDay: 5,
        startDate: '2026-01-05',
      });
      const paused = await plans.create(ids.tenantA, {
        personId: person.id,
        category: 'Already Paused',
        baseAmountMinor: '200000',
        frequency: RecurringFrequency.MONTHLY,
        anchorDay: 6,
        startDate: '2026-01-06',
      });
      await prisma.recurringPlan.update({
        where: { id: paused.id },
        data: { status: RecurringPlanStatus.PAUSED },
      });

      await people.deactivate(ids.tenantA, person.id);

      const nowActive = await prisma.recurringPlan.findUnique({ where: { id: active.id } });
      const nowPaused = await prisma.recurringPlan.findUnique({ where: { id: paused.id } });
      expect(nowActive!.status).toBe(RecurringPlanStatus.PAUSED);
      // Already-paused plans are untouched.
      expect(nowPaused!.status).toBe(RecurringPlanStatus.PAUSED);
    });

    it('13. Edge Case 11: new charges on a deactivated person are blocked with 422', async () => {
      const person = await makePerson({ name: 'Blocked From Charging' });
      await people.deactivate(ids.tenantA, person.id);

      await expect(
        charges.createOneTimeCharge(ids.tenantA, ids.userA, {
          personId: person.id,
          category: 'Tuition',
          baseAmountMinor: '50000',
          dueDate: '2026-03-10',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      await expect(
        charges.createOneTimeCharge(ids.tenantA, ids.userA, {
          personId: person.id,
          category: 'Tuition',
          baseAmountMinor: '50000',
          dueDate: '2026-03-10',
        }),
      ).rejects.toThrow('Cannot create charges for an inactive person');

      // No charge or due was created by the blocked attempts.
      expect(await prisma.charge.count({ where: { personId: person.id } })).toBe(0);
    });

    it('14. Edge Case 11: pre-existing dues stay collectable after deactivation', async () => {
      const person = await makePerson({ name: 'Still Collectible' });
      const created = await charges.createOneTimeCharge(ids.tenantA, ids.userA, {
        personId: person.id,
        category: 'Tuition',
        baseAmountMinor: '100000',
        dueDate: '2026-03-10',
      });

      await people.deactivate(ids.tenantA, person.id);

      const res = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: created.due.id,
        amountMinor: '100000',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: `per-key-${Date.now()}-b`,
      });

      expect(res.due.balanceRemainingMinor).toBe('0');
      expect(res.due.status).toBe('PAID');
    });

    it('15. BR-REC-004: due generation excludes the deactivated person', async () => {
      const person = await makePerson({ name: 'No More Cycles' });
      const plan = await plans.create(ids.tenantA, {
        personId: person.id,
        category: 'Hostel',
        baseAmountMinor: '300000',
        frequency: RecurringFrequency.MONTHLY,
        anchorDay: 15,
        startDate: '2026-01-15',
      });

      await people.deactivate(ids.tenantA, person.id);

      const gen = await dues.generateDues(ids.tenantA, {
        recurringPlanId: plan.id,
        targetDate: '2026-03-31',
      });

      expect(gen.generatedCount).toBe(0);
      expect(await prisma.due.count({ where: { personId: person.id } })).toBe(0);
    });
  });

  describe('security', () => {
    it('16. unauthenticated requests are rejected', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer expired' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('17. a tenantless JWT is rejected', () => {
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('18. Collector and Viewer are denied (people:deactivate)', () => {
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => rolesGuard.canActivate(rolesContext(token, 'deactivate'))).toThrow(
          ForbiddenException,
        );
      }
    });

    it('19. Admin is allowed', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'deactivate'))).toBe(true);
    });

    it('20. a client-supplied tenantId override is rejected', () => {
      const person = makePerson();
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }, { tenantId: ids.tenantB }),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB })),
      ).toThrow(ForbiddenException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null })),
      ).toThrow(ForbiddenException);
    });

    it('21. deactivation cannot be smuggled through a second tenant via the id', async () => {
      const person = await makePerson({ name: 'Foreign Target' });
      // Tenant B admin acting on a Tenant A person.
      await expect(people.deactivate(ids.tenantB, person.id)).rejects.toThrow(NotFoundException);
      expect((await prisma.person.findUnique({ where: { id: person.id } }))!.status).toBe(
        PersonStatus.ACTIVE,
      );
    });
  });
  describe('V1.23: generic PUT cannot change status', () => {
    it('A. a status property is rejected by the whitelist pipe, not silently ignored', async () => {
      const person = await makePerson({ name: 'Whitelist Subject' });

      /*
       * Reproduces the exact global pipe from src/main/main.ts. With
       * `status` removed from UpdatePersonDto, forbidNonWhitelisted makes
       * the request a 400 instead of a silent no-op.
       */
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      const metadata = { type: 'body', metatype: UpdatePersonDto };

      await expect(
        pipe.transform({ secondaryPhone: '+91111', status: 'INACTIVE' }, metadata),
      ).rejects.toThrow();

      // Without status the same payload validates cleanly.
      await expect(
        pipe.transform({ secondaryPhone: '+91111' }, metadata),
      ).resolves.toBeInstanceOf(UpdatePersonDto);

      // And the service ignores an extra key even if one is forced past the pipe.
      const forced = await people.update(ids.tenantA, person.id, {
        secondaryPhone: '+91111',
        status: PersonStatus.INACTIVE,
      } as any);
      expect(forced.status).toBe(PersonStatus.ACTIVE);
    });

    it('B. a normal PUT still updates every legitimate field', async () => {
      const person = await makePerson({ name: 'Full Update Subject' });

      const updated = await people.update(ids.tenantA, person.id, {
        fullName: 'Renamed Person',
        primaryPhone: nextPhone(),
        secondaryPhone: '+919900000001',
        email: 'renamed@per.test',
        address: '42 Update Lane',
      });

      expect(updated.fullName).toBe('Renamed Person');
      expect(updated.secondaryPhone).toBe('+919900000001');
      expect(updated.email).toBe('renamed@per.test');
      expect(updated.address).toBe('42 Update Lane');
    });

    it('C. an ACTIVE person stays ACTIVE after a normal PUT', async () => {
      const person = await makePerson({ name: 'Active Subject' });
      const updated = await people.update(ids.tenantA, person.id, { fullName: 'Active Renamed' });
      expect(updated.status).toBe(PersonStatus.ACTIVE);
      expect((await prisma.person.findUnique({ where: { id: person.id } }))!.status).toBe(
        PersonStatus.ACTIVE,
      );
    });

    it('D. an INACTIVE person stays INACTIVE after a normal PUT', async () => {
      const person = await makePerson({ name: 'Inactive Subject' });
      await people.deactivate(ids.tenantA, person.id);

      // Attempting to flip it back through the generic update must not work.
      const forced = await people.update(ids.tenantA, person.id, {
        fullName: 'Inactive Renamed',
        status: PersonStatus.ACTIVE,
      } as any);

      expect(forced.status).toBe(PersonStatus.INACTIVE);
      expect((await prisma.person.findUnique({ where: { id: person.id } }))!.status).toBe(
        PersonStatus.INACTIVE,
      );
    });

    it('E. the dedicated deactivate route still works for ADMIN', async () => {
      const person = await makePerson({ name: 'Admin Path' });
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'deactivate'))).toBe(true);

      const res = await controller.deactivate(jwtService.verify('admin-a'), person.id);
      expect(res.status).toBe(PersonStatus.INACTIVE);
    });

    it('F/G. Collector and Viewer are still denied the dedicated route', () => {
      expect(() => rolesGuard.canActivate(rolesContext('collector-a', 'deactivate'))).toThrow(
        ForbiddenException,
      );
      expect(() => rolesGuard.canActivate(rolesContext('viewer-a', 'deactivate'))).toThrow(
        ForbiddenException,
      );
    });

    it('H/I. unauthenticated and tenantless tokens are rejected', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer expired' }))).toThrow(
        UnauthorizedException,
      );
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);
    });

    it('J. a cross-tenant person is still not found', async () => {
      const person = await makePerson({ name: 'Cross Tenant Path' });
      await expect(people.deactivate(ids.tenantB, person.id)).rejects.toThrow(NotFoundException);
      expect((await prisma.person.findUnique({ where: { id: person.id } }))!.status).toBe(
        PersonStatus.ACTIVE,
      );
    });

    it('K. a client tenantId override is still rejected', () => {
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
    });

    it('L. repeated deactivate remains idempotent', async () => {
      const person = await makePerson({ name: 'Idempotent Path' });
      await people.deactivate(ids.tenantA, person.id);
      const second = await people.deactivate(ids.tenantA, person.id);
      const third = await people.deactivate(ids.tenantA, person.id);
      expect(second.status).toBe(PersonStatus.INACTIVE);
      expect(third.status).toBe(PersonStatus.INACTIVE);
    });

    it('M. V1.22 protections still hold after the change', async () => {
      const customFields = new CustomFieldsService(prisma as any);
      const person = await people.create(ids.tenantA, {
        fullName: 'Protected Subject',
        primaryPhone: nextPhone(),
        customData: { flat_number: 'Z-1' },
      });

      const created = await charges.createOneTimeCharge(ids.tenantA, ids.userA, {
        personId: person.id,
        category: 'Tuition',
        baseAmountMinor: '60000',
        dueDate: '2026-03-10',
      });

      const beforeDue = await prisma.due.findUnique({ where: { id: created.due.id } });
      const beforeLogs = await prisma.financialTransactionLog.count({
        where: { tenantId: ids.tenantA, personId: person.id },
      });

      await people.deactivate(ids.tenantA, person.id);

      // History intact, customData intact, charges still blocked, dues still collectable.
      const after = await prisma.person.findUnique({ where: { id: person.id } });
      expect(after!.customData).toEqual({ flat_number: 'Z-1' });
      const afterDue = await prisma.due.findUnique({ where: { id: created.due.id } });
      expect(afterDue!.balanceRemaining).toBe(beforeDue!.balanceRemaining);
      expect(
        await prisma.financialTransactionLog.count({
          where: { tenantId: ids.tenantA, personId: person.id },
        }),
      ).toBe(beforeLogs);

      await expect(
        charges.createOneTimeCharge(ids.tenantA, ids.userA, {
          personId: person.id,
          category: 'Tuition',
          baseAmountMinor: '1000',
          dueDate: '2026-03-10',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      const paid = await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: created.due.id,
        amountMinor: '60000',
        paymentMode: PaymentMode.CASH,
        idempotencyKey: `per-key-${Date.now()}-v123`,
      });
      expect(paid.due.balanceRemainingMinor).toBe('0');
      expect(customFields).toBeDefined();
    });
  });
});
