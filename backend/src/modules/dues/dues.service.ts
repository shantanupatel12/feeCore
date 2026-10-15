import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { QueryDuesDto, GenerateDuesDto } from './dto/due.dto.js';
import { DueStatus, RecurringFrequency, RecurringPlanStatus } from '@prisma/client';
import {
  resolveTenantDate,
  daysBetween,
} from '../payments/services/late-fee.service.js';

@Injectable()
export class DuesService {
  private readonly logger = new Logger(DuesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to format cycle period keys deterministically for idempotency
   */
  public getCyclePeriodKey(frequency: RecurringFrequency, date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    switch (frequency) {
      case RecurringFrequency.DAILY:
        return `${year}-${month}-${day}`;
      case RecurringFrequency.WEEKLY: {
        const tempDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const dayNum = tempDate.getUTCDay() || 7;
        tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((tempDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
        return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      case RecurringFrequency.MONTHLY:
        return `${year}-${month}`;
      case RecurringFrequency.QUARTERLY: {
        const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
        return `${year}-Q${quarter}`;
      }
      case RecurringFrequency.YEARLY:
        return `${year}`;
      default:
        return `${year}-${month}`;
    }
  }

  /**
   * Helper to calculate next target due date given frequency and current date, with UTC month-end clamping.
   */
  public getNextDueDate(frequency: RecurringFrequency, currentDate: Date, anchorDay: number): Date {
    const year = currentDate.getUTCFullYear();
    const month = currentDate.getUTCMonth();
    const day = currentDate.getUTCDate();

    switch (frequency) {
      case RecurringFrequency.DAILY: {
        return new Date(Date.UTC(year, month, day + 1));
      }
      case RecurringFrequency.WEEKLY: {
        return new Date(Date.UTC(year, month, day + 7));
      }
      case RecurringFrequency.MONTHLY: {
        const targetMonth = month + 1;
        const targetYear = year + Math.floor(targetMonth / 12);
        const monthInYear = (targetMonth + 12) % 12;
        const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, monthInYear + 1, 0)).getUTCDate();
        const targetDay = Math.min(anchorDay, lastDayOfTargetMonth);
        return new Date(Date.UTC(targetYear, monthInYear, targetDay));
      }
      case RecurringFrequency.QUARTERLY: {
        const targetMonth = month + 3;
        const targetYear = year + Math.floor(targetMonth / 12);
        const monthInYear = (targetMonth + 12) % 12;
        const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, monthInYear + 1, 0)).getUTCDate();
        const targetDay = Math.min(anchorDay, lastDayOfTargetMonth);
        return new Date(Date.UTC(targetYear, monthInYear, targetDay));
      }
      case RecurringFrequency.YEARLY: {
        const targetYear = year + 1;
        const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
        const targetDay = Math.min(anchorDay, lastDayOfTargetMonth);
        return new Date(Date.UTC(targetYear, month, targetDay));
      }
      default:
        return new Date(currentDate);
    }
  }

  /**
   * Calendar day `YYYY-MM-DD` in the tenant's own timezone.
   *
   * `docs/edge-cases.md` ("Timezone Normalization") requires due-date maths to
   * run against `tenant.timezone`, not the UTC server clock. The canonical
   * `resolveTenantDate` helper from the late-fee path is reused so both
   * features cannot drift apart.
   */
  public async resolveToday(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return resolveTenantDate(new Date(), tenant?.timezone ?? 'UTC');
  }

  /**
   * Evaluates due status dynamically based on balance remaining & calendar due
   * date.
   *
   * FR-DUE-01 / BR-10: `CurrentDate > due_date AND balance_remaining > 0` is
   * OVERDUE. `today` must be the tenant's calendar date from `resolveToday`.
   * The UTC fallback remains only as a defensive default for a caller with no
   * tenant context; every in-app caller resolves the tenant date first, so a
   * refund cannot persist a status that `GET /dues` would not agree with.
   *
   * This is a display/query classification only: it never persists anything.
   */
  public evaluateStatus(
    dueDate: Date,
    netAmount: bigint,
    balanceRemaining: bigint,
    currentStatus: DueStatus,
    today?: string,
  ): DueStatus {
    if (currentStatus === DueStatus.VOIDED) return DueStatus.VOIDED;
    if (balanceRemaining === BigInt(0)) return DueStatus.PAID;

    // `dueDate` is a Postgres `date`, returned at UTC midnight, so the ISO
    // date is exactly the stored calendar day.
    const dueStr = dueDate.toISOString().slice(0, 10);
    const todayStr = today ?? new Date().toISOString().slice(0, 10);

    if (balanceRemaining > BigInt(0) && daysBetween(dueStr, todayStr) >= 1) {
      return DueStatus.OVERDUE;
    }

    if (balanceRemaining < netAmount) {
      return DueStatus.PARTIALLY_PAID;
    }

    return DueStatus.PENDING;
  }

