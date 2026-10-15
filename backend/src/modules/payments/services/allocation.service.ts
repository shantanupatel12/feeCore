import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Due, DueStatus, PaymentAllocation, Prisma } from '@prisma/client';

const ZERO = BigInt(0);

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export interface AllocationComputation {
  allocatedPrincipal: bigint;
  allocatedLateFee: bigint;
  totalAllocated: bigint;
  newBalance: bigint;
  newStatus: DueStatus;
}

export interface AllocationExecutionResult {
  allocation: PaymentAllocation;
  updatedDue: Due;
}

/**
 * Payment allocation engine (BR-PAY-001 / BR-PAY-002 / BR-PAY-003).
 *
 * Single Responsibility:
 * Calculates Principal-First splits between principal balance and outstanding late fees,
 * validates against collectable ceilings, creates PaymentAllocation rows, and updates Due state.
 */
@Injectable()
export class AllocationService {
  /**
   * Pure calculation & validation of allocation against a Due.
   */
  async computeAllocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    due: Due,
    requestedAmount: bigint,
  ): Promise<AllocationComputation> {
    if (due.status === DueStatus.VOIDED) {
      throw new BadRequestException(
        `Payment cannot be recorded against a VOIDED due '${due.id}'.`,
      );
    }

    // Unsettled late fee derived from prior allocations
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
        `Due '${due.id}' is already fully settled; no payment is due.`,
      );
    }

    if (requestedAmount > collectable) {
      throw new BadRequestException(
        `Payment amount ${requestedAmount.toString()} exceeds the collectable ` +
          `${collectable.toString()} for due '${due.id}' (balance ${due.balanceRemaining.toString()}` +
          (lateFeeAvailable > ZERO
            ? ` + late fee ${lateFeeAvailable.toString()}`
            : '') +
          ').',
      );
    }

    // BR-PAY-002: Principal First Priority
    const allocatedPrincipal = minBigInt(requestedAmount, due.balanceRemaining);
    const allocatedLateFee = minBigInt(
      requestedAmount - allocatedPrincipal,
      lateFeeAvailable,
    );
    const totalAllocated = allocatedPrincipal + allocatedLateFee;
    const newBalance = due.balanceRemaining - allocatedPrincipal;
    const newStatus = this.resolveStatus(newBalance);

    return {
      allocatedPrincipal,
      allocatedLateFee,
      totalAllocated,
      newBalance,
      newStatus,
    };
  }

  /**
   * Persists the allocation record and updates the Due balance within the transaction.
   */
  async executeAllocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    due: Due,
    requestedAmount: bigint,
  ): Promise<AllocationExecutionResult> {
    const calc = await this.computeAllocation(
      tx,
      tenantId,
      due,
      requestedAmount,
    );

    const allocation = await tx.paymentAllocation.create({
      data: {
        tenantId,
        paymentId,
        dueId: due.id,
        allocatedPrincipal: calc.allocatedPrincipal,
        allocatedLateFee: calc.allocatedLateFee,
        totalAllocated: calc.totalAllocated,
      },
    });

    const updatedDue = await tx.due.update({
      where: { id: due.id },
      data: {
        balanceRemaining: calc.newBalance,
        status: calc.newStatus,
      },
    });

    return { allocation, updatedDue };
  }

  public resolveStatus(balanceRemaining: bigint): DueStatus {
    return balanceRemaining === ZERO
      ? DueStatus.PAID
      : DueStatus.PARTIALLY_PAID;
  }
}
