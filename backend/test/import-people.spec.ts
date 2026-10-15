import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  UnauthorizedException,
  ForbiddenException,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, CustomFieldDataType } from '@prisma/client';
import { ImportsService } from '../src/modules/imports/imports.service.js';
import { ImportsController } from '../src/modules/imports/imports.controller.js';
import { ImportPeopleCsvDto } from '../src/modules/imports/dto/import-people-csv.dto.js';
import { PeopleService } from '../src/modules/people/people.service.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
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

function rolesContext(token: string, handler: keyof ImportsController) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => ImportsController.prototype[handler],
    getClass: () => ImportsController,
  } as unknown as ExecutionContext;
}

describe('V1.24: FR-IMP-01 bulk People CSV import (BR-02)', () => {
  let prisma: PrismaClient;
  let imports: ImportsService;
  let controller: ImportsController;
  let people: PeopleService;
  let charges: ChargesService;
  let payments: PaymentsService;
  let customFields: CustomFieldsService;
  let tenantIds: string[] = [];
  let phoneSeq = 0;

  const nextPhone = () => `+9199700${String(phoneSeq++).padStart(5, '0')}`;

  const csv = (...lines: string[]) => lines.join('\n');

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    imports = new ImportsService(prisma as any, people, customFields);
    controller = new ImportsController(imports);
    charges = new ChargesService(prisma as any);
    payments = new PaymentsService(prisma as any);

    const a = await prisma.tenant.create({ data: { name: 'FR-IMP-01 Tenant A', category: 'School' } });
    const b = await prisma.tenant.create({ data: { name: 'FR-IMP-01 Tenant B', category: 'Gym' } });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any, fullName: string) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@imp.test', 'ROLE_ADMIN', 'Admin A')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@imp.test', 'ROLE_ADMIN', 'Admin B')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@imp.test', 'ROLE_COLLECTOR', 'Collector A')).id;
    ids.userV = (await mkUser(a.id, 'view.a@imp.test', 'ROLE_VIEWER', 'Viewer A')).id;

    // Tenant A defines two custom fields; Tenant B defines only one.
    await customFields.create(a.id, {
      fieldKey: 'flat_number',
      fieldLabel: 'Flat Number',
      dataType: CustomFieldDataType.TEXT,
    });
    await customFields.create(a.id, {
      fieldKey: 'membership_type',
      fieldLabel: 'Membership Type',
      dataType: CustomFieldDataType.SELECT,
      options: ['GOLD', 'SILVER'],
    });
    await customFields.create(b.id, {
      fieldKey: 'room_number',
      fieldLabel: 'Room Number',
      dataType: CustomFieldDataType.TEXT,
    });
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.receiptSequence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.recurringPlan.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.importJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customFieldDefinition.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  });

  /** Clears imported people so each case starts from a known state. */
  async function resetImportedPeople() {
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // Receipts RESTRICT deletion of their payment (V1.12).
    await prisma.receipt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.due.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.person.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.importJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
  }

  beforeEach(async () => {
    await resetImportedPeople();
  });

  describe('validation and row-level behaviour', () => {
    it('1. a valid CSV creates the expected People', async () => {
      const res = await imports.importPeopleCsv(
        ids.tenantA,
        ids.userA,
        {
          csv: csv(
            'fullName,primaryPhone,secondaryPhone,email,address',
            `Asha Rao,${nextPhone()},+919000000001,asha@imp.test,1 Import Road`,
            `Bilal Khan,${nextPhone()},,bilal@imp.test,2 Import Road`,
          ),
        },
      );

      expect(res.totalRows).toBe(2);
      expect(res.successCount).toBe(2);
      expect(res.failureCount).toBe(0);
      expect(res.errors).toEqual([]);

      const created = await prisma.person.findMany({
        where: { tenantId: ids.tenantA },
        orderBy: { fullName: 'asc' },
      });
      expect(created).toHaveLength(2);
      expect(created[0].email).toBe('asha@imp.test');
      expect(created[0].address).toBe('1 Import Road');
      // Blank optional cell is stored as null, not an empty string.
      expect(created[1].secondaryPhone).toBeNull();
    });

    it('2. the first line is the header and is not imported as data', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone', `Header Check,${nextPhone()}`),
      });
      expect(res.successCount).toBe(1);
      const peopleList = await prisma.person.findMany({ where: { tenantId: ids.tenantA } });
      expect(peopleList).toHaveLength(1);
      expect(peopleList[0].fullName).toBe('Header Check');
    });

    it('3. a header-only CSV imports nothing and still records a job', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone,email'),
      });
      expect(res).toMatchObject({ totalRows: 0, successCount: 0, failureCount: 0, errors: [] });
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(0);

      const job = await prisma.importJob.findUnique({ where: { id: res.jobId } });
      expect(job).not.toBeNull();
      expect(job!.totalRows).toBe(0);
      expect(job!.errors).toBeNull();
    });

    it('4. a missing required field is a row error, not a Person', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone',
          `,${nextPhone()}`,
          `No Name Two,`,
          `Valid Person,${nextPhone()}`,
        ),
      });

      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(2);
      expect(res.errors).toHaveLength(2);
      // Row numbers are 1-based and count the header as row 1.
      expect(res.errors.map((e) => e.row)).toEqual([2, 3]);

      const peopleList = await prisma.person.findMany({ where: { tenantId: ids.tenantA } });
      expect(peopleList).toHaveLength(1);
      expect(peopleList[0].fullName).toBe('Valid Person');
    });

    it('5. an invalid email format is rejected by the existing Person rules', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,email',
          `Bad Email,${nextPhone()},not-an-email`,
          `Good Email,${nextPhone()},good@imp.test`,
        ),
      });
      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(1);
      expect(res.errors[0].message).toMatch(/email/i);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(1);
    });

    it('6. a duplicate primary phone inside one CSV fails only that row', async () => {
      const shared = nextPhone();
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone',
          `First Owner,${shared}`,
          `Second Owner,${shared}`,
          `Third Owner,${nextPhone()}`,
        ),
      });

      expect(res.successCount).toBe(2);
      expect(res.failureCount).toBe(1);
      expect(res.errors[0].message).toMatch(/already exists/i);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(2);
    });

    it('7. a phone already in the database fails only that row', async () => {
      const existing = nextPhone();
      await people.create(ids.tenantA, { fullName: 'Existing Person', primaryPhone: existing });

      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone',
          `Imported Duplicate,${existing}`,
          `Imported Fresh,${nextPhone()}`,
        ),
      });
      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(1);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(2);
    });

    it('8. blank lines are skipped rather than counted as failures', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: `fullName,primaryPhone\n\nPerson One,${nextPhone()}\n\n,,\n\nPerson Two,${nextPhone()}\n`,
      });
      expect(res.successCount).toBe(2);
      expect(res.failureCount).toBe(0);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(2);
    });

    it('9. quoted fields with commas and escaped quotes parse correctly', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,address',
          `"Verma, Ananya",${nextPhone()},"""Flat"" 12, Sector 5"`,
        ),
      });
      expect(res.successCount).toBe(1);
      const person = await prisma.person.findFirst({ where: { tenantId: ids.tenantA } });
      expect(person!.fullName).toBe('Verma, Ananya');
      expect(person!.address).toBe('"Flat" 12, Sector 5');
    });

    it('10. a ragged row (fewer cells than headers) becomes a row error', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone,email', `Short Row,${nextPhone()}`),
      });
      // Missing email is simply absent, so the row is still valid.
      expect(res.successCount).toBe(1);
      expect((await prisma.person.findFirst({ where: { tenantId: ids.tenantA } }))!.email).toBeNull();
    });

    it('11. unknown columns are ignored, not persisted', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,unknown_column,another',
          `Has Extras,${nextPhone()},junk,more`,
        ),
      });
      expect(res.successCount).toBe(1);
      const person = await prisma.person.findFirst({ where: { tenantId: ids.tenantA } });
      expect(person!.customData).toEqual({});
      expect(person).not.toHaveProperty('unknown_column');
    });

    it('12. tenant custom fields in the CSV are validated and stored', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,flat_number,membership_type',
          `Custom Ok,${nextPhone()},F-1,GOLD`,
          `Custom Bad Option,${nextPhone()},F-2,DIAMOND`,
        ),
      });

      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(1);
      expect(res.errors[0].message).toMatch(/allowed options/i);

      const person = await prisma.person.findFirst({
        where: { tenantId: ids.tenantA, fullName: 'Custom Ok' },
      });
      expect(person!.customData).toEqual({ flat_number: 'F-1', membership_type: 'GOLD' });

      // The rejected row created nothing at all.
      expect(await prisma.person.count({ where: { fullName: 'Custom Bad Option' } })).toBe(0);
    });

    it('13. an empty CSV payload is rejected by the DTO, and whitespace yields zero rows', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      const metadata = {
        type: 'body' as const,
        metatype: ImportPeopleCsvDto,
      };

      await expect(pipe.transform({ csv: '' }, metadata)).rejects.toThrow();
      await expect(pipe.transform({}, metadata)).rejects.toThrow();

      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, { csv: '   ' });
      expect(res.totalRows).toBe(0);
      expect(res.successCount).toBe(0);
    });

    it('14. mixed valid and invalid rows commit valid rows and report the rest', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,email',
          `Good One,${nextPhone()},good1@imp.test`,
          `Bad Email,${nextPhone()},nope`,
          `Good Two,${nextPhone()},good2@imp.test`,
          `,${nextPhone()},missing-name@imp.test`,
          `Bad Option,${nextPhone()},ok@imp.test`,
        ),
      });

      expect(res.totalRows).toBe(5);
      expect(res.successCount).toBe(3);
      expect(res.failureCount).toBe(2);
      expect(res.errors.map((e) => e.row)).toEqual([3, 5]);

      const names = (
        await prisma.person.findMany({ where: { tenantId: ids.tenantA }, orderBy: { fullName: 'asc' } })
      ).map((p) => p.fullName);
      expect(names).toEqual(['Bad Option', 'Good One', 'Good Two']);
    });

    it('15. the ImportJob records accurate counts and row-level diagnostics', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone',
          `Counted One,${nextPhone()}`,
          `Broken,`,
          `Counted Two,${nextPhone()}`,
        ),
      });

      const job = await prisma.importJob.findUnique({ where: { id: res.jobId } });
      expect(job).not.toBeNull();
      expect(job!.tenantId).toBe(ids.tenantA);
      expect(job!.performedByUserId).toBe(ids.userA);
      expect(job!.totalRows).toBe(3);
      expect(job!.successCount).toBe(2);
      expect(job!.failureCount).toBe(1);
      expect(job!.errors).toEqual([
        // Row 3 is `Broken,` — the name is present, the primary phone is not.
        { row: 3, message: expect.stringContaining('primaryPhone') },
      ]);
    });

    it('16. imports 50 rows (BR-02 volume) correctly', async () => {
      const lines = ['fullName,primaryPhone,email'];
      for (let i = 0; i < 50; i += 1) {
        lines.push(`Bulk Person ${i},+91998${String(i).padStart(5, '0')},bulk${i}@imp.test`);
      }

      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, { csv: lines.join('\n') });

      expect(res.totalRows).toBe(50);
      expect(res.successCount).toBe(50);
      expect(res.failureCount).toBe(0);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(50);
    });
  });

  describe('security', () => {
    it('1. unauthenticated requests are rejected', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer expired' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('2. a tenantless JWT is rejected', () => {
      expect(() => authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('3. Admin is allowed', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'importPeople'))).toBe(true);
    });

    it('4. Collector and Viewer are denied (import:people:execute)', () => {
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => rolesGuard.canActivate(rolesContext(token, 'importPeople'))).toThrow(
          ForbiddenException,
        );
      }
    });

    it('5. a tenantId property in the body is rejected by the whitelist pipe', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      const metadata = {
        type: 'body' as const,
        metatype: ImportPeopleCsvDto,
      };

      await expect(
        pipe.transform({ csv: 'fullName,primaryPhone', tenantId: ids.tenantB }, metadata),
      ).rejects.toThrow();
      await expect(
        pipe.transform({ csv: 'fullName,primaryPhone', tenantId: null }, metadata),
      ).rejects.toThrow();
    });

    it('6. a tenantId query/path/body override is rejected by the guard', () => {
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

    it('7. CSV content cannot override tenant ownership', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,tenantId',
          `Owner Probe,${nextPhone()},${ids.tenantB}`,
          `Owner Probe Two,${nextPhone()},${ids.tenantB}`,
        ),
      });

      expect(res.successCount).toBe(2);

      // Everything landed in the JWT tenant; none in the targeted tenant.
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(2);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantB } })).toBe(0);

      const job = await prisma.importJob.findUnique({ where: { id: res.jobId } });
      expect(job!.tenantId).toBe(ids.tenantA);
    });

    it('8. a Tenant A import cannot create records under Tenant B', async () => {
      // A Tenant B person already exists with a phone the CSV will reuse.
      const bPhone = nextPhone();
      await people.create(ids.tenantB, { fullName: 'Tenant B Existing', primaryPhone: bPhone });

      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone',
          `Clash With B,${bPhone}`,
          `Fine For A,${nextPhone()}`,
        ),
      });

      // The clash is only a duplicate within Tenant A, so this row imports
      // normally and stays inside Tenant A.
      expect(res.successCount).toBe(2);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(2);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantB } })).toBe(1);
    });

    it('9. another tenant custom-field definition cannot be used', async () => {
      // room_number is defined only for Tenant B.
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone,room_number', `Foreign Field,${nextPhone()},R-1`),
      });

      expect(res.successCount).toBe(1);
      const person = await prisma.person.findFirst({ where: { tenantId: ids.tenantA } });
      // The unknown column was dropped, not stored and not an error.
      expect(person!.customData).toEqual({});
    });

    it('10. the controller derives the tenant only from the JWT', async () => {
      const res = await controller.importPeople(jwtService.verify('admin-a'), {
        csv: csv('fullName,primaryPhone', `Via Controller,${nextPhone()}`),
      });
      expect(res.successCount).toBe(1);

      const job = await prisma.importJob.findUnique({ where: { id: res.jobId } });
      expect(job!.tenantId).toBe(ids.tenantA);

      // Tenant B sees none of it.
      const bJobs = await prisma.importJob.findMany({ where: { tenantId: ids.tenantB } });
      expect(bJobs).toHaveLength(0);
    });
  });

  describe('data safety', () => {
    it('11. a failed row leaves no partial Person record', async () => {
      const res = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv(
          'fullName,primaryPhone,email,membership_type',
          // Valid name and phone, but the dropdown value is not configured.
          `Partial Risk,${nextPhone()},partial@imp.test,NOT_A_TYPE`,
        ),
      });

      expect(res.failureCount).toBe(1);
      expect(await prisma.person.count({ where: { fullName: 'Partial Risk' } })).toBe(0);
      expect(await prisma.person.count({ where: { tenantId: ids.tenantA } })).toBe(0);
    });

    it('12. import does not modify existing People or financial history', async () => {
      const existing = await people.create(ids.tenantA, {
        fullName: 'Untouched Person',
        primaryPhone: nextPhone(),
        customData: { flat_number: 'ORIG-1' },
      });

      const created = await charges.createOneTimeCharge(ids.tenantA, ids.userA, {
        personId: existing.id,
        category: 'Tuition',
        baseAmountMinor: '90000',
        dueDate: '2026-03-10',
      });
      await payments.collectPayment(ids.tenantA, ids.userA, {
        dueId: created.due.id,
        amountMinor: '30000',
        paymentMode: 'CASH' as any,
        idempotencyKey: `imp-key-${Date.now()}-safe`,
      });

      const beforePerson = await prisma.person.findUnique({ where: { id: existing.id } });
      const beforeDue = await prisma.due.findUnique({ where: { id: created.due.id } });
      const beforeLogs = await prisma.financialTransactionLog.count({
        where: { tenantId: ids.tenantA },
      });
      const beforePayments = await prisma.payment.count({ where: { tenantId: ids.tenantA } });

      await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone', `Brand New,${nextPhone()}`),
      });

      const afterPerson = await prisma.person.findUnique({ where: { id: existing.id } });
      const afterDue = await prisma.due.findUnique({ where: { id: created.due.id } });
      expect(afterPerson!.fullName).toBe(beforePerson!.fullName);
      expect(afterPerson!.customData).toEqual({ flat_number: 'ORIG-1' });
      expect(afterPerson!.advanceBalance).toBe(beforePerson!.advanceBalance);
      expect(afterPerson!.status).toBe(beforePerson!.status);
      expect(afterDue!.balanceRemaining).toBe(beforeDue!.balanceRemaining);
      expect(afterDue!.netAmount).toBe(beforeDue!.netAmount);
      // The import writes no financial ledger entries.
      expect(await prisma.financialTransactionLog.count({ where: { tenantId: ids.tenantA } })).toBe(
        beforeLogs,
      );
      expect(await prisma.payment.count({ where: { tenantId: ids.tenantA } })).toBe(beforePayments);
      expect(await prisma.charge.count({ where: { tenantId: ids.tenantA } })).toBe(1);
    });

    it('13. no duplicates are created beyond the documented per-tenant uniqueness', async () => {
      const phone = nextPhone();
      await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone', `Once Only,${phone}`),
      });
      await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone', `Twice Only,${phone}`),
      });

      const matches = await prisma.person.findMany({ where: { tenantId: ids.tenantA, primaryPhone: phone } });
      expect(matches).toHaveLength(1);
      expect(matches[0].fullName).toBe('Once Only');
    });

    it('14. the same phone is allowed in a different tenant', async () => {
      const phone = nextPhone();
      const a = await imports.importPeopleCsv(ids.tenantA, ids.userA, {
        csv: csv('fullName,primaryPhone', `Tenant A,${phone}`),
      });
      const b = await imports.importPeopleCsv(ids.tenantB, ids.userB, {
        csv: csv('fullName,primaryPhone', `Tenant B,${phone}`),
      });
      expect(a.successCount).toBe(1);
      expect(b.successCount).toBe(1);
      expect(await prisma.person.count({ where: { primaryPhone: phone } })).toBe(2);
    });
  });
});