  /**
   * Due Generation Engine: Generates dues for active recurring plans up to targetDate
   */
  async generateDues(tenantId: string, dto: GenerateDuesDto) {
    const targetDate = dto.targetDate ? new Date(dto.targetDate) : new Date();

    const planWhere: any = {
      tenantId,
      status: RecurringPlanStatus.ACTIVE,
      person: { status: 'ACTIVE' }, // Automatically skip inactive people (BR-REC-004)
    };

    if (dto.recurringPlanId) {
      planWhere.id = dto.recurringPlanId;
    }

    const plans = await this.prisma.recurringPlan.findMany({
      where: planWhere,
      include: { person: true },
    });

    let generatedCount = 0;
    let skippedCount = 0;
    const generatedDues: any[] = [];

    // Find a valid admin/collector user for createdByUserId on auto-generated charges
    const systemUser = await this.prisma.user.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    if (!systemUser) {
      throw new NotFoundException(`No valid user found for tenant '${tenantId}' to record charge creation.`);
    }

    const creatorUserId = systemUser.id;

    for (const plan of plans) {
      let currentExec = new Date(plan.nextExecutionDate);

      while (currentExec <= targetDate) {
        if (plan.endDate && currentExec > plan.endDate) {
          // Auto complete plan if endDate exceeded
          await this.prisma.recurringPlan.update({
            where: { id: plan.id },
            data: { status: RecurringPlanStatus.COMPLETED },
          });
          break;
        }

        const periodKey = this.getCyclePeriodKey(plan.frequency, currentExec);

        try {
          // Atomic transaction generating Charge + Due with compound unique idempotency constraint
          const result = await this.prisma.$transaction(async (tx) => {
            const charge = await tx.charge.create({
              data: {
                tenantId,
                personId: plan.personId,
                recurringPlanId: plan.id,
                category: plan.category,
                description: `Recurring ${plan.frequency} fee for period ${periodKey}`,
                baseAmount: plan.baseAmount,
                discountAmount: BigInt(0),
                createdByUserId: creatorUserId,
              },
            });

            const due = await tx.due.create({
              data: {
                tenantId,
                personId: plan.personId,
                chargeId: charge.id,
                recurringPlanId: plan.id,
                cyclePeriodKey: periodKey,
                dueDate: currentExec,
                netAmount: plan.baseAmount,
                lateFeeAmount: BigInt(0),
                balanceRemaining: plan.baseAmount,
                status: DueStatus.PENDING,
              },
            });

            return due;
          });

          generatedCount++;
          generatedDues.push({
            ...result,
            netAmountMinor: result.netAmount.toString(),
            lateFeeAmountMinor: result.lateFeeAmount.toString(),
            balanceRemainingMinor: result.balanceRemaining.toString(),
          });
        } catch (err: any) {
          // Code P2002: Unique constraint failed (uq_recurring_due_idempotency) -> clean skip!
          if (err.code === 'P2002') {
            skippedCount++;
            this.logger.log(`Skipped existing due for plan ${plan.id}, period ${periodKey}`);
          } else {
            throw err;
          }
        }

        // Advance to next execution date
        currentExec = this.getNextDueDate(plan.frequency, currentExec, plan.anchorDay);

        // Update plan's next execution date
        await this.prisma.recurringPlan.update({
          where: { id: plan.id },
          data: { nextExecutionDate: currentExec },
        });
      }
    }

    return {
      generatedCount,
      skippedCount,
      generatedDues,
    };
  }

  async findAll(tenantId: string, query?: QueryDuesDto) {
    /*
     * FR-DUE-01 filtering fix: `status` is a *real-time* classification, but
     * the stored column only becomes OVERDUE when a late-fee rule is evaluated.
     * Filtering OVERDUE in SQL against that column therefore hid genuinely
     * overdue dues from tenants with no rule. OVERDUE is delegated to the
     * shared overdue query so the two entry points cannot drift; every other
     * status keeps its existing stored-column behaviour.
     */
    if (query?.status === DueStatus.OVERDUE) {
      return this.listOverdue(tenantId, query);
    }

    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query?.personId) where.personId = query.personId;
    if (query?.status) where.status = query.status;

