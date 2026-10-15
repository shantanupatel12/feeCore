import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service.js';
import { AssessLateFeeDto, WaiveLateFeeDto } from '../dto/payment.dto.js';
import { Due, DueStatus } from '@prisma/client';
import { calculateRuleLateFee } from '../../charges/late-fee-rules.service.js';

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
 * Late Fee Service (BR-CHG-003 / BR-PAY-002 / Edge Case 7).
 *
 * Single Responsibility:
 * Assesses late fee penalties on overdue/delinquent dues, enforces separation
 * invariant (stored in lateFeeAmount distinct from base/net amount),
 * and handles Admin waivers with mandatory justification and audit ledger logs.
 */
@Injectable()
export class LateFeeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assesses a late fee penalty on a delinquent Due.
   */
  async assessLateFee(
    tenantId: string,
    userId: string,
    dueId: string,
    dto: AssessLateFeeDto,
  ) {
    const feeAmount = parseMinor(dto.feeAmountMinor, 'feeAmountMinor');

    if (feeAmount <= ZERO) {
      throw new BadRequestException(
        'Late fee amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const due = await tx.due.findFirst({
        where: { id: dueId, tenantId },
      });

      if (!due) {
        throw new NotFoundException(`Due '${dueId}' not found in this tenant.`);
      }

      if (due.status === DueStatus.VOIDED) {
        throw new BadRequestException(
          'Cannot assess late fee against a VOIDED due.',
        );
      }

      if (due.balanceRemaining <= ZERO) {
        throw new BadRequestException(
          'Cannot assess late fee on an already settled due.',
        );
      }

      // Check delinquency: current calendar date > due_date
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const dueStr = due.dueDate.toISOString().split('T')[0];

      if (todayStr <= dueStr) {
        throw new BadRequestException(
          'Due date has not lapsed; late fee cannot be assessed prematurely.',
        );
      }

      // BR-CHG-003: Separation Invariant: late_fee_amount is incremented,
      // baseAmount and balanceRemaining (principal) are NOT mutated.
      const newLateFeeAmount = due.lateFeeAmount + feeAmount;

      const updatedDue = await tx.due.update({
        where: { id: due.id },
        data: {
          lateFeeAmount: newLateFeeAmount,
          status: DueStatus.OVERDUE,
        },
      });

      // Immutable financial ledger entry
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: due.personId,
          eventType: 'LATE_FEE_ASSESSED',
          referenceEntityType: 'Due',
          referenceEntityId: due.id,
          amount: feeAmount,
          balanceSnapshot: due.balanceRemaining,
          performedByUserId: userId,
          metadata: {
            dueId: due.id,
            previousLateFeeMinor: due.lateFeeAmount.toString(),
            assessedLateFeeMinor: feeAmount.toString(),
            totalLateFeeMinor: newLateFeeAmount.toString(),
            reason: dto.reason || 'Delinquent payment penalty',
          },
        },
      });

      return serializeDue(updatedDue);
    });
  }

  /**
   * FR-CHG-03 rule-driven evaluation (BR-CHG-003, state-models `DAILY_CRON_EVAL`).
   *
   * The repository has no scheduler dependency, so this sweep is the
   * documented daily evaluation, exposed through the same kind of
   * on-demand trigger as `dues/generate`. It is deliberately idempotent:
   *
   *  - `ruleLateFeeAmount` on the Due records how much the rule engine has
   *    already contributed, so only the *difference* from the rule's
   *    target is charged. Re-running the same day charges nothing.
   *  - The target is `calculateRuleLateFee(...)`, which is monotone in the
   *    overdue day count, so a later run on a later day adds exactly the
   *    new days and never re-charges old ones.
   *
   * Only `lateFeeAmount` is touched. `netAmount` and `balanceRemaining`
   * stay principal-only, which is the invariant
   * `allocation.service.ts` already relies on when it computes
   * `collectable = balanceRemaining + unsettledLateFee`.
   */
  async evaluateOverdueDues(
    tenantId: string,
    userId: string,
    asOfDate?: string,
  ) {
    const rule = await this.prisma.lateFeeRule.findFirst({ where: { tenantId } });

    // state-models.md: "Assess late fee if configured" - no rule, no fees.
    if (!rule) {
      return { ruleConfigured: false, evaluatedCount: 0, assessedCount: 0, skippedCount: 0, dues: [] };
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const timezone = tenant?.timezone ?? 'UTC';
    // `asOfDate` is an already-resolved calendar date; only an absent value
    // needs converting from an instant using the tenant's timezone.
    const today =
      asOfDate !== undefined
        ? asOfDate
        : resolveTenantDate(new Date(), timezone);

    const candidates = await this.prisma.due.findMany({
      where: { tenantId, balanceRemaining: { gt: ZERO } },
    });

    const assessed: Array<{ dueId: string; lateFeeAmountMinor: string; overdueDays: number }> = [];
    let skippedCount = 0;

    for (const due of candidates) {
      // BR-CHG-003: CurrentDate > DueDate AND BalanceRemaining > 0.
      const dueDateStr = toDateString(due.dueDate);
      const overdueDays = daysBetween(dueDateStr, today);

      if (overdueDays < 1 || due.status === DueStatus.VOIDED) {
        skippedCount += 1;
        continue;
      }

      const target = calculateRuleLateFee(rule.calculationType, rule.amountMinor, overdueDays);
      const pending = target - due.ruleLateFeeAmount;

      // Already fully accrued for this rule, or the rule was reduced.
      if (pending <= ZERO) {
        skippedCount += 1;
        continue;
      }

      const newLateFeeAmount = due.lateFeeAmount + pending;

      await this.prisma.$transaction(async (tx) => {
        await tx.due.update({
          where: { id: due.id },
          data: {
            lateFeeAmount: newLateFeeAmount,
            ruleLateFeeAmount: target,
            status: DueStatus.OVERDUE,
          },
        });

        await tx.financialTransactionLog.create({
          data: {
            tenantId,
            personId: due.personId,
            eventType: 'LATE_FEE_ASSESSED',
            referenceEntityType: 'Due',
            referenceEntityId: due.id,
            amount: pending,
            balanceSnapshot: due.balanceRemaining,
            performedByUserId: userId,
            metadata: {
              dueId: due.id,
              calculationType: rule.calculationType,
              amountPerUnitMinor: rule.amountMinor.toString(),
              overdueDays,
              previousLateFeeMinor: due.lateFeeAmount.toString(),
              assessedLateFeeMinor: pending.toString(),
              totalLateFeeMinor: newLateFeeAmount.toString(),
              ruleLateFeeTotalMinor: target.toString(),
              reason: `Configured ${rule.calculationType} late fee rule`,
            },
          },
        });
      });

      assessed.push({
        dueId: due.id,
        lateFeeAmountMinor: newLateFeeAmount.toString(),
        overdueDays,
      });
    }

    return {
      ruleConfigured: true,
      evaluatedCount: candidates.length,
      assessedCount: assessed.length,
      skippedCount,
      dues: assessed,
    };
  }

  /**
   * Waives an assessed late fee penalty (BR-CHG-003 / Edge Case 7).
   */
  async waiveLateFee(
    tenantId: string,
    adminUserId: string,
    dueId: string,
    dto: WaiveLateFeeDto,
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException(
        'Mandatory waiver reason is required to waive a late fee.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const due = await tx.due.findFirst({
        where: { id: dueId, tenantId },
      });

      if (!due) {
        throw new NotFoundException(`Due '${dueId}' not found in this tenant.`);
      }

      // Find settled late fee from prior allocations
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

      if (lateFeeAvailable <= ZERO) {
        throw new BadRequestException(
          'No outstanding unsettled late fee available to waive on this due.',
        );
      }

      let waiveAmount: bigint;
      if (dto.amountMinor) {
        waiveAmount = parseMinor(dto.amountMinor, 'amountMinor');

        if (waiveAmount <= ZERO) {
          throw new BadRequestException(
            'Waiver amount must be greater than zero.',
          );
        }

        if (waiveAmount > lateFeeAvailable) {
          throw new BadRequestException(
            `Waiver amount ${waiveAmount.toString()} exceeds available unsettled late fee ${lateFeeAvailable.toString()}.`,
          );
        }
      } else {
        waiveAmount = lateFeeAvailable;
      }

      const newLateFeeAmount = due.lateFeeAmount - waiveAmount;

      const updatedDue = await tx.due.update({
        where: { id: due.id },
        data: {
          lateFeeAmount: newLateFeeAmount,
        },
      });

      // Immutable financial ledger entry (LATE_FEE_WAIVED)
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: due.personId,
          eventType: 'LATE_FEE_WAIVED',
          referenceEntityType: 'Due',
          referenceEntityId: due.id,
          amount: waiveAmount,
          balanceSnapshot: due.balanceRemaining,
          performedByUserId: adminUserId,
          metadata: {
            dueId: due.id,
            waivedAmountMinor: waiveAmount.toString(),
            remainingLateFeeMinor: newLateFeeAmount.toString(),
            reason: dto.reason,
          },
        },
      });

      return serializeDue(updatedDue);
    });
  }
}

function serializeDue(due: Due) {
  return {
    ...due,
    netAmountMinor: due.netAmount.toString(),
    lateFeeAmountMinor: due.lateFeeAmount.toString(),
    balanceRemainingMinor: due.balanceRemaining.toString(),
  };
}

/**
 * Calendar date `YYYY-MM-DD` for an instant in the tenant's timezone.
 * Edge Case 7 requires due-date maths against `tenant.timezone`, not UTC.
 * An unknown zone is reported rather than silently falling back to UTC.
 */
export function resolveTenantDate(instant: Date, timezone: string): string {
  try {
    // en-CA renders ISO-like YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    throw new BadRequestException(
      `Tenant timezone '${timezone}' is not a valid IANA timezone.`,
    );
  }
}

function toDateString(value: Date): string {
  return value.toISOString().split('T')[0];
}

/** Whole calendar days from `from` to `to`; negative when not yet overdue. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return 0;
  }
  return Math.floor((b - a) / MS_PER_DAY);
}
