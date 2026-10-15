import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, UserRole } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

import { TerminologyService } from '../src/modules/organizations/terminology.service.js';
import { TerminologyController } from '../src/modules/organizations/terminology.controller.js';
import { UpdateTerminologyDto } from '../src/modules/organizations/dto/update-terminology.dto.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ReceiptsService } from '../src/modules/receipts/receipts.service.js';

describe('V1.16: Terminology configuration (FR-ORG-02 / BR-01)', () => {
  let prisma: PrismaClient;
  let terminology: TerminologyService;
  let payments: PaymentsService;
  let receipts: ReceiptsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;

  let keySeq = 0;
  const nextKey = () => `term-key-${Date.now()}-${keySeq++}`;

  const adminOf = (tenantId: string) =>
    ({ sub: adminA, tenantId, email: 'admin.a@term.test', role: UserRole.ROLE_ADMIN }) as JwtPayload;

  const roleOf = (tenantId: string, role: UserRole) =>
    ({ sub: 'u', tenantId, email: 'x@y.z', role }) as JwtPayload;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantA = (await prisma.tenant.create({ data: { name: 'Term Tenant A', category: 'School' } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: 'Term Tenant B', category: 'School' } })).id;

    const admin = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@term.test',
        passwordHash: 'h',
        fullName: 'Term Admin A',
        role: UserRole.ROLE_ADMIN,
      },
    });
    adminA = admin.id;

    personA = (await prisma.person.create({
      data: { tenantId: tenantA, fullName: 'Term Person A', primaryPhone: '9700000001', advanceBalance: BigInt(0) },
    })).id;

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

    terminology = new TerminologyService(prisma as any);
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
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
    }
    await prisma.due.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const t of [tenantA, tenantB]) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. a tenant with no settings row gets the Prisma defaults', async () => {
    const t = await terminology.getTerminology(tenantA);

    expect(t.personLabelSingular).toBe('Person');
    expect(t.personLabelPlural).toBe('People');
    expect(t.chargeLabelSingular).toBe('Charge');
    expect(t.chargeLabelPlural).toBe('Charges');

    // Reading materialises the row, so later reads are stable.
    const again = await terminology.getTerminology(tenantA);
    expect(again.personLabelSingular).toBe('Person');
  });

  it('2. all four labels persist with correct singular/plural mapping', async () => {
    const updated = await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'Patient',
      personLabelPlural: 'Patients',
      chargeLabelSingular: 'Consultation',
      chargeLabelPlural: 'Consultations',
    });

    expect(updated.personLabelSingular).toBe('Patient');
    expect(updated.personLabelPlural).toBe('Patients');
    expect(updated.chargeLabelSingular).toBe('Consultation');
    expect(updated.chargeLabelPlural).toBe('Consultations');

    // Verify against the raw row so the column mapping is proven.
    const row = await prisma.tenantSettings.findUnique({ where: { tenantId: tenantA } });
    expect(row!.personLabelSingular).toBe('Patient');
    expect(row!.personLabelPlural).toBe('Patients');
    expect(row!.chargeLabelSingular).toBe('Consultation');
    expect(row!.chargeLabelPlural).toBe('Consultations');
  });

  it('3. values survive a re-read and a second update', async () => {
    const reread = await terminology.getTerminology(tenantA);
    expect(reread.personLabelSingular).toBe('Patient');
    expect(reread.chargeLabelPlural).toBe('Consultations');

    await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'Client',
      personLabelPlural: 'Clients',
    });
    const after = await terminology.getTerminology(tenantA);

    // An unrelated partial update must not blank the charge labels.
    expect(after.personLabelSingular).toBe('Client');
    expect(after.personLabelPlural).toBe('Clients');
    expect(after.chargeLabelSingular).toBe('Consultation');
    expect(after.chargeLabelPlural).toBe('Consultations');
  });

  it('4. singular and plural never cross-map', async () => {
    await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'OnlySingular',
      chargeLabelPlural: 'OnlyPlural',
    });
    const t = await terminology.getTerminology(tenantA);

    expect(t.personLabelSingular).toBe('OnlySingular');
    expect(t.personLabelPlural).toBe('Clients');
    expect(t.chargeLabelSingular).toBe('Consultation');
    expect(t.chargeLabelPlural).toBe('OnlyPlural');
  });

  it('5. validation rejects empty, over-long and wrong-typed labels', () => {
    const empty = plainToInstance(UpdateTerminologyDto, { personLabelSingular: '' });
    expect(validateSync(empty).length).toBeGreaterThan(0);

    const tooLong = plainToInstance(UpdateTerminologyDto, { chargeLabelPlural: 'x'.repeat(101) });
    expect(validateSync(tooLong).length).toBeGreaterThan(0);

    const wrongType = plainToInstance(UpdateTerminologyDto, { personLabelPlural: 7 as any });
    expect(validateSync(wrongType).length).toBeGreaterThan(0);

    const good = plainToInstance(UpdateTerminologyDto, {
      personLabelSingular: 'Patient',
      personLabelPlural: 'Patients',
      chargeLabelSingular: 'Consultation',
      chargeLabelPlural: 'Consultations',
    });
    expect(validateSync(good)).toHaveLength(0);

    // An empty body is valid: it leaves every default in place.
    const emptyBody = plainToInstance(UpdateTerminologyDto, {});
    expect(validateSync(emptyBody)).toHaveLength(0);
  });

  it('6. an empty update leaves defaults intact', async () => {
    const tB = await terminology.getTerminology(tenantB);
    const res = await terminology.updateTerminology(tenantB, {});

    expect(res.personLabelSingular).toBe(tB.personLabelSingular);
    expect(res.chargeLabelPlural).toBe(tB.chargeLabelPlural);
  });

  it('7. TEST A/C: tenant A updates only its own settings', async () => {
    await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'TenantA Person',
    });

    const a = await terminology.getTerminology(tenantA);
    const b = await terminology.getTerminology(tenantB);

    expect(a.personLabelSingular).toBe('TenantA Person');
    expect(b.personLabelSingular).toBe('Person');
    expect(b.personLabelPlural).toBe('People');

    // Scoped to this suite's tenants: spec files share one database.
    const rows = await prisma.tenantSettings.findMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(
      new Set([tenantA, tenantB]),
    );
  });

  it('8. TEST D: a client tenantId cannot redirect the write', async () => {
    const captured: string[] = [];
    const stub = {
      updateTerminology: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new TerminologyController(stub);
    await controller.updateTerminology(adminOf(tenantA), {
      personLabelSingular: 'X',
      tenantId: tenantB,
    } as any);

    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);

    // And the whitelist pipe rejects the undeclared property outright.
    const dto = plainToInstance(UpdateTerminologyDto, {
      personLabelSingular: 'X',
      tenantId: tenantB,
    });
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length,
    ).toBeGreaterThan(0);

    // Tenant B data is genuinely untouched.
    expect((await terminology.getTerminology(tenantB)).personLabelSingular)
      .toBe('Person');
  });

  it('9. TEST E: unauthenticated access is rejected', () => {
    const guard = new JwtAuthGuard({ verify: () => ({}) } as any, new Reflector());
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => TerminologyController.prototype.getTerminology,
      getClass: () => TerminologyController,
    } as any;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('10. TEST F: only ROLE_ADMIN may write; reads stay open to all roles', () => {
    const guard = new RolesGuard(new Reflector());

    expect(
      Reflect.getMetadata('roles', TerminologyController.prototype.updateTerminology),
    ).toEqual([UserRole.ROLE_ADMIN]);
    expect(
      Reflect.getMetadata('roles', TerminologyController.prototype.getTerminology),
    ).toBeUndefined();

    const ctxFor = (role: UserRole) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
            params: {},
            query: {},
            body: {},
            user: roleOf(tenantA, role),
          }),
        }),
        getHandler: () => TerminologyController.prototype.updateTerminology,
        getClass: () => TerminologyController,
      }) as unknown as ExecutionContext;

    for (const role of [UserRole.ROLE_COLLECTOR, UserRole.ROLE_VIEWER]) {
      expect(() => guard.canActivate(ctxFor(role) as any)).toThrow();
    }
    expect(guard.canActivate(ctxFor(UserRole.ROLE_ADMIN) as any)).toBe(true);
  });

  it('11. BR-01: receipt snapshot freezes the configured labels', async () => {
    await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'Patient',
      personLabelPlural: 'Patients',
      chargeLabelSingular: 'Consultation',
      chargeLabelPlural: 'Consultations',
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
    const terms = (got.snapshot as any).organization.terminology;

    expect(terms.personLabelSingular).toBe('Patient');
    expect(terms.personLabelPlural).toBe('Patients');
    expect(terms.chargeLabelSingular).toBe('Consultation');
    expect(terms.chargeLabelPlural).toBe('Consultations');
  });

  it('12. BR-01: receipt line-items render the configured labels', async () => {
    const due = await prisma.due.findFirstOrThrow({
      where: { tenantId: tenantA, balanceRemaining: { gt: 0 } },
    });
    const paid = await payments.collectPayment(tenantA, adminA, {
      dueId: due.id,
      amountMinor: '1',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const html = await receipts.renderReceiptHtml(tenantA, paid.receipt!.id);

    // The line-item table header and the payer row use the tenant's words.
    expect(html).toContain('<th>Consultations</th>');
    expect(html).toContain('<th>Patient</th>');
    expect(html).not.toContain('<th>Charges</th>');
  });

  it('13. BR-01: a later terminology change cannot relabel an issued receipt', async () => {
    const receiptsA = await prisma.receipt.findMany({
      where: { tenantId: tenantA },
      orderBy: { issuedAt: 'asc' },
    });
    const latest = receiptsA[receiptsA.length - 1];

    const before = await receipts.getReceipt(tenantA, latest.id);
    const htmlBefore = await receipts.renderReceiptHtml(tenantA, latest.id);

    await terminology.updateTerminology(tenantA, {
      personLabelSingular: 'Renamed Person',
      personLabelPlural: 'Renamed People',
      chargeLabelSingular: 'Renamed Charge',
      chargeLabelPlural: 'Renamed Charges',
    });

    const after = await receipts.getReceipt(tenantA, latest.id);
    const htmlAfter = await receipts.renderReceiptHtml(tenantA, latest.id);

    expect(after.snapshot).toEqual(before.snapshot);
    expect(htmlAfter).toBe(htmlBefore);
    expect(htmlAfter).toContain('<th>Consultations</th>');
    expect(htmlAfter).not.toContain('Renamed Charges');
  });

  it('14. an unconfigured tenant keeps the universal receipt labels', async () => {
    const adminB = await prisma.user.create({
      data: {
        tenantId: tenantB,
        email: 'admin.b@term.test',
        passwordHash: 'h',
        fullName: 'Term Admin B',
        role: UserRole.ROLE_ADMIN,
      },
    });
    const personB = (
      await prisma.person.create({
        data: { tenantId: tenantB, fullName: 'Term Person B', primaryPhone: '9700000009', advanceBalance: BigInt(0) },
      })
    ).id;
    const chargeB = await prisma.charge.create({
      data: {
        tenantId: tenantB,
        personId: personB,
        category: 'FEE',
        baseAmount: BigInt(100),
        discountAmount: BigInt(0),
        createdByUserId: adminB.id,
      },
    });
    const dueB = await prisma.due.create({
      data: {
        tenantId: tenantB,
        personId: personB,
        chargeId: chargeB.id,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(100),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(100),
        status: DueStatus.PENDING,
      },
    });

    // Tenant B never configured terminology.
    expect((await terminology.getTerminology(tenantB)).chargeLabelPlural).toBe('Charges');

    const paid = await payments.collectPayment(tenantB, adminB.id, {
      dueId: dueB.id,
      amountMinor: '100',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });

    const html = await receipts.renderReceiptHtml(tenantB, paid.receipt!.id);

    // Universal defaults, and none of tenant A's custom words.
    expect(html).toContain('<th>Charges</th>');
    expect(html).toContain('<th>Person</th>');
    expect(html).not.toContain('<th>Consultations</th>');
  });
});