    if (query?.search) {
      const q = query.search.trim();
      where.person = {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { primaryPhone: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.due.findMany({
        where,
        orderBy: { dueDate: 'asc' },
        skip,
        take: limit,
        include: {
          person: {
            select: { id: true, fullName: true, primaryPhone: true },
          },
          charge: {
            select: { category: true, description: true },
          },
        },
      }),
      this.prisma.due.count({ where }),
    ]);

    // Apply dynamic status evaluation for display (e.g., pending -> overdue if date passed)
    const today = await this.resolveToday(tenantId);
    const evaluatedItems = items.map((due) => this.serializeDue(due, today));

    return {
      items: evaluatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Canonical Due response shape, shared by `findAll` and `findOverdue` so both
   * endpoints serialise a Due identically. BIGINT money is exposed as exact
   * minor-unit strings per BR-CORE-001.
   */
  private serializeDue(
    due: {
      dueDate: Date;
      netAmount: bigint;
      lateFeeAmount: bigint;
      balanceRemaining: bigint;
      status: DueStatus;
    },
    today: string,
  ) {
    const currentStatus = this.evaluateStatus(
      due.dueDate,
      due.netAmount,
      due.balanceRemaining,
      due.status,
      today,
    );

    return {
      ...due,
      status: currentStatus,
      netAmountMinor: due.netAmount.toString(),
      lateFeeAmountMinor: due.lateFeeAmount.toString(),
      balanceRemainingMinor: due.balanceRemaining.toString(),
    };
  }

  /**
   * FR-DUE-02: `GET /api/v1/dues/overdue`.
   *
   * A Due is overdue when the current date is after its due date and its
   * remaining balance is positive. The result deliberately does not depend on
   * the stored `Due.status`, nor on a late-fee rule existing, nor on a late
   * fee having been assessed: `LateFeeService` persists `status = OVERDUE`
   * only while evaluating a rule, so a tenant with no rule would otherwise
   * never report its overdue dues.
   *
   * Strictly read-only: nothing here writes to any table.
   *
   * The calendar comparison runs in the tenant's timezone
   * (`docs/edge-cases.md` "Timezone Normalization") through the same
   * `resolveTenantDate`/`daysBetween` helpers the late-fee path uses, so the
   * two features cannot drift apart. VOIDED dues are excluded, matching every
   * other overdue path in the codebase.
   *
   * `query.status` is intentionally ignored: every returned row is overdue by
   * construction.
   */
  async findOverdue(tenantId: string, query?: QueryDuesDto) {
    return this.listOverdue(tenantId, query);
  }

  /**
   * The single implementation of "genuinely overdue" dues, shared by
   * `GET /dues/overdue` (FR-DUE-02) and the `?status=OVERDUE` filter of
   * `GET /dues` (FR-DUE-01) so there is one definition, not two.
   */
  private async listOverdue(tenantId: string, query?: QueryDuesDto) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));

    const today = await this.resolveToday(tenantId);

    const where: any = {
      tenantId,
      // Only a positive balance can be overdue; a zero balance is settled.
      balanceRemaining: { gt: BigInt(0) },
      status: { notIn: [DueStatus.VOIDED] },
    };

    if (query?.personId) where.personId = query.personId;
    if (query?.search) {
      const q = query.search.trim();
      where.person = {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { primaryPhone: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    /*
     * `dueDate` is a Postgres `date`, so Prisma returns it at UTC midnight and
     * the ISO date is exactly the stored calendar day. The date test is applied
     * in JS rather than in SQL because "today" depends on the tenant timezone,
     * which the database does not know about.
     */
    const candidates = await this.prisma.due.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        person: {
          select: { id: true, fullName: true, primaryPhone: true },
        },
        charge: {
          select: { category: true, description: true },
        },
      },
    });

    // FR-DUE-02: CurrentDate > DueDate AND BalanceRemaining > 0.
    const overdue = candidates.filter(
      (due) => daysBetween(due.dueDate.toISOString().slice(0, 10), today) >= 1,
    );

    const total = overdue.length;
    const start = (page - 1) * limit;

    return {
      items: overdue.slice(start, start + limit).map((due) => ({
        ...due,
        // The filter above *is* the FR-DUE-02 classification, so the reported
        // status is OVERDUE by definition. Re-deriving it through
        // `evaluateStatus` would compare UTC dates instead of the tenant's
        // calendar day and could contradict this endpoint's own predicate.
        status: DueStatus.OVERDUE,
        netAmountMinor: due.netAmount.toString(),
        lateFeeAmountMinor: due.lateFeeAmount.toString(),
        balanceRemainingMinor: due.balanceRemaining.toString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const due = await this.prisma.due.findFirst({
      where: { id, tenantId },
      include: {
        person: true,
        charge: true,
      },
    });

    if (!due) {
      throw new NotFoundException(`Due '${id}' not found.`);
    }

    const currentStatus = this.evaluateStatus(
      due.dueDate,
      due.netAmount,
      due.balanceRemaining,
      due.status,
      await this.resolveToday(tenantId),
    );

    return {
      ...due,
      status: currentStatus,
      netAmountMinor: due.netAmount.toString(),
      lateFeeAmountMinor: due.lateFeeAmount.toString(),
      balanceRemainingMinor: due.balanceRemaining.toString(),
    };
  }
}
