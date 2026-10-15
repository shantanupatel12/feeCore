import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { buildReceiptPdf } from './receipt-pdf.js';

/**
 * Immutable snapshot version tag. Historical receipts always render
 * from the snapshot they were issued with, so this tag pins the
 * contract the frozen data was written against.
 */
export const RECEIPT_TEMPLATE_VERSION = 'v1.0';

const ZERO = BigInt(0);

const DEFAULT_PREFIX = 'REC';

function padSequence(seq: number): string {
  return String(seq).padStart(6, '0');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type AllocationInput = {
  dueId: string;
  allocatedPrincipal: bigint;
  allocatedLateFee: bigint;
  totalAllocated: bigint;
};

/**
 * Receipts (FR-RCP-01 / BR-RCP-001 / BR-RCP-002).
 *
 * A receipt is a legal document, so it is:
 *  - numbered from a tenant-scoped sequence incremented *inside the
 *    payment transaction*, so a rolled-back payment never burns a number;
 *  - frozen into a JSONB snapshot, so later edits to the payer or the
 *    tenant profile can never alter an already-issued receipt.
 */
@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocates the next gapless receipt number for the payment's fiscal
   * year. Must be called inside the payment transaction.
   */
  private async allocateNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fiscalYear: string,
  ): Promise<number> {
    const key = { tenantId_fiscalYear: { tenantId, fiscalYear } };

    /*
     * The increment and the read happen in the same transaction, so a
     * concurrent collector either blocks on the row lock or lands on a
     * later value. Under PostgreSQL READ COMMITTED this cannot hand two
     * payments the same number.
     */
    try {
      await tx.receiptSequence.upsert({
        where: key,
        create: { tenantId, fiscalYear, currentSequence: 1 },
        update: { currentSequence: { increment: 1 } },
      });
    } catch {
      // Lost the race to create the fiscal-year row: fall back to a
      // plain increment, which now matches an existing row.
      await tx.receiptSequence.update({
        where: key,
        data: { currentSequence: { increment: 1 } },
      });
    }

    const row = await tx.receiptSequence.findUnique({ where: key });
    if (!row) {
      throw new Error(
        `Receipt sequence for tenant ${tenantId} FY ${fiscalYear} could not be read.`,
      );
    }

    return row.currentSequence;
  }

  /**
   * Issues the receipt for a confirmed payment. MUST run inside the
   * same transaction that writes the payment and its allocations.
   */
  async issueReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payment: {
      id: string;
      personId: string;
      collectorUserId: string;
      paymentMode: string;
      totalAmount: bigint;
      allocatedToDues: bigint;
      creditedToAdvance: bigint;
      referenceNumber: string | null;
      paymentDate: Date;
    },
    allocations: AllocationInput[],
  ) {
    const settings = await tx.tenantSettings.findUnique({
      where: { tenantId },
    });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const person = await tx.person.findUnique({
      where: { id: payment.personId },
    });
    const collector = await tx.user.findUnique({
      where: { id: payment.collectorUserId },
    });

    const prefix = settings?.receiptPrefix || DEFAULT_PREFIX;
    const fiscalYear = String(payment.paymentDate.getUTCFullYear());
    const sequence = await this.allocateNumber(
      tx,
      tenantId,
      fiscalYear,
    );
    const receiptNumber = `${prefix}-${fiscalYear}-${padSequence(sequence)}`;

    // Itemised coverage: allocation -> due -> charge category/description.
    const dueIds = allocations.map((a) => a.dueId);
    const dues = await tx.due.findMany({ where: { id: { in: dueIds } } });
    const chargeIds = dues.map((d) => d.chargeId);
    const charges = await tx.charge.findMany({
      where: { id: { in: chargeIds } },
    });

    const dueById = new Map(dues.map((d) => [d.id, d]));
    const chargeById = new Map(charges.map((c) => [c.id, c]));

    const allocationSnapshot = allocations.map((a) => {
      const due = dueById.get(a.dueId);
      const charge = due ? chargeById.get(due.chargeId) : undefined;

      return {
        dueId: a.dueId,
        dueDate: due ? due.dueDate.toISOString().slice(0, 10) : null,
        chargeId: due ? due.chargeId : null,
        category: charge ? charge.category : null,
        description: charge ? charge.description : null,
        allocatedPrincipalMinor: a.allocatedPrincipal.toString(),
        allocatedLateFeeMinor: a.allocatedLateFee.toString(),
        totalAllocatedMinor: a.totalAllocated.toString(),
      };
    });

    const totalPrincipal = allocations.reduce(
      (sum, a) => sum + a.allocatedPrincipal,
      ZERO,
    );
    const totalLateFee = allocations.reduce(
      (sum, a) => sum + a.allocatedLateFee,
      ZERO,
    );

    /*
     * Frozen at issuance. Nothing in here is ever refreshed: a later
     * rename, address change or tenant profile edit must not rewrite
     * this JSONB.
     */
    const snapshotData = {
      templateVersion: RECEIPT_TEMPLATE_VERSION,
      receiptNumber,
      organization: {
        name: tenant?.name ?? null,
        category: tenant?.category ?? null,
        // FR-ORG-01 profile fields required by BR-RCP-002.
        address: tenant?.address ?? null,
        taxId: tenant?.taxId ?? null,
        logoUrl: tenant?.logoUrl ?? null,
        currency: tenant?.currency ?? null,
        timezone: tenant?.timezone ?? null,
        receiptPrefix: prefix,
        receiptFooterText: settings?.receiptFooterText ?? null,
        /*
         * FR-ORG-02 / BR-01: the labels in force when the payment was
         * confirmed are frozen here, so a later terminology change can
         * never relabel an already-issued receipt.
         */
        terminology: {
          personLabelSingular:
            settings?.personLabelSingular ?? 'Person',
          personLabelPlural: settings?.personLabelPlural ?? 'People',
          chargeLabelSingular:
            settings?.chargeLabelSingular ?? 'Charge',
          chargeLabelPlural: settings?.chargeLabelPlural ?? 'Charges',
        },
      },
      payer: {
        personId: person?.id ?? payment.personId,
        fullName: person?.fullName ?? null,
        primaryPhone: person?.primaryPhone ?? null,
        secondaryPhone: person?.secondaryPhone ?? null,
        email: person?.email ?? null,
        address: person?.address ?? null,
        customData: (person?.customData as Record<string, unknown>) ?? {},
      },
      payment: {
        paymentId: payment.id,
        totalAmountMinor: payment.totalAmount.toString(),
        allocatedToDuesMinor: payment.allocatedToDues.toString(),
        creditedToAdvanceMinor: payment.creditedToAdvance.toString(),
        paymentMode: payment.paymentMode,
        referenceNumber: payment.referenceNumber,
        collectorUserId: payment.collectorUserId,
        collectorName: collector?.fullName ?? null,
        paymentDate: payment.paymentDate.toISOString(),
      },
      allocations: allocationSnapshot,
      totals: {
        allocatedPrincipalMinor: totalPrincipal.toString(),
        allocatedLateFeeMinor: totalLateFee.toString(),
        creditedToAdvanceMinor: payment.creditedToAdvance.toString(),
        grandTotalMinor: payment.totalAmount.toString(),
      },
    };

    return tx.receipt.create({
      data: {
        tenantId,
        paymentId: payment.id,
        receiptNumber,
        snapshotData: snapshotData as Prisma.InputJsonValue,
      },
    });
  }

  /** Tenant-scoped read. Cross-tenant ids are indistinguishable from missing ids. */
  private async findReceipt(tenantId: string, receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, tenantId },
    });

    if (!receipt) {
      throw new NotFoundException(
        `Receipt '${receiptId}' not found in this tenant.`,
      );
    }

    return receipt;
  }

  private serialize(receipt: {
    id: string;
    receiptNumber: string;
    paymentId: string;
    issuedAt: Date;
    snapshotData: unknown;
  }) {
    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      paymentId: receipt.paymentId,
      issuedAt: receipt.issuedAt.toISOString(),
      snapshot: receipt.snapshotData,
    };
  }

  async getReceipt(tenantId: string, receiptId: string) {
    return this.serialize(await this.findReceipt(tenantId, receiptId));
  }

  /**
   * Every successful payment yields exactly one receipt, so this is a
   * 1:1 lookup rather than a collection. Scoped by tenantId for the
   * same reason as getReceipt: a payment id from another tenant must
   * be indistinguishable from one that never existed.
   */
  async getReceiptByPayment(tenantId: string, paymentId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { paymentId, tenantId },
    });

    if (!receipt) {
      throw new NotFoundException(
        `No receipt found for payment '${paymentId}' in this tenant.`,
      );
    }

    return this.serialize(receipt);
  }

  /**
   * Tenant-scoped listing. The tenantId filter is mandatory on every
   * query so a paginated listing can never page through another
   * tenant's receipts.
   */
  async listReceipts(
    tenantId: string,
    query?: { personId?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query?.personId) {
      // personId lives on Payment, not Receipt, so constrain via the
      // relation rather than trusting a client-supplied receipt field.
      where.payment = { personId: query.personId };
    }

    const [rows, total] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.receipt.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.serialize(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Deterministic rendering for reprint. Reads exclusively from the
   * frozen snapshot; never joins live entity tables.
   */
  async renderReceiptHtml(tenantId: string, receiptId: string): Promise<string> {
    const receipt = await this.findReceipt(tenantId, receiptId);
    const s = receipt.snapshotData as Record<string, any>;

    const org = s.organization ?? {};
    const payer = s.payer ?? {};
    const pay = s.payment ?? {};
    // BR-01: line-items render the labels frozen at payment time.
    const terms = org.terminology ?? {};
    const rows: string[] = (s.allocations ?? [])
      .map(
        (a: Record<string, any>) => `
        <tr>
          <td>${escapeHtml(a.category ?? '-')}</td>
          <td>${escapeHtml(a.description ?? '-')}</td>
          <td>${escapeHtml(a.dueDate ?? '-')}</td>
          <td class="num">${escapeHtml(a.allocatedPrincipalMinor)}</td>
          <td class="num">${escapeHtml(a.allocatedLateFeeMinor)}</td>
          <td class="num">${escapeHtml(a.totalAllocatedMinor)}</td>
        </tr>`,
      )
      .join('');

    const advance =
      BigInt(pay.creditedToAdvanceMinor ?? '0') > ZERO
        ? `<tr><td colspan="5">Credited to advance wallet</td>
             <td class="num">${escapeHtml(pay.creditedToAdvanceMinor)}</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Receipt ${escapeHtml(receipt.receiptNumber)}</title>
<style>
  body { font-family: monospace; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; }
  .num { text-align: right; }
  .footer { margin-top: 20px; font-size: 12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(org.name ?? '')}</h1>
  <div class="muted">
    Currency: ${escapeHtml(org.currency ?? '')} &middot;
    Template: ${escapeHtml(s.templateVersion ?? '')}
  </div>
  <table>
    <tr><th>Receipt Number</th><td colspan="5">${escapeHtml(receipt.receiptNumber)}</td></tr>
    <tr><th>Issued At</th><td colspan="5">${escapeHtml(receipt.issuedAt.toISOString())}</td></tr>
    <tr><th>${escapeHtml(terms.personLabelSingular ?? 'Person')}</th><td colspan="5">${escapeHtml(payer.fullName ?? '')}</td></tr>
    <tr><th>Phone</th><td colspan="5">${escapeHtml(payer.primaryPhone ?? '')}</td></tr>
    <tr><th>Email</th><td colspan="5">${escapeHtml(payer.email ?? '')}</td></tr>
    <tr><th>Payment Mode</th><td>${escapeHtml(pay.paymentMode ?? '')}</td>
        <th>Reference</th><td>${escapeHtml(pay.referenceNumber ?? '-')}</td></tr>
    <tr><th>Collected By</th><td colspan="5">${escapeHtml(pay.collectorName ?? pay.collectorUserId ?? '')}</td></tr>
  </table>
  <table>
    <thead>
      <tr><th>${escapeHtml(terms.chargeLabelPlural ?? 'Charges')}</th><th>Description</th><th>Due Date</th>
          <th class="num">Principal</th><th class="num">Late Fee</th><th class="num">Total</th></tr>
    </thead>
    <tbody>
      ${rows}
      <tr><td colspan="5"><strong>Total Collected</strong></td>
          <td class="num"><strong>${escapeHtml(pay.totalAmountMinor)}</strong></td></tr>
      ${advance}
    </tbody>
  </table>
  <div class="footer">${escapeHtml(org.receiptFooterText ?? '')}</div>
</body>
</html>`;
  }

  /**
   * Deterministic PDF rendering for reprint. Like the HTML view, it
   * reads exclusively from the frozen snapshot and never joins live
   * entity tables (BR-RCP-002).
   */
  async renderReceiptPdf(
    tenantId: string,
    receiptId: string,
  ): Promise<Buffer> {
    const receipt = await this.findReceipt(tenantId, receiptId);
    const s = receipt.snapshotData as Record<string, any>;

    const org = s.organization ?? {};
    const payer = s.payer ?? {};
    const pay = s.payment ?? {};

    // Left-aligned fixed-width cell, and its right-aligned counterpart,
    // so the rendered columns line up deterministically.
    const pad = (text: string, width: number) =>
      String(text ?? '').slice(0, width).padEnd(width, ' ');

    const cell = (text: string, width: number) => pad(text, width);
    const right = (text: string, width: number) => {
      const t = pad(text, width);
      return t.trimStart().padStart(width, ' ');
    };

    const lines: string[] = [];

    lines.push(String(org.name ?? ''));
    lines.push(
      `Currency: ${org.currency ?? '-'}    Template: ${s.templateVersion ?? '-'}`,
    );
    lines.push('');

    lines.push(`Receipt Number : ${receipt.receiptNumber}`);
    lines.push(`Issued At      : ${receipt.issuedAt.toISOString()}`);
    lines.push(`Payer          : ${payer.fullName ?? '-'}`);
    lines.push(`Phone          : ${payer.primaryPhone ?? '-'}`);
    lines.push(`Email          : ${payer.email ?? '-'}`);
    lines.push(`Payment Mode   : ${pay.paymentMode ?? '-'}`);
    lines.push(`Reference      : ${pay.referenceNumber ?? '-'}`);
    lines.push(
      `Collected By   : ${pay.collectorName ?? pay.collectorUserId ?? '-'}`,
    );
    lines.push('');

    lines.push(
      cell('CATEGORY', 18) +
        cell('DESCRIPTION', 22) +
        cell('DUE DATE', 12) +
        right('PRINCIPAL', 12) +
        right('LATE FEE', 10) +
        right('TOTAL', 12),
    );
    lines.push('-'.repeat(88));

    for (const a of s.allocations ?? []) {
      lines.push(
        cell(String(a.category ?? '-'), 18) +
          cell(String(a.description ?? '-'), 22) +
          cell(String(a.dueDate ?? '-'), 12) +
          right(String(a.allocatedPrincipalMinor ?? '0'), 12) +
          right(String(a.allocatedLateFeeMinor ?? '0'), 10) +
          right(String(a.totalAllocatedMinor ?? '0'), 12),
      );
    }

    lines.push('-'.repeat(88));
    lines.push(`${'TOTAL COLLECTED'.padEnd(62)}${String(pay.totalAmountMinor ?? '0').padStart(24)}`);

    const credited = BigInt(pay.creditedToAdvanceMinor ?? '0');
    if (credited > ZERO) {
      lines.push(
        `${'CREDITED TO ADVANCE'.padEnd(62)}${credited.toString().padStart(24)}`,
      );
    }

    if (org.receiptFooterText) {
      lines.push('');
      lines.push(String(org.receiptFooterText));
    }

    return buildReceiptPdf(lines);
  }
}
