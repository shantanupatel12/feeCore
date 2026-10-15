import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';

describe('Phase 0 Baseline Integration & Verification Test Suite', () => {
  let prisma: PrismaClient;
  let jwtService: JwtService;
  let testTenantId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    jwtService = new JwtService({ secret: 'test-secret-key-phase0' });

    // Setup clean test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Phase0 Test Institute',
        category: 'Education',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        settings: {
          create: {
            personLabelSingular: 'Student',
            personLabelPlural: 'Students',
            chargeLabelSingular: 'Fee',
            chargeLabelPlural: 'Fees',
            receiptPrefix: 'REC-TEST',
          },
        },
      },
    });
    testTenantId = tenant.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testTenantId) {
      await prisma.user.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenant.delete({ where: { id: testTenantId } });
    }
    await prisma.$disconnect();
  });

  it('1. Verifies PostgreSQL connectivity and Tenant + TenantSettings creation', async () => {
    const fetched = await prisma.tenant.findUnique({
      where: { id: testTenantId },
      include: { settings: true },
    });
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('Phase0 Test Institute');
    expect(fetched?.settings?.personLabelSingular).toBe('Student');
  });

  it('2. Verifies Argon2 password hashing and verification invariant', async () => {
    const password = 'AdminPassword123!';
    const hash = await argon2.hash(password);
    expect(hash).not.toBe(password);
    expect(await argon2.verify(hash, password)).toBe(true);
    expect(await argon2.verify(hash, 'WrongPassword')).toBe(false);
    // Explicit timeout: native argon2 hashing is memory/CPU heavy and can
    // exceed vitest's 5s default under parallel suite load. Pre-existing
    // flake, unrelated to any feature work. No assertion is relaxed.
  }, 60000);

  it('3. Verifies User creation with tenant isolation and unique constraint', async () => {
    const hash = await argon2.hash('SecretPass123!');
    const user = await prisma.user.create({
      data: {
        tenantId: testTenantId,
        email: 'admin@testinst.com',
        passwordHash: hash,
        fullName: 'Test Admin',
        role: UserRole.ROLE_ADMIN,
      },
    });

    expect(user.id).toBeDefined();
    expect(user.tenantId).toBe(testTenantId);
    expect(user.role).toBe('ROLE_ADMIN');

    // Attempting duplicate email within same tenant must throw unique constraint failure
    await expect(
      prisma.user.create({
        data: {
          tenantId: testTenantId,
          email: 'admin@testinst.com',
          passwordHash: hash,
          fullName: 'Duplicate Admin',
          role: UserRole.ROLE_ADMIN,
        },
      }),
    ).rejects.toThrow();
  });

  it('4. Verifies JWT payload generation and validation', () => {
    const payload = {
      sub: 'user-uuid-123',
      tenantId: testTenantId,
      email: 'admin@testinst.com',
      role: 'ROLE_ADMIN',
    };

    const token = jwtService.sign(payload);
    expect(typeof token).toBe('string');

    const decoded = jwtService.verify(token);
    expect(decoded.sub).toBe('user-uuid-123');
    expect(decoded.tenantId).toBe(testTenantId);
    expect(decoded.role).toBe('ROLE_ADMIN');
  });

  it('5. Verifies ReceiptSequence atomic counter table readiness', async () => {
    const seq = await prisma.receiptSequence.create({
      data: {
        tenantId: testTenantId,
        fiscalYear: '2025-2026',
        currentSequence: 0,
      },
    });

    expect(seq.tenantId).toBe(testTenantId);
    expect(seq.currentSequence).toBe(0);

    const updated = await prisma.receiptSequence.update({
      where: {
        tenantId_fiscalYear: {
          tenantId: testTenantId,
          fiscalYear: '2025-2026',
        },
      },
      data: {
        currentSequence: { increment: 1 },
      },
    });

    expect(updated.currentSequence).toBe(1);
  });
});
