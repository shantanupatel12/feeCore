import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { AllocationService } from './services/allocation.service.js';
import { AdvanceWalletService } from './services/advance-wallet.service.js';
import { ReceiptsService } from '../receipts/receipts.service.js';
import {
  CreatePaymentDto,
  CreateMultiDuePaymentDto,
  CreateAdvancePaymentDto,
  ApplyAdvanceDto,
} from './dto/payment.dto.js';
import {
  Due,
  DueStatus,
  Payment,
  PaymentAllocation,
  PaymentStatus,
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
 * Payment collection orchestrator (BR-PAY-001 / BR-PAY-002 / BR-PAY-003).
 *
 * Single Responsibility:
 * Cashier intake orchestration, idempotency checking, single & multi-due collection,
 * delegating allocation to AllocationService, advance wallet management to AdvanceWalletService.
 */
@Injectable()
export class PaymentsService {
  private readonly allocService: AllocationService;
  private readonly advService: AdvanceWalletService;
  private readonly receiptsService: ReceiptsService;

  constructor(
    private readonly prisma: PrismaService,
    allocationService?: AllocationService,
    advanceWalletService?: AdvanceWalletService,
    receiptsService?: ReceiptsService,
  ) {
    this.allocService = allocationService || new AllocationService();
    this.advService =
      advanceWalletService ||
      new AdvanceWalletService(this.prisma, this.allocService);
    this.receiptsService =
      receiptsService || new ReceiptsService(this.prisma);
  }

  /**
   * Single-due payment collection (BR-PAY-001 / BR-PAY-002).
   */
  async collectPayment(
    tenantId: string,
    userId: string,
    dto: CreatePaymentDto,
  ) {
    if (!dto.dueId) {
      throw new BadRequestException('dueId is required for single payment collection.');
    }

    const amount = parseMinor(dto.amountMinor || '0', 'amountMinor');

    if (amount <= ZERO) {
      throw new BadRequestException(
        'Payment amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Idempotency enforcement: return cached response if key already processed
      const existing = await tx.payment.findFirst({
        where: { tenantId, idempotencyKey: dto.idempotencyKey },
        include: { paymentAllocations: true },
      });

      if (existing) {
        const due = await tx.due.findFirst({
          where: { id: dto.dueId, tenantId },
        });

        return {
          payment: serializePayment(existing),
          allocation: existing.paymentAllocations[0]
            ? serializeAllocation(existing.paymentAllocations[0])
            : null,
          due: due ? serializeDue(due) : null,
        };
      }

      // 2. Tenant-scoped lookup: dueId alone is never trusted
      const due = await tx.due.findFirst({
        where: { id: dto.dueId, tenantId },
      });

      if (!due) {
        throw new NotFoundException(
          `Due '${dto.dueId}' not found in this tenant.`,
        );
      }

      // 3. Delegate calculation & validation to AllocationService (Principal-First)
      const calc = await this.allocService.computeAllocation(
        tx,
        tenantId,
        due,
        amount,
      );

      // 4. Payment header
      const payment = await tx.payment.create({
        data: {
          tenantId,
          personId: due.personId,
          collectorUserId: userId,
          paymentMode: dto.paymentMode,
          totalAmount: amount,
          allocatedToDues: calc.totalAllocated,
          creditedToAdvance: ZERO,
          referenceNumber: dto.referenceNumber || null,
          notes: dto.notes || null,
          idempotencyKey: dto.idempotencyKey,
          status: PaymentStatus.SUCCESSFUL,
        },
      });

      // 5. Persist allocation
      const allocation = await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: payment.id,
          dueId: due.id,
          allocatedPrincipal: calc.allocatedPrincipal,
          allocatedLateFee: calc.allocatedLateFee,
          totalAllocated: calc.totalAllocated,
        },
      });

      // 6. Reduce Due balance and update status
      const updatedDue = await tx.due.update({
        where: { id: due.id },
        data: {
          balanceRemaining: calc.newBalance,
          status: calc.newStatus,
        },
      });

      // 7. Immutable financial ledger entry
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: due.personId,
          eventType: 'PAYMENT_COLLECTED',
          referenceEntityType: 'Payment',
          referenceEntityId: payment.id,
          amount: calc.totalAllocated,
          balanceSnapshot: calc.newBalance,
          performedByUserId: userId,
          metadata: {
            dueId: due.id,
            allocatedPrincipal: calc.allocatedPrincipal.toString(),
            allocatedLateFee: calc.allocatedLateFee.toString(),
            paymentMode: dto.paymentMode,
          },
        },
      });

      // 8. Issue the receipt inside this same transaction, so the
      //    sequence bump rolls back with the payment (BR-RCP-001).
      const receipt = await this.receiptsService.issueReceipt(
        tx,
        tenantId,
        payment,
        [
          {
            dueId: allocation.dueId,
            allocatedPrincipal: allocation.allocatedPrincipal,
            allocatedLateFee: allocation.allocatedLateFee,
            totalAllocated: allocation.totalAllocated,
          },
        ],
      );

      return {
        payment: serializePayment(payment),
        allocation: serializeAllocation(allocation),
        due: serializeDue(updatedDue),
        receipt: {
          id: receipt.id,
          receiptNumber: receipt.receiptNumber,
        },
      };
    });
  }

  /**
   * Multiple-charge payment settlement (FR-PAY-03 / BR-PAY-003).
   * Allocates a single payment across multiple dues for the same person atomically.
   */
  async collectMultiDuePayment(
    tenantId: string,
    userId: string,
    dto: CreateMultiDuePaymentDto,
  ) {
    if (!dto.allocations || dto.allocations.length === 0) {
      throw new BadRequestException(
        'At least one due allocation line item is required.',
      );
    }

    const totalAmount = parseMinor(dto.totalAmountMinor, 'totalAmountMinor');
    if (totalAmount <= ZERO) {
      throw new BadRequestException(
        'Total payment amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Idempotency enforcement
      const existing = await tx.payment.findFirst({
        where: { tenantId, idempotencyKey: dto.idempotencyKey },
        include: { paymentAllocations: true },
      });

      if (existing) {
        const dueIds = existing.paymentAllocations.map((a) => a.dueId);
        const dues = await tx.due.findMany({
          where: { id: { in: dueIds }, tenantId },
        });

        return {
          payment: serializePayment(existing),
          allocations: existing.paymentAllocations.map(serializeAllocation),
          dues: dues.map(serializeDue),
          advanceCreditMinor: existing.creditedToAdvance.toString(),
        };
      }

      // 2. Fetch and validate all target dues within tenant
      const dueIds = dto.allocations.map((a) => a.dueId);
      const dues = await tx.due.findMany({
        where: { id: { in: dueIds }, tenantId },
      });

      if (dues.length !== dueIds.length) {
        const foundIds = new Set(dues.map((d) => d.id));
        const missing = dueIds.find((id) => !foundIds.has(id));
        throw new NotFoundException(
          `Due '${missing}' not found in this tenant.`,
        );
      }

      // Verify all dues belong to the specified Person
      for (const due of dues) {
        if (due.personId !== dto.personId) {
          throw new BadRequestException(
            `Due '${due.id}' does not belong to person '${dto.personId}'. All dues must belong to the same person.`,
          );
        }
      }

      // Map dues by ID
      const dueMap = new Map<string, Due>();
      for (const due of dues) {
        dueMap.set(due.id, due);
      }

      // 3. Pre-compute allocations for each line item (Principal-First)
      let sumAllocated = ZERO;
      const plannedAllocations: Array<{
        due: Due;
        amount: bigint;
      }> = [];

      for (const item of dto.allocations) {
        const allocAmount = parseMinor(item.amountMinor, 'allocation amountMinor');
        if (allocAmount <= ZERO) {
          throw new BadRequestException(
            `Allocation amount for due '${item.dueId}' must be greater than zero.`,
          );
        }

        const due = dueMap.get(item.dueId)!;
        // Verify allocation ceiling
        await this.allocService.computeAllocation(
          tx,
          tenantId,
          due,
          allocAmount,
        );

        sumAllocated += allocAmount;
        plannedAllocations.push({ due, amount: allocAmount });
      }

      // 4. Validate totalAmount vs sumAllocated
      let creditedToAdvance = ZERO;
      if (dto.creditedToAdvanceMinor) {
        creditedToAdvance = parseMinor(
          dto.creditedToAdvanceMinor,
          'creditedToAdvanceMinor',
        );

        if (totalAmount !== sumAllocated + creditedToAdvance) {
          throw new BadRequestException(
            `Total amount (${totalAmount.toString()}) must exactly match sum of allocations (${sumAllocated.toString()}) + advance credit (${creditedToAdvance.toString()}).`,
          );
        }
      } else {
        if (totalAmount < sumAllocated) {
          throw new BadRequestException(
            `Total payment amount ${totalAmount.toString()} is less than sum of allocations ${sumAllocated.toString()}.`,
          );
        }
        creditedToAdvance = totalAmount - sumAllocated;
      }

      // 5. Payment header
      const payment = await tx.payment.create({
        data: {
          tenantId,
          personId: dto.personId,
          collectorUserId: userId,
          paymentMode: dto.paymentMode,
          totalAmount,
          allocatedToDues: sumAllocated,
          creditedToAdvance,
          referenceNumber: dto.referenceNumber || null,
          notes: dto.notes || null,
          idempotencyKey: dto.idempotencyKey,
          status: PaymentStatus.SUCCESSFUL,
        },
      });

      // 6. Execute allocations sequentially
      const executedAllocations: PaymentAllocation[] = [];
      const updatedDues: Due[] = [];

      for (const plan of plannedAllocations) {
        const { allocation, updatedDue } =
          await this.allocService.executeAllocation(
            tx,
            tenantId,
            payment.id,
            plan.due,
            plan.amount,
          );
        executedAllocations.push(allocation);
        updatedDues.push(updatedDue);
      }

      // 7. If excess payment, credit unallocated funds to Advance Balance
      if (creditedToAdvance > ZERO) {
        const { newAdvanceBalance } =
          await this.advService.creditAdvance(
            tx,
            tenantId,
            dto.personId,
            creditedToAdvance,
            userId,
            payment.id,
          );

        await tx.financialTransactionLog.create({
          data: {
            tenantId,
            personId: dto.personId,
            eventType: 'ADVANCE_RECEIVED',
            referenceEntityType: 'Payment',
            referenceEntityId: payment.id,
            amount: creditedToAdvance,
            balanceSnapshot: newAdvanceBalance,
            performedByUserId: userId,
            metadata: {
              source: 'MULTI_DUE_OVERPAYMENT',
              paymentMode: dto.paymentMode,
            },
          },
        });
      }

      // 8. Immutable financial transaction log for collection
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: dto.personId,
          eventType: 'PAYMENT_COLLECTED',
          referenceEntityType: 'Payment',
          referenceEntityId: payment.id,
          amount: sumAllocated,
          balanceSnapshot: updatedDues.reduce(
            (sum, d) => sum + d.balanceRemaining,
            ZERO,
          ),
          performedByUserId: userId,
          metadata: {
            paymentMode: dto.paymentMode,
            dueCount: dues.length,
            allocations: executedAllocations.map((a) => ({
              allocationId: a.id,
              dueId: a.dueId,
              allocatedPrincipal: a.allocatedPrincipal.toString(),
              allocatedLateFee: a.allocatedLateFee.toString(),
              totalAllocated: a.totalAllocated.toString(),
            })),
          },
        },
      });

      // 9. Issue the receipt inside this same transaction, so the
      //    sequence bump rolls back with the payment (BR-RCP-001).
      const receipt = await this.receiptsService.issueReceipt(
        tx,
        tenantId,
        payment,
        executedAllocations.map((a) => ({
          dueId: a.dueId,
          allocatedPrincipal: a.allocatedPrincipal,
          allocatedLateFee: a.allocatedLateFee,
          totalAllocated: a.totalAllocated,
        })),
      );

      return {
        payment: serializePayment(payment),
        allocations: executedAllocations.map(serializeAllocation),
        dues: updatedDues.map(serializeDue),
        advanceCreditMinor: creditedToAdvance.toString(),
        receipt: {
          id: receipt.id,
          receiptNumber: receipt.receiptNumber,
        },
      };
    });
  }

  /**
   * Advance payment collection: delegates to AdvanceWalletService.
   */
  async collectAdvancePayment(
    tenantId: string,
    userId: string,
    dto: CreateAdvancePaymentDto,
  ) {
    return this.advService.collectAdvancePayment(
      tenantId,
      userId,
      dto,
    );
  }

  /**
   * Manual advance application: delegates to AdvanceWalletService.
   */
  async applyAdvance(
    tenantId: string,
    userId: string,
    dto: ApplyAdvanceDto,
  ) {
    return this.advService.applyAdvanceToDue(
      tenantId,
      userId,
      dto,
    );
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

function serializeDue(due: Due) {
  return {
    ...due,
    netAmountMinor: due.netAmount.toString(),
    lateFeeAmountMinor: due.lateFeeAmount.toString(),
    balanceRemainingMinor: due.balanceRemaining.toString(),
  };
}