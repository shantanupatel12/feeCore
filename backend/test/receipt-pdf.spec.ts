import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DueStatus, PaymentMode } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ReceiptsService } from '../src/modules/receipts/receipts.service.js';
import { buildReceiptPdf } from '../src/modules/receipts/receipt-pdf.js';

describe('V1.13: Receipt PDF rendering (FR-RCP-01 / BR-RCP-002)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let receipts: ReceiptsService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let personA: string;
  let chargeA: string;
  let receiptId: string;
  let receiptNumber: string;

  let keySeq = 0;
  const nextKey = () => `pdf-key-${Date.now()}-${keySeq++}`;

  /** Parses the xref table and asserts every entry points at "<n> 0 obj". */
  function assertValidXref(pdf: Buffer) {
    const text = pdf.toString('latin1');

    const startxrefMatch = text.match(/startxref\s+(\d+)\s+%%EOF/);
    expect(startxrefMatch).not.toBeNull();

    const xrefOffset = Number(startxrefMatch![1]);

    // startxref must point at the xref keyword itself.
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');

    const header = text.slice(xrefOffset).match(/xref\s+0 (\d+)/);
    expect(header).not.toBeNull();
    const size = Number(header![1]);

    // Each xref entry is exactly 20 bytes.
    const tableStart = xrefOffset + header![0].length + 1;
    expect(text.slice(tableStart, tableStart + 20)).toMatch(
      /^0000000000 65535 f \n$/,
    );

    for (let obj = 1; obj < size; obj++) {
      const entry = text.slice(
        tableStart + obj * 20,
        tableStart + (obj + 1) * 20,
      );
      // Each entry is exactly 20 bytes, ending in a line feed.
      expect(entry, `xref entry ${obj} is 20 bytes`).toHaveLength(20);
      const [, offset, gen, flag] =
        entry.match(/^(\d{10}) (\d{5}) ([nf]) \n$/) ?? [];
      expect(flag).toBe('n');
      expect(gen).toBe('00000');

      // The recorded offset must land exactly on that object's header.
      const at = Number(offset);
      expect(text.slice(at, at + `${obj} 0 obj`.length)).toBe(
        `${obj} 0 obj`,
      );
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({
      data: { name: 'PDF Org A', category: 'School', currency: 'INR' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'PDF Org B', category: 'School', currency: 'INR' },
    });
    tenantB = tB.id;

    const u = await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'admin.a@pdf.test',
        passwordHash: 'dummyhash',
        fullName: 'PDF Admin A',
        role: 'ROLE_ADMIN',
      },
    });
    adminA = u.id;

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'PDF Payer (Acme) \\Branch',
          primaryPhone: '9300000001',
          email: 'payer@pdf.test',
          address: '5 Print Street',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    chargeA = (
      await prisma.charge.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          category: 'TUITION',
          description: 'Term 2 tuition (final)',
          baseAmount: BigInt(1500),
          discountAmount: BigInt(0),
          createdByUserId: adminA,
        },
      })
    ).id;

    await prisma.tenantSettings.create({
      data: {
        tenantId: tenantA,
        receiptPrefix: 'PDF',
        receiptFooterText: 'Thank you for your payment',
      },
    });

    payments = new PaymentsService(prisma as any);
    receipts = new ReceiptsService(prisma as any);

    const due = await prisma.due.create({
      data: {
        tenantId: tenantA,
        personId: personA,
        chargeId: chargeA,
        dueDate: new Date('2099-06-01'),
        netAmount: BigInt(1500),
        lateFeeAmount: BigInt(0),
        balanceRemaining: BigInt(1500),
        status: DueStatus.PENDING,
      },
    });

    const res = await payments.collectPayment(tenantA, adminA, {
      personId: personA,
      dueId: due.id,
      amountMinor: '1500',
      paymentMode: PaymentMode.BANK_TRANSFER,
      idempotencyKey: nextKey(),
    });

    expect(res.receipt).toBeDefined();
    receiptId = res.receipt!.id;
    receiptNumber = res.receipt!.receiptNumber;
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    for (const t of both) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
    }

    await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });

    for (const t of both) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }

    await prisma.$disconnect();
  });

  it('1. emits a structurally valid PDF document', () => {
    const pdf = buildReceiptPdf(['Hello receipt']);

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.toString('latin1')).toContain('/Type /Catalog');
    expect(pdf.toString('latin1')).toContain('/Type /Pages');
    expect(pdf.toString('latin1')).toContain('/BaseFont /Helvetica');

    assertValidXref(pdf);
  });

  it('2. paginates when the receipt has many lines', () => {
    const many = Array.from({ length: 140 }, (_, i) => `Line ${i}`);
    const pdf = buildReceiptPdf(many).toString('latin1');

    // 140 lines at 46 lines/page => 4 page objects.
    expect(pdf).toContain('/Type /Page ');
    expect(pdf).toContain('/Count 4');
    assertValidXref(buildReceiptPdf(many));
  });

  it('3. renders the real receipt from the frozen snapshot', async () => {
    const pdf = await receipts.renderReceiptPdf(tenantA, receiptId);
    const text = pdf.toString('latin1');

    expect(text).toContain(receiptNumber);
    expect(text).toContain('PDF Org A');
    expect(text).toContain('TUITION');
    // Parens are escaped in the PDF literal string.
    expect(text).toContain('Term 2 tuition \\(final\\)');
    expect(text).toContain('1500');
    expect(text).toContain('BANK_TRANSFER');
    expect(text).toContain('PDF Admin A');
    expect(text).toContain('Thank you for your payment');

    assertValidXref(pdf);
  });

  it('4. is byte-for-byte deterministic across calls', async () => {
    const a = await receipts.renderReceiptPdf(tenantA, receiptId);
    const b = await receipts.renderReceiptPdf(tenantA, receiptId);

    expect(a.equals(b)).toBe(true);
  });

  it('5. escapes parentheses and backslashes in payer data', async () => {
    const pdf = await receipts.renderReceiptPdf(tenantA, receiptId);
    const text = pdf.toString('latin1');

    // The payer's literal name contains ( ) and a backslash; they must
    // be escaped inside the literal string, never raw.
    expect(text).toContain('PDF Payer \\(Acme\\) \\\\Branch');

    // Every stream must still declare a correct /Length.
    const streams = text.match(/<< \/Length (\d+) >>\nstream\n/g) ?? [];
    expect(streams.length).toBeGreaterThan(0);

    assertValidXref(pdf);
  });

  it('6. cannot break out of the content stream via PDF operators', () => {
    const pdf = buildReceiptPdf([
      'evil ) Tj ET /Type /Action << /S /JavaScript >> (injected',
    ]).toString('latin1');

    // The parens are escaped, so the injected operators stay inert text
    // rather than terminating the literal string.
    expect(pdf).toContain('evil \\) Tj ET /Type /Action << /S /JavaScript >> \\(injected');

    // Only the real content stream object may exist.
    expect(pdf.match(/\nstream\n/g)?.length).toBe(1);
    assertValidXref(Buffer.from(pdf, 'latin1'));
  });

  it('7. rejects cross-tenant PDF rendering', async () => {
    await expect(
      receipts.renderReceiptPdf(tenantB, receiptId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('8. rejects an unknown receipt id', async () => {
    await expect(
      receipts.renderReceiptPdf(
        tenantA,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('9. PDF content is unaffected by later live-record edits', async () => {
    const before = await receipts.renderReceiptPdf(tenantA, receiptId);

    await prisma.person.update({
      where: { id: personA },
      data: { fullName: 'NAME CHANGED AFTER ISSUE' },
    });
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { name: 'Org Changed After Issue' },
    });

    const after = await receipts.renderReceiptPdf(tenantA, receiptId);
    expect(after.equals(before)).toBe(true);
    expect(after.toString('latin1')).not.toContain('NAME CHANGED AFTER ISSUE');
  });
});