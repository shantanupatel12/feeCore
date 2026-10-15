import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, CustomFieldDataType } from '@prisma/client';
import { PeopleService } from '../src/modules/people/people.service.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';

describe('Phase 1: People & Custom Fields Integration Test Suite', () => {
  let prisma: PrismaClient;
  let customFieldsService: CustomFieldsService;
  let peopleService: PeopleService;

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    customFieldsService = new CustomFieldsService(prisma as any);
    peopleService = new PeopleService(prisma as any, customFieldsService);

    const tenantA = await prisma.tenant.create({
      data: { name: 'Tenant Alpha (School)', category: 'School' },
    });
    tenantAId = tenantA.id;

    const tenantB = await prisma.tenant.create({
      data: { name: 'Tenant Beta (Gym)', category: 'Gym' },
    });
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    if (tenantAId || tenantBId) {
      await prisma.person.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
      await prisma.customFieldDefinition.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    }
    await prisma.$disconnect();
  });

  it('1. Creates Custom Field definitions for Tenant A', async () => {
    const rollNo = await customFieldsService.create(tenantAId, {
      fieldKey: 'roll_number',
      fieldLabel: 'Roll Number',
      dataType: CustomFieldDataType.TEXT,
      isRequired: true,
      displayOrder: 1,
    });

    const gradeSection = await customFieldsService.create(tenantAId, {
      fieldKey: 'section',
      fieldLabel: 'Section',
      dataType: CustomFieldDataType.SELECT,
      options: ['A', 'B', 'C'],
      isRequired: false,
      displayOrder: 2,
    });

    expect(rollNo.fieldKey).toBe('roll_number');
    expect(gradeSection.dataType).toBe('SELECT');

    const fields = await customFieldsService.findAll(tenantAId);
    expect(fields.length).toBe(2);
  });

  it('2. Enforces required custom fields and SELECT options validation', async () => {
    // Missing required field 'roll_number'
    await expect(
      peopleService.create(tenantAId, {
        fullName: 'John Doe',
        primaryPhone: '+919876543210',
        customData: {},
      }),
    ).rejects.toThrow(/required/);

    // Invalid option for SELECT field 'section'
    await expect(
      peopleService.create(tenantAId, {
        fullName: 'John Doe',
        primaryPhone: '+919876543210',
        customData: {
          roll_number: '101',
          section: 'INVALID_SECTION',
        },
      }),
    ).rejects.toThrow(/allowed options/);
  });

  it('3. Successfully creates Person with valid customData and default 0 advance balance', async () => {
    const person = await peopleService.create(tenantAId, {
      fullName: 'Rahul Sharma',
      primaryPhone: '+919876543210',
      email: 'rahul@example.com',
      customData: {
        roll_number: '101',
        section: 'A',
      },
    });

    expect(person.id).toBeDefined();
    expect(person.fullName).toBe('Rahul Sharma');
    expect(person.advanceBalanceMinor).toBe('0');
    expect(person.customData).toEqual({ roll_number: '101', section: 'A' });
  });

  it('4. Enforces primary phone uniqueness per tenant', async () => {
    await expect(
      peopleService.create(tenantAId, {
        fullName: 'Duplicate Rahul',
        primaryPhone: '+919876543210',
        customData: { roll_number: '102' },
      }),
    ).rejects.toThrow(/already exists/);

    // Same phone number in different tenant (Tenant B) is allowed
    const personB = await peopleService.create(tenantBId, {
      fullName: 'Rahul Sharma Gym',
      primaryPhone: '+919876543210',
    });
    expect(personB.id).toBeDefined();
    expect(personB.tenantId).toBe(tenantBId);
  });

  it('5. Verifies Strict Tenant Isolation on search & list', async () => {
    const listA = await peopleService.findAll(tenantAId);
    const listB = await peopleService.findAll(tenantBId);

    expect(listA.items.length).toBe(1);
    expect(listA.items[0].fullName).toBe('Rahul Sharma');

    expect(listB.items.length).toBe(1);
    expect(listB.items[0].fullName).toBe('Rahul Sharma Gym');

    // Attempting to view tenant A person using tenant B ID must fail with NotFound
    await expect(peopleService.findOne(tenantBId, listA.items[0].id)).rejects.toThrow(/not found/);
  });

  it('6. Tests search filter and person updates', async () => {
    await peopleService.create(tenantAId, {
      fullName: 'Priya Verma',
      primaryPhone: '+919999888877',
      customData: { roll_number: '102' },
    });

    const searchResult = await peopleService.findAll(tenantAId, { search: 'Priya' });
    expect(searchResult.total).toBe(1);
    expect(searchResult.items[0].fullName).toBe('Priya Verma');

    const updated = await peopleService.update(tenantAId, searchResult.items[0].id, {
      secondaryPhone: '+911111222233',
    });

    expect(updated.secondaryPhone).toBe('+911111222233');
    // V1.23: generic update no longer carries `status`; the dedicated
    // deactivate endpoint is the only writer, and it is Admin-only.
    expect(updated.status).toBe('ACTIVE');
  });
});
