import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, UserRole } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationsService } from '../src/modules/organizations/organizations.service.js';
import { OrganizationsController } from '../src/modules/organizations/organizations.controller.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ReceiptsService } from '../src/modules/receipts/receipts.service.js';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateOrganizationProfileDto } from '../src/modules/organizations/dto/update-organization-profile.dto.js';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

describe('V1.15: Organization profile (FR-ORG-01 / BR-RCP-002)', () => {
  let prisma: PrismaClient;
  let orgs: OrganizationsService;
  let payments: PaymentsService;
  let receipts: ReceiptsService;

  let tenantA: string;
  let tenantB: string;
  let personA: string;
  let adminA: string;

  let keySeq = 0;
  const nextKey = () => `org-key-${Date.now()}-${keySeq++}`;

  const adminOf = (tenantId: string) =>
    ({
      sub: 'u',
      tenantId,
      email: 'admin@org.test',
      role: UserRole.ROLE_ADMIN,
    }) as JwtPayload;

  const userWithRole = (tenantId: string, role: UserRole) =>
    ({ sub: 'u', tenantId, email: 'x@y.z', role }) as JwtPayload;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({
      data: { name: 'Org A Initial', category: 'School' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Org B Initial', category: 'School' },
    });
    tenantB = tB.id;

    const adminUser = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@org.test',
        passwordHash: 'h',
        fullName: 'Org Admin A',
        role: UserRole.ROLE_ADMIN,
      },
    });
    adminA = adminUser.id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Org Person A',
          primaryPhone: '9600000001',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    const charge = await prisma.charge.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        category: 'TUITION',
        baseAmount: BigInt(500),
        discountAmount: BigInt(0),
        createdByUserId: adminA,
      },
    });

    await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: charge.id,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(500),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(500),
        status: DueStatus.PENDING,
      },
    });

    orgs = new OrganizationsService(prisma as any);
    payments = new PaymentsService(prisma as any);
    receipts = new ReceiptsService(prisma as any);
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.auditLog.deleteMany({ where: { tenantId: t } });
    }
    await prisma.due.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });

    for (const t of [tenantA, tenantB]) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. reads the organization profile with existing defaults', async () => {
    const profile = await orgs.getProfile(tenantA);

    expect(profile.id).toBe(tenantA);
    expect(profile.name).toBe('Org A Initial');
    expect(profile.currency).toBe('INR');
    expect(profile.timezone).toBe('Asia/Kolkata');
    expect(profile.address).toBeNull();
    expect(profile.taxId).toBeNull();
    expect(profile.logoUrl).toBeNull();
  });

  it('2. persists name, address, taxId, currency and timezone', async () => {
    const updated = await orgs.updateProfile(tenantA, {
      name: 'Bright Future Academy',
      address: '42 Learning Road, Sector 9',
      taxId: 'GSTIN-29ABCDE1234F1Z5',
      currency: 'USD',
      timezone: 'America/New_York',
    });

    expect(updated.name).toBe('Bright Future Academy');
    expect(updated.address).toBe('42 Learning Road, Sector 9');
    expect(updated.taxId).toBe('GSTIN-29ABCDE1234F1Z5');
    expect(updated.currency).toBe('USD');
    expect(updated.timezone).toBe('America/New_York');
  });

  it('3. values survive a re-read (real persistence)', async () => {
    const profile = await orgs.getProfile(tenantA);

    expect(profile.name).toBe('Bright Future Academy');
    expect(profile.address).toBe('42 Learning Road, Sector 9');
    expect(profile.taxId).toBe('GSTIN-29ABCDE1234F1Z5');

    const stored = await prisma.tenant.findUnique({ where: { id: tenantA } });
    expect(stored!.address).toBe('42 Learning Road, Sector 9');
    expect(stored!.taxId).toBe('GSTIN-29ABCDE1234F1Z5');
  });

  it('4. leaves unspecified fields untouched', async () => {
    // Only currency is supplied on this update.
    const updated = await orgs.updateProfile(tenantA, {
      name: 'Bright Future Academy',
      currency: 'EUR',
    });

    expect(updated.currency).toBe('EUR');
    expect(updated.address).toBe('42 Learning Road, Sector 9');
    expect(updated.taxId).toBe('GSTIN-29ABCDE1234F1Z5');
  });

  it('5. stores values verbatim without normalization', async () => {
    const updated = await orgs.updateProfile(tenantA, {
      name: 'Org A',
      currency: 'usd',
      timezone: 'not/a-real-zone',
    });

    expect(updated.currency).toBe('usd');
    expect(updated.timezone).toBe('not/a-real-zone');

    // Restore a valid profile for later tests.
    await orgs.updateProfile(tenantA, {
      name: 'Bright Future Academy',
      address: '42 Learning Road, Sector 9',
      taxId: 'GSTIN-29ABCDE1234F1Z5',
      currency: 'USD',
      timezone: 'America/New_York',
    });
  });

  it('6. rejects an invalid profile payload', () => {
    const missingName = plainToInstance(UpdateOrganizationProfileDto, {
      address: 'no name supplied',
    });
    expect(validateSync(missingName).length).toBeGreaterThan(0);

    const emptyName = plainToInstance(UpdateOrganizationProfileDto, {
      name: '',
    });
    expect(validateSync(emptyName).length).toBeGreaterThan(0);

    const tooLong = plainToInstance(UpdateOrganizationProfileDto, {
      name: 'x'.repeat(256),
    });
    expect(validateSync(tooLong).length).toBeGreaterThan(0);

    const wrongType = plainToInstance(UpdateOrganizationProfileDto, {
      name: 'Ok',
      currency: 42 as any,
    });
    expect(validateSync(wrongType).length).toBeGreaterThan(0);

    const good = plainToInstance(UpdateOrganizationProfileDto, {
      name: 'Valid Org',
      address: 'Somewhere',
    });
    expect(validateSync(good)).toHaveLength(0);
  });

  it('7. TEST A/D: each tenant reads only its own profile', async () => {
    const a = await orgs.getProfile(tenantA);
    const b = await orgs.getProfile(tenantB);

    expect(a.id).toBe(tenantA);
    expect(b.id).toBe(tenantB);
    expect(a.name).not.toBe(b.name);
    expect(b.name).toBe('Org B Initial');
  });

  it('8. TEST B: updating tenant A leaves tenant B unchanged', async () => {
    const before = await orgs.getProfile(tenantB);

    await orgs.updateProfile(tenantA, {
      name: 'Renamed Again',
      address: 'New Address 1',
      taxId: 'NEWTAX',
    });

    const after = await orgs.getProfile(tenantB);
    expect(after).toEqual(before);
    expect(after.name).toBe('Org B Initial');
    expect(after.taxId).toBeNull();

    const storedB = await prisma.tenant.findUnique({ where: { id: tenantB } });
    expect(storedB!.name).toBe('Org B Initial');
  });

  it('9. TEST C: the JWT tenant is the only ownership input', async () => {
    const captured: string[] = [];
    const stub = {
      updateProfile: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new OrganizationsController(stub);

    // A hostile payload carries someone else's tenant id; it is not a
    // DTO property, so the global whitelist pipe rejects it, and the
    // service signature has no tenant parameter to receive it.
    await controller.updateProfile(adminOf(tenantA), {
      name: 'X',
      tenantId: tenantB,
    } as any);

    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);

    const dto = plainToInstance(UpdateOrganizationProfileDto, {
      name: 'X',
      tenantId: tenantB,
    });
    // forbidNonWhitelisted rejects the undeclared property.
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
      .toBeGreaterThan(0);
  });

  it('10. TEST E: an unauthenticated request is rejected', () => {
    const guard = new JwtAuthGuard({ verify: () => ({}) } as any, new Reflector());
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => OrganizationsController.prototype.getProfile,
      getClass: () => OrganizationsController,
    } as any;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('11. TEST F: only ROLE_ADMIN may update; reads stay open', async () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    // The update handler carries the ADMIN restriction.
    expect(Reflect.getMetadata('roles', OrganizationsController.prototype.updateProfile))
      .toEqual([UserRole.ROLE_ADMIN]);

    // The read handler carries no role restriction at all.
    expect(Reflect.getMetadata('roles', OrganizationsController.prototype.getProfile))
      .toBeUndefined();

    const ctxFor = (role: UserRole) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
            params: {},
            query: {},
            body: {},
            user: userWithRole(tenantA, role),
          }),
        }),
        getHandler: () => OrganizationsController.prototype.updateProfile,
        getClass: () => OrganizationsController,
      }) as unknown as ExecutionContext;

    for (const role of [UserRole.ROLE_COLLECTOR, UserRole.ROLE_VIEWER]) {
      expect(() => guard.canActivate(ctxFor(role) as any)).toThrow();
    }
    expect(guard.canActivate(ctxFor(UserRole.ROLE_ADMIN) as any)).toBe(true);
  });

  it('12. receipt snapshot now carries the organization profile', async () => {
    await orgs.updateProfile(tenantA, {
      name: 'Snapshot Academy',
      address: '9 Receipt Road',
      taxId: 'SNAPTAX123',
      currency: 'USD',
      timezone: 'Asia/Tokyo',
      logoUrl: 'https://cdn.example.com/logo.png',
    });

    const due = await prisma.due.findFirstOrThrow({
      where: { tenantId: tenantA, balanceRemaining: { gt: 0 } },
    });

    const paid = await payments.collectPayment(tenantA, adminA, {
      dueId: due.id,
      amountMinor: '1',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const got = await receipts.getReceipt(tenantA, paid.receipt!.id);
    const org = (got.snapshot as any).organization;

    // BR-RCP-002 organization snapshot contents.
    expect(org.name).toBe('Snapshot Academy');
    expect(org.address).toBe('9 Receipt Road');
    expect(org.taxId).toBe('SNAPTAX123');
    expect(org.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(org.currency).toBe('USD');
    expect(org.timezone).toBe('Asia/Tokyo');
    expect(org.receiptPrefix).toBeTruthy();
  });

  it('13. receipt snapshot stays frozen after a later profile change', async () => {
    const receiptsForA = await prisma.receipt.findMany({
      where: { tenantId: tenantA },
      orderBy: { issuedAt: 'asc' },
    });
    const latest = receiptsForA[receiptsForA.length - 1];

    const before = await receipts.getReceipt(tenantA, latest.id);

    await orgs.updateProfile(tenantA, {
      name: 'Renamed After Receipt',
      address: 'Changed Address',
      taxId: 'CHANGEDTAX',
    });

    const after = await receipts.getReceipt(tenantA, latest.id);
    expect(after.snapshot).toEqual(before.snapshot);
    expect((after.snapshot as any).organization.name).toBe('Snapshot Academy');
    expect((after.snapshot as any).organization.taxId).toBe('SNAPTAX123');
  });

  it('14. profile update does not create audit rows', async () => {
    // The SRS does not require org changes to be audited, so nothing is
    // written to the (still unused) AuditLog table.
    const logs = await prisma.auditLog.count({ where: { tenantId: tenantA } });
    expect(logs).toBe(0);
  });

  it('15. an update touching only nullable fields clears them correctly', async () => {
    await orgs.updateProfile(tenantA, {
      name: 'Snapshot Academy',
      address: '',
    });
    expect((await orgs.getProfile(tenantA)).address).toBe('');

    await orgs.updateProfile(tenantA, {
      name: 'Snapshot Academy',
      address: '9 Receipt Road',
    });
    expect((await orgs.getProfile(tenantA)).address).toBe('9 Receipt Road');
  });
});