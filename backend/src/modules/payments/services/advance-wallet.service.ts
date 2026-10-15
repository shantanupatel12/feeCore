import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service.js';
import { AllocationService, minBigInt } from './allocation.service.js';
import {
  CreateAdvancePaymentDto,
  ApplyAdvanceDto,
} from '../dto/payment.dto.js';
import {
  Payment,
  PaymentAllocation,
  PaymentMode,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

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
 * Advance Wallet Service (BR-ADV-001 / BR-ADV-002 / ADR-011).
 *
 * Single Responsibility:
 * Manages Person advance credit balance wallet, unallocated advance intake,
 * and explicit manual application of advance credit to outstanding dues.
 */
@Injectable()
export class AdvanceWalletService {
  private readonly allocService: AllocationService;

  constructor(
    private readonly prisma: PrismaService,
    allocationService?: AllocationService,
  ) {
    this.allocService = allocationService || new AllocationService();
  }

  /**
   * Credits a Person's advance balance wallet within a transaction.
   */
  async creditAdvance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string,
    amount: bigint,
    performedByUserId: string,
    paymentId?: string,
  ) {
    const person = await tx.person.findFirst({
      where: { id: personId, tenantId },
    });

    if (!person) {
      throw new NotFoundException(
        `Person '${personId}' not found in this tenant.`,
      );
    }

    const newAdvanceBalance = person.advanceBalance + amount;

    const updatedPerson = await tx.person.update({
      where: { id: personId },
      data: { advanceBalance: newAdvanceBalance },
    });

    return { person: updatedPerson, newAdvanceBalance };
  }

  /**
   * Debits a Person's advance balance wallet within a transaction.
   */
  async debitAdvance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string,
    amount: bigint,
  ) {
    const person = await tx.person.findFirst({
      where: { id: personId, tenantId },
    });

    if (!person) {
      throw new NotFoundException(
        `Person '${personId}' not found in this tenant.`,
      );
    }

    if (person.advanceBalance < amount) {
      throw new BadRequestException(
        `Insufficient advance balance: available ${person.advanceBalance.toString()}, requested ${amount.toString()}.`,
      );
    }

    const newAdvanceBalance = person.advanceBalance - amount;

    const updatedPerson = await tx.person.update({
      where: { id: personId },
      data: { advanceBalance: newAdvanceBalance },
    });

    return { person: updatedPerson, newAdvanceBalance };
  }

  /**
   * Collects unallocated advance funds into a Person's wallet (FR-ADV-01).
   */
  async collectAdvancePayment(
    tenantId: string,
    userId: string,
    dto: CreateAdvancePaymentDto,
  ) {
    const amount = parseMinor(dto.amountMinor, 'amountMinor');

    if (amount <= ZERO) {
      throw new BadRequestException(
        'Advance payment amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Idempotency check: return cached payment if already processed
      const existing = await tx.payment.findFirst({
        where: { tenantId, idempotencyKey: dto.idempotencyKey },
        include: { paymentAllocations: true },
      });

      if (existing) {
        const person = await tx.person.findFirst({
          where: { id: existing.personId, tenantId },
        });

        return {
          payment: serializePayment(existing),
          person: {
            id: person!.id,
            advanceBalanceMinor: person!.advanceBalance.toString(),
          },
        };
      }

      // Verify person belongs to tenant
      const person = await tx.person.findFirst({
        where: { id: dto.personId, tenantId },
      });

      if (!person) {
        throw new NotFoundException(
          `Person '${dto.personId}' not found in this tenant.`,
        );
      }

      // 1. Payment header with 100% creditedToAdvance
      const payment = await tx.payment.create({
        data: {
          tenantId,
          personId: person.id,
          collectorUserId: userId,
          paymentMode: dto.paymentMode,
          totalAmount: amount,
          allocatedToDues: ZERO,
          creditedToAdvance: amount,
          referenceNumber: dto.referenceNumber || null,
          notes: dto.notes || null,
          idempotencyKey: dto.idempotencyKey,
          status: PaymentStatus.SUCCESSFUL,
        },
      });

      // 2. Increment Person's advance balance
      const newAdvanceBalance = person.advanceBalance + amount;
      const updatedPerson = await tx.person.update({
        where: { id: person.id },
        data: { advanceBalance: newAdvanceBalance },
      });

      // 3. Immutable financial transaction log
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: person.id,
          eventType: 'ADVANCE_RECEIVED',
          referenceEntityType: 'Payment',
          referenceEntityId: payment.id,
          amount,
          balanceSnapshot: newAdvanceBalance,
          performedByUserId: userId,
          metadata: {
            paymentMode: dto.paymentMode,
            referenceNumber: dto.referenceNumber || null,
            notes: dto.notes || null,
          },
        },
      });

      return {
        payment: serializePayment(payment),
        person: {
          id: updatedPerson.id,
          advanceBalanceMinor: updatedPerson.advanceBalance.toString(),
        },
      };
    });
  }

  /**
   * Manually applies existing advance credit to an outstanding Due (FR-ADV-02 / BR-ADV-002).
   */
  async applyAdvanceToDue(
    tenantId: string,
    userId: string,
    dto: ApplyAdvanceDto,
  ) {
    if (!dto.dueId) {
      throw new BadRequestException('dueId is required to apply advance.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Find Due scoped to tenant
      const due = await tx.due.findFirst({
        where: { id: dto.dueId, tenantId },
      });

      if (!due) {
        throw new NotFoundException(
          `Due '${dto.dueId}' not found in this tenant.`,
        );
      }

      // Find Person
      const person = await tx.person.findFirst({
        where: { id: due.personId, tenantId },
      });

      if (!person) {
        throw new NotFoundException(
          `Person '${due.personId}' not found in this tenant.`,
        );
      }

      if (person.advanceBalance <= ZERO) {
        throw new BadRequestException(
          'Person has no advance balance to apply.',
        );
      }

      // Compute collectable on Due
      const priorAllocations = await tx.paymentAllocation.findMany({
        where: { dueId: due.id, tenantId },
        select: { allocatedLateFee: true },
      });

      const lateFeeSettled = priorAllocations.reduce(
        (sum, a) => sum + a.allocatedLateFee,
        ZERO,
      );

      const lateFeeAvailable =
        due.lateFeeAmount > lateFeeSettled
          ? due.lateFeeAmount - lateFeeSettled
          : ZERO;

      const collectable = due.balanceRemaining + lateFeeAvailable;

      if (collectable <= ZERO) {
        throw new BadRequestException(
          'Due is already fully settled; no payment is due.',
        );
      }

      // Determine amount to apply
      let applyAmount: bigint;
      if (dto.amountMinor) {
        applyAmount = parseMinor(dto.amountMinor, 'amountMinor');

        if (applyAmount <= ZERO) {
          throw new BadRequestException(
            'Advance application amount must be greater than zero.',
          );
        }

        if (applyAmount > person.advanceBalance) {
          throw new BadRequestException(
            `Requested amount ${applyAmount.toString()} exceeds available advance balance ${person.advanceBalance.toString()}.`,
          );
        }

        if (applyAmount > collectable) {
          throw new BadRequestException(
            `Requested advance amount ${applyAmount.toString()} exceeds collectable ${collectable.toString()}.`,
          );
        }
      } else {
        applyAmount = minBigInt(person.advanceBalance, collectable);
      }

      // 1. Debit Person's advance balance
      const newAdvanceBalance = person.advanceBalance - applyAmount;
      const updatedPerson = await tx.person.update({
        where: { id: person.id },
        data: { advanceBalance: newAdvanceBalance },
      });

      // 2. Identify or create payment record for the allocation foreign key
      // First look for an existing unallocated advance payment
      const existingAdvPayment = await tx.payment.findFirst({
        where: {
          tenantId,
          personId: person.id,
          creditedToAdvance: { gte: applyAmount },
        },
        orderBy: { createdAt: 'asc' },
      });

      let paymentId: string;
      if (existingAdvPayment) {
        paymentId = existingAdvPayment.id;
        await tx.payment.update({
          where: { id: existingAdvPayment.id },
          data: {
            allocatedToDues:
              existingAdvPayment.allocatedToDues + applyAmount,
            creditedToAdvance:
              existingAdvPayment.creditedToAdvance - applyAmount,
          },
        });
      } else {
        // Fallback: create a dedicated payment record representing advance wallet settlement
        const idempKey =
          dto.idempotencyKey ||
          `adv-apply-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const createdPayment = await tx.payment.create({
          data: {
            tenantId,
            personId: person.id,
            collectorUserId: userId,
            paymentMode: PaymentMode.OTHER,
            totalAmount: applyAmount,
            allocatedToDues: applyAmount,
            creditedToAdvance: ZERO,
            referenceNumber: 'ADVANCE_WALLET_APPLIED',
            notes: `Manual advance applied to due ${due.id}`,
            idempotencyKey: idempKey,
            status: PaymentStatus.SUCCESSFUL,
          },
        });
        paymentId = createdPayment.id;
      }

      // 3. Execute allocation via AllocationService
      const { allocation, updatedDue } =
        await this.allocService.executeAllocation(
          tx,
          tenantId,
          paymentId,
          due,
          applyAmount,
        );

      // 4. Immutable financial ledger entry
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: person.id,
          eventType: 'ADVANCE_APPLIED',
          referenceEntityType: 'PaymentAllocation',
          referenceEntityId: allocation.id,
          amount: applyAmount,
          balanceSnapshot: newAdvanceBalance,
          performedByUserId: userId,
          metadata: {
            dueId: due.id,
            personId: person.id,
            allocatedPrincipal: allocation.allocatedPrincipal.toString(),
            allocatedLateFee: allocation.allocatedLateFee.toString(),
            dueBalanceRemaining: updatedDue.balanceRemaining.toString(),
          },
        },
      });

      return {
        allocation: serializeAllocation(allocation),
        due: {
          ...updatedDue,
          netAmountMinor: updatedDue.netAmount.toString(),
          lateFeeAmountMinor: updatedDue.lateFeeAmount.toString(),
          balanceRemainingMinor: updatedDue.balanceRemaining.toString(),
        },
        person: {
          id: updatedPerson.id,
          advanceBalanceMinor: updatedPerson.advanceBalance.toString(),
        },
      };
    });
  }
}

function serializePayment(payment: Payment) {
  return {
    ...payment,
    totalAmountMinor: payment.totalAmount.toString(),
    allocatedToDuesMinor: payment.allocatedToDues.toString(),
    creditedToAdvanceMinor: payment.creditedToAdvance.toString(),
  };
}

function serializeAllocation(allocation: PaymentAllocation) {
  return {
    ...allocation,
    allocatedPrincipalMinor: allocation.allocatedPrincipal.toString(),
    allocatedLateFeeMinor: allocation.allocatedLateFee.toString(),
    totalAllocatedMinor: allocation.totalAllocated.toString(),
    refundedAmountMinor: allocation.refundedAmount.toString(),
  };
}
