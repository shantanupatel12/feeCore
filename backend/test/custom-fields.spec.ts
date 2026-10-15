import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, CustomFieldDataType } from '@prisma/client';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { CustomFieldsController } from '../src/modules/people/custom-fields.controller.js';
import { PeopleService } from '../src/modules/people/people.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { normalizeDataType, normalizeFieldKey } from '../src/modules/people/dto/custom-field.dto.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

/** Minimal JWT stand-in, mirroring test/tenant-isolation.spec.ts. */
/** Real database ids, resolved in beforeAll and used by the JWT stub. */
const tenantIds: Record<string, string> = {};

const jwtService = {
  verify: (token: string): JwtPayload => {
    const byToken: Record<string, JwtPayload> = {
      'admin-a': { sub: 'u1', tenantId: tenantIds.A, email: 'a@x.com', role: 'ROLE_ADMIN' },
      'admin-b': { sub: 'u2', tenantId: tenantIds.B, email: 'b@x.com', role: 'ROLE_ADMIN' },
      'collector-a': { sub: 'u3', tenantId: tenantIds.A, email: 'c@x.com', role: 'ROLE_COLLECTOR' },
      'viewer-a': { sub: 'u4', tenantId: tenantIds.A, email: 'v@x.com', role: 'ROLE_VIEWER' },
    };
    if (token === 'tenantless') {
      return { sub: 'u5', email: 't@x.com', role: 'ROLE_ADMIN' } as unknown as JwtPayload;
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

describe('V1.19: Custom Fields / Custom Information (FR-CFD-01, FR-CFD-02, BR-12)', () => {
  let prisma: PrismaClient;
  let customFields: CustomFieldsService;
  let people: PeopleService;
  let controller: CustomFieldsController;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    controller = new CustomFieldsController(customFields);

    tenantAId = (await prisma.tenant.create({ data: { name: 'CFD Tenant A', category: 'School' } })).id;
    tenantBId = (await prisma.tenant.create({ data: { name: 'CFD Tenant B', category: 'Gym' } })).id;
    tenantIds.A = tenantAId;
    tenantIds.B = tenantBId;
  });

  afterAll(async () => {
    const ids = [tenantAId, tenantBId];
    await prisma.person.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customFieldDefinition.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------
  // DEFINITIONS
  // ------------------------------------------------------------------
  describe('definitions', () => {
    it('creates a TEXT field (Flat Number)', async () => {
      const f = await customFields.create(tenantAId, {
        fieldKey: 'flat_number',
        fieldLabel: 'Flat Number',
        dataType: CustomFieldDataType.TEXT,
      });
      expect(f.fieldKey).toBe('flat_number');
      expect(f.dataType).toBe('TEXT');
      expect(f.isRequired).toBe(false);
    });

    it('creates a NUMBER field (Patient ID)', async () => {
      const f = await customFields.create(tenantAId, {
        fieldKey: 'patient_id',
        fieldLabel: 'Patient ID',
        dataType: CustomFieldDataType.NUMBER,
      });
      expect(f.dataType).toBe('NUMBER');
    });

    it('creates a DATE field (Joining Date)', async () => {
      const f = await customFields.create(tenantAId, {
        fieldKey: 'joining_date',
        fieldLabel: 'Joining Date',
        dataType: CustomFieldDataType.DATE,
      });
      expect(f.dataType).toBe('DATE');
    });

    it('creates a DROPDOWN field (Membership Type) and normalises to SELECT', async () => {
      const f = await customFields.create(tenantAId, {
        fieldKey: 'membership_type',
        fieldLabel: 'Membership Type',
        // The SRS prose says "DROPDOWN"; the stored enum is SELECT.
        dataType: normalizeDataType('DROPDOWN')!,
        options: ['GOLD', 'SILVER'],
      });
      expect(f.dataType).toBe('SELECT');
      expect(f.options).toEqual(['GOLD', 'SILVER']);
    });

    it('creates a YES/NO field (Has Trainer) and normalises to BOOLEAN', async () => {
      const f = await customFields.create(tenantAId, {
        fieldKey: 'has_trainer',
        fieldLabel: 'Has Trainer',
        dataType: normalizeDataType('YES/NO')!,
      });
      expect(f.dataType).toBe('BOOLEAN');
    });

    it('lists only the authenticated tenant definitions, in display order', async () => {
      const list = await customFields.findAll(tenantAId);
      expect(list.map((f) => f.fieldKey).sort()).toEqual([
        'flat_number',
        'has_trainer',
        'joining_date',
        'membership_type',
        'patient_id',
      ]);
      expect(list.every((f) => f.tenantId === tenantAId)).toBe(true);

      const bList = await customFields.findAll(tenantBId);
      expect(bList).toHaveLength(0);
    });

    it('updates label, required flag and options', async () => {
      const target = await customFields.findOne(tenantAId, (
        await customFields.findAll(tenantAId)
      ).find((f) => f.fieldKey === 'flat_number')!.id);

      const updated = await customFields.update(tenantAId, target.id, {
        fieldLabel: 'Apartment Number',
        displayOrder: 5,
        isRequired: true,
      });
      expect(updated.fieldLabel).toBe('Apartment Number');
      expect(updated.displayOrder).toBe(5);
      expect(updated.isRequired).toBe(true);
      // fieldKey is immutable: it is the JSONB property name in use.
      expect(updated.fieldKey).toBe('flat_number');

      // Restore optional so the required-flag behaviour is exercised by a
      // dedicated field instead of leaking into every other case.
      await customFields.update(tenantAId, target.id, { isRequired: false });
      expect((await customFields.findOne(tenantAId, target.id)).isRequired).toBe(false);

      const sel = await customFields.findOne(tenantAId, (
        await customFields.findAll(tenantAId)
      ).find((f) => f.fieldKey === 'membership_type')!.id);
      const selUpdated = await customFields.update(tenantAId, sel.id, {
        options: ['GOLD', 'SILVER', 'PLATINUM'],
      });
      expect(selUpdated.options).toEqual(['GOLD', 'SILVER', 'PLATINUM']);
    });

    it('rejects a duplicate key in the same tenant, including key variants that normalise alike', async () => {
      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'flat_number',
          fieldLabel: 'Duplicate',
          dataType: CustomFieldDataType.TEXT,
        }),
      ).rejects.toThrow(ConflictException);

      // "Flat Number" normalises to flat_number and must collide, not 500
      // on the database's unique constraint.
      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'Flat Number',
          fieldLabel: 'Duplicate variant',
          dataType: CustomFieldDataType.TEXT,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same key in a different tenant', async () => {
      const b = await customFields.create(tenantBId, {
        fieldKey: 'flat_number',
        fieldLabel: 'Room Number',
        dataType: CustomFieldDataType.TEXT,
      });
      expect(b.tenantId).toBe(tenantBId);

      const aKeys = (await customFields.findAll(tenantAId)).map((f) => f.fieldKey);
      const bKeys = (await customFields.findAll(tenantBId)).map((f) => f.fieldKey);
      expect(aKeys).toContain('flat_number');
      expect(bKeys).toEqual(['flat_number']);
    });

    it('rejects an unsupported data type', async () => {
      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'colour',
          fieldLabel: 'Colour',
          dataType: 'GEOLOCATION' as any,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid dropdown configuration', async () => {
      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'no_options',
          fieldLabel: 'No Options',
          dataType: CustomFieldDataType.SELECT,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'blank_option',
          fieldLabel: 'Blank Option',
          dataType: CustomFieldDataType.SELECT,
          options: ['A', '   '],
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'dupe_option',
          fieldLabel: 'Duplicate Option',
          dataType: CustomFieldDataType.SELECT,
          options: ['A', 'B', 'A'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects options on a non-dropdown field', async () => {
      await expect(
        customFields.create(tenantAId, {
          fieldKey: 'text_with_options',
          fieldLabel: 'Text With Options',
          dataType: CustomFieldDataType.TEXT,
          options: ['A'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('keeps fieldKey immutable on update and normalises SRS data-type synonyms', () => {
      expect(normalizeDataType('YES/NO')).toBe(CustomFieldDataType.BOOLEAN);
      expect(normalizeDataType('Dropdown')).toBe(CustomFieldDataType.SELECT);
      expect(normalizeDataType('nonsense')).toBeUndefined();
      expect(normalizeFieldKey(' Flat Number ')).toBe('flat_number');
    });
  });

  // ------------------------------------------------------------------
  // SECURITY
  // ------------------------------------------------------------------
  describe('security', () => {
    // Both guards are synchronous, so the throw is asserted directly
    // rather than through an async matcher.
    it('rejects an unauthenticated request', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer expired' })),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a token that carries no tenant context', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);
    });

    it('authenticates a Collector, who may read schemas', () => {
      expect(authGuard.canActivate(makeContext({ authorization: 'Bearer collector-a' }))).toBe(true);
    });

    function rolesContext(token: string, handler: keyof CustomFieldsController) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
        getHandler: () => CustomFieldsController.prototype[handler],
        getClass: () => CustomFieldsController,
      } as unknown as ExecutionContext;
    }

    it('denies Collector and Viewer schema management per the permission matrix', () => {
      // custom_fields:schema:manage is ALLOW for Owner/Admin only.
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => rolesGuard.canActivate(rolesContext(token, 'create'))).toThrow(ForbiddenException);
        expect(() => rolesGuard.canActivate(rolesContext(token, 'update'))).toThrow(ForbiddenException);
      }
    });

    it('allows Admin to manage schemas', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'create'))).toBe(true);
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'update'))).toBe(true);
    });

    it('allows any authenticated role to read schemas', () => {
      for (const token of ['admin-a', 'collector-a', 'viewer-a']) {
        expect(rolesGuard.canActivate(rolesContext(token, 'findAll'))).toBe(true);
      }
    });

    it('blocks cross-tenant read of a definition', async () => {
      const bField = await customFields.create(tenantBId, {
        fieldKey: 'room_number',
        fieldLabel: 'Room Number',
        dataType: CustomFieldDataType.TEXT,
      });
      const aUser = { tenantId: tenantAId } as JwtPayload;

      // The controller resolves the tenant from the JWT, so a Tenant A
      // caller never sees Tenant B's definition.
      expect(await customFields.findAll(aUser.tenantId)).not.toContainEqual(
        expect.objectContaining({ id: bField.id }),
      );
      await expect(customFields.findOne(aUser.tenantId, bField.id)).rejects.toThrow(NotFoundException);
    });

    it('blocks cross-tenant update and delete of a definition', async () => {
      const bField = await customFields.create(tenantBId, {
        fieldKey: 'trainer',
        fieldLabel: 'Trainer',
        dataType: CustomFieldDataType.TEXT,
      });
      const aUser = { tenantId: tenantAId } as JwtPayload;

      await expect(
        customFields.update(aUser.tenantId, bField.id, { fieldLabel: 'Hijacked' }),
      ).rejects.toThrow(NotFoundException);
      await expect(customFields.remove(aUser.tenantId, bField.id)).rejects.toThrow(NotFoundException);

      const still = await customFields.findOne(tenantBId, bField.id);
      expect(still.fieldLabel).toBe('Trainer');
    });

    it('rejects a client-supplied tenantId override in the request body', () => {
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: tenantIds.B }),
        ),
      ).toThrow(ForbiddenException);

      // Even a path-based override is refused by the guard.
      expect(() =>
        authGuard.canActivate(
          makeContext({ authorization: 'Bearer admin-a' }, { tenantId: tenantIds.B }),
        ),
      ).toThrow(ForbiddenException);

      // An explicit null is a supplied value, not an absent one.
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null })),
      ).toThrow(ForbiddenException);
    });

    it('drives the controller strictly from the JWT tenant', async () => {
      const adminA = jwtService.verify('admin-a');
      const aBefore = (await controller.findAll(adminA)).length;
      const bBefore = (await controller.findAll(jwtService.verify('admin-b'))).length;

      const created = await controller.create(adminA, {
        fieldKey: 'class',
        fieldLabel: 'Class',
        dataType: CustomFieldDataType.TEXT,
      });
      expect(created.tenantId).toBe(tenantIds.A);
      expect((await controller.findAll(adminA)).length).toBe(aBefore + 1);

      // The Tenant A write is invisible to Tenant B.
      expect((await controller.findAll(jwtService.verify('admin-b'))).length).toBe(bBefore);
      expect(
        await controller.findAll(jwtService.verify('admin-b')),
      ).not.toContainEqual(expect.objectContaining({ fieldKey: 'class' }));
    });
  });

  // ------------------------------------------------------------------
  // PERSON VALUES
  // ------------------------------------------------------------------
  describe('person custom values', () => {
    it('accepts valid values for every supported type', async () => {
      const person = await people.create(tenantAId, {
        fullName: 'Asha Verma',
        primaryPhone: '+919800000001',
        customData: {
          flat_number: 'A-12',
          patient_id: 4021,
          joining_date: '2026-01-15',
          membership_type: 'GOLD',
          has_trainer: true,
        },
      });

      expect(person.customData).toEqual({
        flat_number: 'A-12',
        patient_id: 4021,
        joining_date: '2026-01-15',
        membership_type: 'GOLD',
        has_trainer: true,
      });
    });

    it('coerces accepted numeric and boolean representations', async () => {
      const person = await people.create(tenantAId, {
        fullName: 'Nikhil Rao',
        primaryPhone: '+919800000002',
        customData: { patient_id: '77', has_trainer: 'no' },
      });
      expect(person.customData).toEqual({ patient_id: 77, has_trainer: false });
    });

    it('updates custom values on an existing person', async () => {
      const person = await people.create(tenantAId, {
        fullName: 'Deepa Menon',
        primaryPhone: '+919800000003',
        customData: { flat_number: 'B-1', patient_id: 10, has_trainer: true },
      });

      const updated = await people.update(tenantAId, person.id, {
        customData: { flat_number: 'B-2', membership_type: 'SILVER' },
      });

      // Untouched values survive the partial update.
      expect(updated.customData).toEqual({
        flat_number: 'B-2',
        patient_id: 10,
        has_trainer: true,
        membership_type: 'SILVER',
      });
    });

    it('rejects an invalid NUMBER value', async () => {
      // '' is deliberately absent: like null it means "no value supplied",
      // which is how a required field is signalled. It is not a number.
      const cases: unknown[] = ['abc', '   ', true, 'NaN', 'Infinity', { a: 1 }, []];
      for (const [i, bad] of cases.entries()) {
        await expect(
          people.create(tenantAId, {
            fullName: `Bad Number ${i}`,
            primaryPhone: `+9198100${String(i).padStart(4, '0')}`,
            customData: { patient_id: bad },
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects an invalid DATE value', async () => {
      const cases: unknown[] = ['15-01-2026', '2026-13-01', '2026-02-30', 'yesterday', '2026-1-5', 20260115];
      for (const [i, bad] of cases.entries()) {
        await expect(
          people.create(tenantAId, {
            fullName: `Bad Date ${i}`,
            primaryPhone: `+9198200${String(i).padStart(4, '0')}`,
            customData: { joining_date: bad },
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects an invalid YES/NO value', async () => {
      const cases: unknown[] = ['banana', 7, {}, [], 'yess'];
      for (const [i, bad] of cases.entries()) {
        await expect(
          people.create(tenantAId, {
            fullName: `Bad Bool ${i}`,
            primaryPhone: `+9198300${String(i).padStart(4, '0')}`,
            customData: { has_trainer: bad },
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects a DROPDOWN value that is not a configured option', async () => {
      await expect(
        people.create(tenantAId, {
          fullName: 'Bad Dropdown',
          primaryPhone: '+9198000040',
          customData: { membership_type: 'DIAMOND' },
        }),
      ).rejects.toThrow(/allowed options/);
    });

    it('enforces the required flag on create and on update', async () => {
      // A dedicated required field keeps this case independent of the
      // other definitions.
      const seat = await customFields.create(tenantAId, {
        fieldKey: 'seat_number',
        fieldLabel: 'Seat Number',
        dataType: CustomFieldDataType.TEXT,
        isRequired: true,
      });

      await expect(
        people.create(tenantAId, {
          fullName: 'Missing Required',
          primaryPhone: '+9198000050',
          customData: { patient_id: 1 },
        }),
      ).rejects.toThrow(/required/);

      await expect(
        people.create(tenantAId, {
          fullName: 'Empty Required',
          primaryPhone: '+9198000052',
          customData: { seat_number: '' },
        }),
      ).rejects.toThrow(/required/);

      const person = await people.create(tenantAId, {
        fullName: 'Has Required',
        primaryPhone: '+9198000051',
        customData: { seat_number: 'C-1', patient_id: 2 },
      });

      // Clearing a required value is refused rather than silently dropped.
      await expect(
        people.update(tenantAId, person.id, { customData: { seat_number: null } }),
      ).rejects.toThrow(/required/);

      // Omitting it from a partial update keeps the existing value.
      const kept = await people.update(tenantAId, person.id, { customData: { patient_id: 3 } });
      expect(kept.customData).toMatchObject({ seat_number: 'C-1', patient_id: 3 });

      // Required-ness is tenant schema, so removing the definition ends the
      // constraint for every other case in this suite.
      await customFields.remove(tenantAId, seat.id);
    });

    it('does not delete stored values when a definition is redefined', async () => {
      const person = await people.create(tenantAId, {
        fullName: 'Value Keeper',
        primaryPhone: '+9198000060',
        customData: { flat_number: 'D-9', patient_id: 5, membership_type: 'GOLD' },
      });

      // Narrowing the option list must not silently rewrite person data.
      const sel = await customFields.findOne(tenantAId, (
        await customFields.findAll(tenantAId)
      ).find((f) => f.fieldKey === 'membership_type')!.id);
      await customFields.update(tenantAId, sel.id, { options: ['GOLD'] });

      const after = await people.findOne(tenantAId, person.id);
      expect(after.customData).toEqual({
        flat_number: 'D-9',
        patient_id: 5,
        membership_type: 'GOLD',
      });
    });

    it('enforces tenant-specific definitions', async () => {
      // `room_number` exists only for Tenant B; Tenant A cannot use it.
      await expect(
        people.create(tenantAId, {
          fullName: 'Cross Tenant',
          primaryPhone: '+9198000070',
          customData: { room_number: 'R-1' },
        }),
      ).rejects.toThrow(/Unknown custom field/);

      const bPerson = await people.create(tenantBId, {
        fullName: 'Tenant B Member',
        primaryPhone: '+9198000071',
        customData: { room_number: 'R-1', flat_number: 'G-2' },
      });
      expect(bPerson.customData).toEqual({ room_number: 'R-1', flat_number: 'G-2' });

      // Tenant B's own definition must not validate against Tenant A.
      await expect(
        people.create(tenantAId, {
          fullName: 'Cross Tenant Two',
          primaryPhone: '+9198000072',
          customData: { room_number: 'R-2' },
        }),
      ).rejects.toThrow(/Unknown custom field/);
    });

    it('keeps a person updatable after a definition is removed', async () => {
      const orphan = await people.create(tenantAId, {
        fullName: 'Orphan Holder',
        primaryPhone: '+9198000080',
        customData: { flat_number: 'H-1', patient_id: 3 },
      });

      const legacy = await customFields.create(tenantAId, {
        fieldKey: 'legacy_code',
        fieldLabel: 'Legacy Code',
        dataType: CustomFieldDataType.TEXT,
      });
      await people.update(tenantAId, orphan.id, { customData: { legacy_code: 'L-1' } });
      await customFields.remove(tenantAId, legacy.id);

      // The orphaned value stays on the person, and unrelated updates
      // must not fail just because the key is no longer defined.
      const updated = await people.update(tenantAId, orphan.id, {
        customData: { flat_number: 'H-2' },
      });
      expect(updated.customData).toEqual({ flat_number: 'H-2', patient_id: 3, legacy_code: 'L-1' });
    });
  });
});