import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode, UserRole } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

import { OrganizationsService } from '../src/modules/organizations/organizations.service.js';
import { OrganizationsController } from '../src/modules/organizations/organizations.controller.js';
import { UpdateReceiptConfigDto } from '../src/modules/organizations/dto/update-receipt-config.dto.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ReceiptsService } from '../src/modules/receipts/receipts.service.js';

describe('V1.17: Receipt configuration (FR-ORG-03 / BR-08)', () => {
  let prisma: PrismaClient;
  let orgs: OrganizationsService;
  let payments: PaymentsService;
  let receipts: ReceiptsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let adminB: string;
  let dueA: string;
  let dueB: string;

  let keySeq = 0;
  const nextKey = () => `cfg-key-${Date.now()}-${keySeq++}`;

  const roleOf = (tenantId: string, role: UserRole) =>
    ({ sub: 'u', tenantId, email: 'x@y.z', role }) as JwtPayload;

  /** Collects a payment and returns the newly issued receipt id/number. */
  async function issueReceipt(tenantId: string, userId: string, dueId: string) {
    const paid = await payments.collectPayment(tenantId, userId, {
      dueId,
      amountMinor: '1',
      paymentMode: PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });
    return { id: paid.receipt!.id, number: paid.receipt!.receiptNumber };
  }

  async function topUpDue(tenantId: string, userId: string, personId: string) {
    const charge = await prisma.charge.create({
      data: {
        tenantId,
        personId,
        category: 'FEE',
        baseAmount: BigInt(1000),
        discountAmount: BigInt(0),
        createdByUserId: userId,
      },
    });
    const due = await prisma.due.create({
      data: {
        tenantId,
        personId,
        chargeId: charge.id,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(1000),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(1000),
        status: DueStatus.PENDING,
      },
    });
    return due.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantA = (await prisma.tenant.create({ data: { name: 'Cfg Tenant A', category: 'School' } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: 'Cfg Tenant B', category: 'School' } })).id;

    adminA = (await prisma.user.create({
      data: { tenantId: tenantA, email: 'admin.a@cfg.test', passwordHash: 'h', fullName: 'Cfg Admin A', role: UserRole.ROLE_ADMIN },
    })).id;
    adminB = (await prisma.user.create({
      data: { tenantId: tenantB, email: 'admin.b@cfg.test', passwordHash: 'h', fullName: 'Cfg Admin B', role: UserRole.ROLE_ADMIN },
    })).id;

    const personA = (await prisma.person.create({
      data: { tenantId: tenantA, fullName: 'Cfg Person A', primaryPhone: '9800000001', advanceBalance: BigInt(0) },
    })).id;
    const personB = (await prisma.person.create({
      data: { tenantId: tenantB, fullName: 'Cfg Person B', primaryPhone: '9800000002', advanceBalance: BigInt(0) },
    })).id;

    dueA = await topUpDue(tenantA, adminA, personA);
    dueB = await topUpDue(tenantB, adminB, personB);

    orgs = new OrganizationsService(prisma as any, new CustomFieldsService(prisma as any) as any);
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
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
    }
    await prisma.due.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const t of [tenantA, tenantB]) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it('1. defaults are reported when nothing is configured', async () => {
    const cfg = await orgs.getReceiptConfig(tenantA);

    expect(cfg.receiptPrefix).toBe('REC');
    expect(cfg.receiptFooterText).toBeNull();
    expect(cfg.logoUrl).toBeNull();
    expect(cfg.sequences).toEqual([]);
  });

  it('2. Admin can update prefix, footer and logo', async () => {
    const res = await orgs.updateReceiptConfig(tenantA, {
      receiptPrefix: 'ACME',
      receiptFooterText: 'Thank you for choosing ACME',
      logoUrl: 'https://cdn.example.com/acme.png',
    });

    expect(res.receiptPrefix).toBe('ACME');
    expect(res.receiptFooterText).toBe('Thank you for choosing ACME');
    expect(res.logoUrl).toBe('https://cdn.example.com/acme.png');

    // Persisted in the real columns.
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenantA } });
    expect(settings!.receiptPrefix).toBe('ACME');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantA } });
    expect(tenant!.logoUrl).toBe('https://cdn.example.com/acme.png');
  });

  it('3. A. a newly issued receipt uses the configured prefix', async () => {
    const r = await issueReceipt(tenantA, adminA, dueA);

    expect(r.number).toMatch(/^ACME-\d{4}-\d{6}$/);

    const snapshot = await receipts.getReceipt(tenantA, r.id);
    expect((snapshot.snapshot as any).organization.receiptPrefix).toBe('ACME');
  });

  it('4. B. a newly issued receipt carries the configured footer', async () => {
    const r = await issueReceipt(tenantA, adminA, dueA);

    const snapshot = await receipts.getReceipt(tenantA, r.id);
    expect((snapshot.snapshot as any).organization.receiptFooterText).toBe(
      'Thank you for choosing ACME',
    );

    // Present wherever the receipt representation exposes it.
    const html = await receipts.renderReceiptHtml(tenantA, r.id);
    expect(html).toContain('Thank you for choosing ACME');

    const pdf = await receipts.renderReceiptPdf(tenantA, r.id);
    expect(pdf.toString('latin1')).toContain('Thank you for choosing ACME');
  });

  it('5. C. numbering follows the existing ReceiptSequence mechanism', async () => {
    const first = await issueReceipt(tenantA, adminA, dueA);
    const second = await issueReceipt(tenantA, adminA, dueA);

    const seqOf = (n: string) => Number(n.split('-')[2]);
    expect(seqOf(second.number)).toBe(seqOf(first.number) + 1);

    // The counter is the pre-existing per-tenant, per-fiscal-year row.
    const cfg = await orgs.getReceiptConfig(tenantA);
    const fy = String(new Date().getUTCFullYear());
    const row = cfg.sequences.find((s) => s.fiscalYear === fy)!;
    expect(row).toBeDefined();
    expect(row.currentSequence).toBe(seqOf(second.number));

    const stored = await prisma.receiptSequence.findUnique({
      where: { tenantId_fiscalYear: { tenantId: tenantA, fiscalYear: fy } },
    });
    expect(stored!.currentSequence).toBe(seqOf(second.number));
  });

  it('6. D. changing configuration never rewrites an issued receipt', async () => {
    const old = await issueReceipt(tenantA, adminA, dueA);
    const before = await receipts.getReceipt(tenantA, old.id);
    const htmlBefore = await receipts.renderReceiptHtml(tenantA, old.id);

    await orgs.updateReceiptConfig(tenantA, {
      receiptPrefix: 'NEWCO',
      receiptFooterText: 'New footer text',
    });

    const after = await receipts.getReceipt(tenantA, old.id);
    expect(after.receiptNumber).toBe(old.number);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(await receipts.renderReceiptHtml(tenantA, old.id)).toBe(htmlBefore);
    expect((after.snapshot as any).organization.receiptPrefix).toBe('ACME');

    // Only subsequently issued receipts use the new configuration.
    const fresh = await issueReceipt(tenantA, adminA, dueA);
    expect(fresh.number).toMatch(/^NEWCO-/);
  });

  it('7. numbering continues (never restarts) after a config change', async () => {
    const beforeCfg = await orgs.getReceiptConfig(tenantA);
    const beforeSeq = beforeCfg.sequences[0].currentSequence;

    await orgs.updateReceiptConfig(tenantA, { receiptPrefix: 'AGAIN' });
    const fresh = await issueReceipt(tenantA, adminA, dueA);

    expect(Number(fresh.number.split('-')[2])).toBe(beforeSeq + 1);
  });

  it('8. partial update leaves unspecified fields untouched', async () => {
    await orgs.updateReceiptConfig(tenantA, { receiptFooterText: 'Keep me' });
    const cfg = await orgs.getReceiptConfig(tenantA);

    expect(cfg.receiptFooterText).toBe('Keep me');
    expect(cfg.receiptPrefix).toBe('AGAIN');
  });

  it('9. a tenant that never configured anything uses universal defaults', async () => {
    const cfg = await orgs.getReceiptConfig(tenantB);
    expect(cfg.receiptPrefix).toBe('REC');

    const r = await issueReceipt(tenantB, adminB, dueB);
    expect(r.number).toMatch(/^REC-\d{4}-\d{6}$/);
  });

  it('10. TEST isolation: tenant A config never affects tenant B', async () => {
    await orgs.updateReceiptConfig(tenantB, {
      receiptPrefix: 'BORG',
      receiptFooterText: 'Tenant B footer',
      logoUrl: 'https://cdn.example.com/b.png',
    });

    const a = await orgs.getReceiptConfig(tenantA);
    const b = await orgs.getReceiptConfig(tenantB);

    expect(b.receiptPrefix).toBe('BORG');
    expect(a.receiptPrefix).toBe('AGAIN');
    expect(a.logoUrl).toBe('https://cdn.example.com/acme.png');
    expect(b.logoUrl).toBe('https://cdn.example.com/b.png');

    // Numbering is per tenant: B continues its own counter, which is
    // independent of whatever A's counter happens to be at.
    const bSeqBefore = (await orgs.getReceiptConfig(tenantB)).sequences[0].currentSequence;
    const rB = await issueReceipt(tenantB, adminB, dueB);
    expect(rB.number).toMatch(/^BORG-\d{4}-\d{6}$/);
    expect(Number(rB.number.split('-')[2])).toBe(bSeqBefore + 1);

    // A's counter is unaffected by B's issuance.
    const aSeq = (await orgs.getReceiptConfig(tenantA)).sequences[0].currentSequence;
    expect(aSeq).toBe(Number((await prisma.receiptSequence.findUnique({
      where: { tenantId_fiscalYear: { tenantId: tenantA, fiscalYear: String(new Date().getUTCFullYear()) } },
    }))!.currentSequence));
  });

  it('11. sequence rows are tenant-scoped', async () => {
    const rows = await prisma.receiptSequence.findMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    const tenants = new Set(rows.map((r) => r.tenantId));
    expect(tenants).toEqual(new Set([tenantA, tenantB]));
  });

  it('12. validation rejects empty, over-long and unknown fields', () => {
    const empty = plainToInstance(UpdateReceiptConfigDto, { receiptPrefix: '' });
    expect(validateSync(empty).length).toBeGreaterThan(0);

    const tooLong = plainToInstance(UpdateReceiptConfigDto, { receiptPrefix: 'x'.repeat(21) });
    expect(validateSync(tooLong).length).toBeGreaterThan(0);

    const longFooter = plainToInstance(UpdateReceiptConfigDto, {
      receiptFooterText: 'f'.repeat(5000),
    });
    // Text column: no length rule is imposed by the SRS.
    expect(validateSync(longFooter)).toHaveLength(0);

    const good = plainToInstance(UpdateReceiptConfigDto, {
      receiptPrefix: 'INV',
      receiptFooterText: 'Thanks',
      logoUrl: 'https://x/y.png',
    });
    expect(validateSync(good)).toHaveLength(0);
  });

  it('13. a client tenantId is rejected and cannot redirect the write', async () => {
    const captured: string[] = [];
    const stub = {
      updateReceiptConfig: (tenantId: string) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new OrganizationsController(stub);
    await controller.updateReceiptConfig(roleOf(tenantA, UserRole.ROLE_ADMIN), {
      receiptPrefix: 'X',
      tenantId: tenantB,
    } as any);

    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);

    const dto = plainToInstance(UpdateReceiptConfigDto, {
      receiptPrefix: 'X',
      tenantId: tenantB,
    });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
      .toBeGreaterThan(0);

    // Tenant B data really is untouched by the attempt.
    expect((await orgs.getReceiptConfig(tenantB)).receiptPrefix).toBe('BORG');
  });

  it('14. unauthenticated request is rejected', () => {
    const guard = new JwtAuthGuard({ verify: () => ({}) } as any, new Reflector());
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => OrganizationsController.prototype.getReceiptConfig,
      getClass: () => OrganizationsController,
    } as any;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('15. only ROLE_ADMIN may write; reads stay open to all roles', () => {
    const guard = new RolesGuard(new Reflector());

    expect(Reflect.getMetadata('roles', OrganizationsController.prototype.updateReceiptConfig))
      .toEqual([UserRole.ROLE_ADMIN]);
    expect(Reflect.getMetadata('roles', OrganizationsController.prototype.getReceiptConfig))
      .toBeUndefined();

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
        getHandler: () => OrganizationsController.prototype.updateReceiptConfig,
        getClass: () => OrganizationsController,
      }) as unknown as ExecutionContext;

    for (const role of [UserRole.ROLE_COLLECTOR, UserRole.ROLE_VIEWER]) {
      expect(() => guard.canActivate(ctxFor(role) as any)).toThrow();
    }
    expect(guard.canActivate(ctxFor(UserRole.ROLE_ADMIN) as any)).toBe(true);
  });

  it('16. no second numbering mechanism or model was introduced', async () => {
    // The sequence is still exactly one row per tenant per fiscal year.
    const fy = String(new Date().getUTCFullYear());
    const rows = await prisma.receiptSequence.findMany({
      where: { tenantId: tenantA, fiscalYear: fy },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].currentSequence).toBeGreaterThan(0);

    // The config endpoint exposes the counter read-only: no DTO field
    // exists that could write a sequence value.
    const dto = plainToInstance(UpdateReceiptConfigDto, {
      currentSequence: 5000,
    });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
      .toBeGreaterThan(0);
  });
});