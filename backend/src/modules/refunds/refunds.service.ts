import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { DuesService } from '../dues/dues.service.js';
import { AdvanceWalletService } from '../payments/services/advance-wallet.service.js';
import {
  CreateRefundDto,
  CreateAdvanceRefundDto,
} from './dto/refund.dto.js';
import { PaymentStatus, Refund, RefundType } from '@prisma/client';

const ZERO = BigInt(0);

function parseMinor(raw: string, field: string): bigint {
  if (!/^\d+$/.test(raw.trim())) {
    throw new BadRequestException(
      `${field} must be a non-negative integer in minor units.`,
    );
  }
  return BigInt(raw.trim());
}

/**
 * Refund Flow A (BR-REF-001): refund of a payment allocation
 * against a Due.
 *
 * Payment -> Allocation -> Refund -> Due balance/status -> Ledger.
 * Every write runs in one transaction, so a rejected refund
 * never leaves a Refund row, an incremented refundedAmount, or a
 * restored Due balance behind.
 */
@Injectable()
export class RefundsService {
  private readonly advanceWallet: AdvanceWalletService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly duesService: DuesService,
    advanceWalletService?: AdvanceWalletService,
  ) {
    this.advanceWallet =
      advanceWalletService || new AdvanceWalletService(this.prisma);
  }

  async refundAllocation(
    tenantId: string,
    userId: string,
    dto: CreateRefundDto,
  ) {
    const refundAmount = parseMinor(
      dto.refundAmountMinor,
      'refundAmountMinor',
    );

    if (refundAmount <= ZERO) {
      throw new BadRequestException(
        'Refund amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      /*
       * Tenant-scoped lookup: the allocation id alone is never
       * trusted, so a refund can never touch another tenant's
       * allocation.
       */
      const allocation =
        await tx.paymentAllocation.findFirst({
          where: {
            id: dto.paymentAllocationId,
            tenantId,
          },
          include: { due: true, payment: true },
        });

      if (!allocation) {
        throw new NotFoundException(
          `Payment allocation '${dto.paymentAllocationId}' not found in this tenant.`,
        );
      }

      if (!allocation.paymentId || !allocation.dueId) {
        throw new BadRequestException(
          'Allocation is missing its payment or due reference.',
        );
      }

      /*
       * Ceiling: refund <= total_allocated - refunded_amount.
       * Over-refunding is refused rather than clamped, so no
       * money is silently created or discarded.
       */
      const refundable =
        allocation.totalAllocated - allocation.refundedAmount;

      if (refundAmount > refundable) {
        throw new BadRequestException(
          `Refund amount ${refundAmount.toString()} exceeds the refundable ` +
            `${refundable.toString()} for this allocation.`,
        );
      }

      const due = allocation.due;

      if (!due) {
        throw new NotFoundException(
          `Due '${allocation.dueId}' not found.`,
        );
      }

      // 1. Refund record
      const refund = await tx.refund.create({
        data: {
          tenantId,
          refundType: RefundType.DUE_ALLOCATION,
          paymentId: allocation.paymentId,
          paymentAllocationId: allocation.id,
          personId: due.personId,
          processedByUserId: userId,
          refundAmount,
          refundReason: dto.refundReason,
          refundMode: dto.refundMode,
          referenceNumber: dto.referenceNumber || null,
        },
      });

      // 2. Increment the allocation's refunded amount
      const newRefunded =
        allocation.refundedAmount + refundAmount;

      const updatedAllocation =
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: { refundedAmount: newRefunded },
        });

      /*
       * 3. Restore the Due balance:
       *    BalanceRemaining_new = BalanceRemaining_old + Refund
       */
      const newBalance = due.balanceRemaining + refundAmount;

      /*
       * 4. Status regression reuses DuesService.evaluateStatus, so refunds
       *    cannot drift from the payment-side rules. The tenant's own
       *    calendar date is passed in (via the same resolveToday /
       *    resolveTenantDate helper the dues and late-fee paths use) because
       *    this status is *persisted*: leaving the UTC fallback in place
       *    would store a status that `GET /dues`, `GET /dues/:id` and
       *    `GET /dues/overdue` immediately contradict for a tenant whose
       *    local day is ahead of or behind UTC.
       */
      const newStatus =
        this.duesService.evaluateStatus(
          due.dueDate,
          due.netAmount,
          newBalance,
          due.status,
          await this.duesService.resolveToday(tenantId),
        );

      const updatedDue = await tx.due.update({
        where: { id: due.id },
        data: {
          balanceRemaining: newBalance,
          status: newStatus,
        },
      });

      /*
       * 5. Payment status reflects cumulative refunds across all
       *    of its allocations. Payment has no running refunded
       *    column, so it is derived from the refund rows.
       */
      const priorRefunds =
        await tx.refund.findMany({
          where: { tenantId, paymentId: allocation.paymentId },
          select: { refundAmount: true },
        });

      const paymentTotalRefunded = priorRefunds.reduce(
        (sum, r) => sum + r.refundAmount,
        ZERO,
      );

      const paymentStatus =
        paymentTotalRefunded >= allocation.payment.totalAmount
          ? PaymentStatus.FULLY_REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: { id: allocation.paymentId },
        data: { status: paymentStatus },
      });

      // 6. Immutable financial ledger entry
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: due.personId,
          eventType: 'DUE_ALLOCATION_REFUND',
          referenceEntityType: 'Refund',
          referenceEntityId: refund.id,
          amount: refundAmount,
          balanceSnapshot: newBalance,
          performedByUserId: userId,
          metadata: {
            dueId: due.id,
            paymentId: allocation.paymentId,
            paymentAllocationId: allocation.id,
            refundAmount: refundAmount.toString(),
          },
        },
      });

      return {
        refund: {
          ...refund,
          refundAmountMinor: refund.refundAmount.toString(),
        },
        allocation: {
          id: updatedAllocation.id,
          totalAllocatedMinor:
            updatedAllocation.totalAllocated.toString(),
          refundedAmountMinor:
            updatedAllocation.refundedAmount.toString(),
        },
        paymentStatus,
        due: {
          ...updatedDue,
          netAmountMinor: updatedDue.netAmount.toString(),
          balanceRemainingMinor:
            updatedDue.balanceRemaining.toString(),
        },
      };
    });
  }

  /**
   * Refund Flow B (BR-REF-002): return of unallocated advance credit.
   *
   * Deliberately segregated from Flow A: no Payment, PaymentAllocation
   * or Due is read or written. Only the Person's wallet moves, which is
   * why `paymentId` / `paymentAllocationId` stay null on the row.
   */
  async refundAdvance(
    tenantId: string,
    userId: string,
    dto: CreateAdvanceRefundDto,
  ) {
    const refundAmount = parseMinor(
      dto.refundAmountMinor,
      'refundAmountMinor',
    );

    if (refundAmount <= ZERO) {
      throw new BadRequestException(
        'Refund amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      /*
       * Reuses AdvanceWalletService so the wallet ceiling
       * (refund <= advance_balance) and its tenant-scoped person
       * lookup stay defined in exactly one place.
       */
      const { newAdvanceBalance } = await this.advanceWallet.debitAdvance(
        tx,
        tenantId,
        dto.personId,
        refundAmount,
      );

      const refund = await tx.refund.create({
        data: {
          tenantId,
          refundType: RefundType.ADVANCE_WALLET,
          // Flow B has no payment or allocation counterpart.
          paymentId: null,
          paymentAllocationId: null,
          personId: dto.personId,
          processedByUserId: userId,
          refundAmount,
          refundReason: dto.refundReason,
          refundMode: dto.refundMode,
          referenceNumber: dto.referenceNumber || null,
        },
      });

      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: dto.personId,
          eventType: 'ADVANCE_WALLET_REFUND',
          referenceEntityType: 'Refund',
          referenceEntityId: refund.id,
          amount: refundAmount,
          balanceSnapshot: newAdvanceBalance,
          performedByUserId: userId,
          metadata: {
            refundAmount: refundAmount.toString(),
            refundMode: dto.refundMode,
          },
        },
      });

      return {
        refund: {
          ...refund,
          refundAmountMinor: refund.refundAmount.toString(),
        },
        person: {
          id: dto.personId,
          advanceBalanceMinor: newAdvanceBalance.toString(),
        },
      };
    });
  }

  private serialize(refund: Refund) {
    return {
      id: refund.id,
      refundType: refund.refundType,
      paymentId: refund.paymentId,
      paymentAllocationId: refund.paymentAllocationId,
      personId: refund.personId,
      processedByUserId: refund.processedByUserId,
      refundAmountMinor: refund.refundAmount.toString(),
      refundReason: refund.refundReason,
      refundMode: refund.refundMode,
      referenceNumber: refund.referenceNumber,
      createdAt: refund.createdAt.toISOString(),
    };
  }

  /** Tenant-scoped read: a cross-tenant id is indistinguishable from a missing one. */
  async getRefund(tenantId: string, refundId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, tenantId },
    });

    if (!refund) {
      throw new NotFoundException(
        `Refund '${refundId}' not found in this tenant.`,
      );
    }

    return this.serialize(refund);
  }

  /**
   * Tenant-scoped listing (`refunds:view`). `tenantId` is part of every
   * query so pagination can never page through another tenant's refunds.
   */
  async listRefunds(
    tenantId: string,
    query?: {
      personId?: string;
      paymentId?: string;
      refundType?: RefundType;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query?.personId) where.personId = query.personId;
    if (query?.paymentId) where.paymentId = query.paymentId;
    if (query?.refundType) where.refundType = query.refundType;

    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.serialize(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}