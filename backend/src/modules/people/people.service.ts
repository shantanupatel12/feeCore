import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { CreatePersonDto, UpdatePersonDto } from './dto/person.dto.js';
import { CustomFieldsService } from './custom-fields.service.js';
import {
  Person,
  PersonStatus,
  RecurringPlanStatus,
  CustomFieldDataType,
  CustomFieldDefinition,
  Prisma,
} from '@prisma/client';

const ZERO = BigInt(0);

export interface PaginatedPeople {
  items: Array<Omit<Person, 'advanceBalance'> & { advanceBalanceMinor: string }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customFieldsService: CustomFieldsService,
  ) {}

  /** True for an ISO `YYYY-MM-DD` string that is also a real calendar date. */
  private isIsoDate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [y, m, d] = value.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y &&
      probe.getUTCMonth() === m - 1 &&
      probe.getUTCDate() === d
    );
  }

  /**
   * Strict boolean parsing. The previous `Boolean(val)` coerced every
   * truthy value, so "banana" became `true` and the string "false"
   * became `true`. SRS "YES/NO" is only satisfied by a real boolean-ish
   * representation; anything else is a caller error, not a silent cast.
   */
  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return undefined;
    }
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', 'yes', '1'].includes(v)) return true;
      if (['false', 'no', '0'].includes(v)) return false;
    }
    return undefined;
  }

  /**
   * FR-CFD-02 / BR-12: validate `Person.customData` against the
   * authenticated tenant's own definitions.
   *
   * `definitions` is always loaded with a tenant filter, so a key defined
   * only for another tenant is rejected here as unknown rather than
   * silently accepted. Unknown keys are an error instead of being dropped,
   * because dropping them loses the caller's data without telling anyone.
   */
  private validateCustomData(
    customData: Record<string, any> | undefined,
    definitions: CustomFieldDefinition[],
    enforceRequired = true,
  ): Record<string, any> {
    const data = customData || {};
    const known = new Map(definitions.map((d) => [d.fieldKey, d]));

    for (const key of Object.keys(data)) {
      if (!known.has(key)) {
        throw new BadRequestException(
          `Unknown custom field '${key}' for this tenant. Define it before using it on a person.`,
        );
      }
    }

    const validated: Record<string, any> = {};

    for (const def of definitions) {
      const val = data[def.fieldKey];

      /*
       * `undefined`, `null` and `''` all mean "no value supplied". A
       * required field must have one; an optional field is simply omitted
       * from the result. On update the caller merges the stored values
       * first, so an explicit null clears a value rather than silently
       * dropping an unrelated one.
       */
      if (val === undefined || val === null || val === '') {
        if (def.isRequired && enforceRequired) {
          throw new BadRequestException(`Custom field '${def.fieldLabel}' (${def.fieldKey}) is required.`);
        }
        continue;
      }

      switch (def.dataType) {
        case CustomFieldDataType.NUMBER: {
          // Rejects '', ' ', booleans, NaN and Infinity rather than
          // coercing them into 0/1 via Number().
          const num = typeof val === 'number' ? val : typeof val === 'string' && val.trim() !== '' ? Number(val) : NaN;
          if (typeof val === 'boolean' || !Number.isFinite(num)) {
            throw new BadRequestException(`Field '${def.fieldLabel}' must be a number.`);
          }
          validated[def.fieldKey] = num;
          break;
        }
        case CustomFieldDataType.DATE: {
          if (!this.isIsoDate(val)) {
            throw new BadRequestException(
              `Field '${def.fieldLabel}' must be a date in YYYY-MM-DD format.`,
            );
          }
          validated[def.fieldKey] = val;
          break;
        }
        case CustomFieldDataType.BOOLEAN: {
          const parsed = this.parseBoolean(val);
          if (parsed === undefined) {
            throw new BadRequestException(
              `Field '${def.fieldLabel}' must be a yes/no boolean value.`,
            );
          }
          validated[def.fieldKey] = parsed;
          break;
        }
        case CustomFieldDataType.SELECT: {
          const options = (def.options as string[] | null) ?? [];
          if (!options.includes(String(val))) {
            throw new BadRequestException(
              `Field '${def.fieldLabel}' value '${val}' is not one of allowed options: [${options.join(', ')}].`,
            );
          }
          validated[def.fieldKey] = String(val);
          break;
        }
        default: {
          if (typeof val === 'object') {
            throw new BadRequestException(`Field '${def.fieldLabel}' must be text.`);
          }
          validated[def.fieldKey] = String(val);
          break;
        }
      }
    }

    return validated;
  }

  async create(tenantId: string, dto: CreatePersonDto) {
    const definitions = await this.customFieldsService.findAll(tenantId);
    const validatedCustomData = this.validateCustomData(dto.customData, definitions);

    // Primary phone uniqueness check within tenant
    const existing = await this.prisma.person.findFirst({
      where: { tenantId, primaryPhone: dto.primaryPhone },
    });

    if (existing) {
      throw new ConflictException(`A person with primary phone '${dto.primaryPhone}' already exists in this tenant.`);
    }

    const person = await this.prisma.person.create({
      data: {
        tenantId,
        fullName: dto.fullName,
        primaryPhone: dto.primaryPhone,
        secondaryPhone: dto.secondaryPhone || null,
        email: dto.email || null,
        address: dto.address || null,
        customData: validatedCustomData,
        advanceBalance: BigInt(0),
      },
    });

    const { advanceBalance, ...rest } = person;
    return {
      ...rest,
      advanceBalanceMinor: advanceBalance.toString(),
    };
  }

  /**
   * FR-PER-03: soft deactivation of a Person.
   *
   * Sets `status = INACTIVE` and suspends the Person's active recurring
   * plans (BR-REC-004). Nothing is deleted or rewritten: dues, payments,
   * allocations, refunds, receipts, the financial ledger, the advance
   * balance and `customData` are left exactly as they are, which is what
   * Edge Case 11 requires ("financial history & reports remain fully
   * queryable") and what BR-CORE-002's zero-hard-deletion rule demands.
   *
   * Pre-existing dues stay collectable (Edge Case 11), so nothing here
   * touches balances.
   *
   * Idempotent: deactivating an already inactive Person is a no-op that
   * returns the same state rather than an error. There is no documented
   * state-machine transition table for Person (`state-models.md` names a
   * "Person State Machine" but defines no states or transitions), so no
   * new error contract is invented here.
   */
  async deactivate(tenantId: string, id: string) {
    const person = await this.prisma.person.findFirst({
      where: { id, tenantId },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID '${id}' not found.`);
    }

    if (person.status === PersonStatus.INACTIVE) {
      const { advanceBalance, ...rest } = person;
      return {
        ...rest,
        advanceBalanceMinor: advanceBalance.toString(),
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const deactivated = await tx.person.update({
        where: { id: person.id },
        data: { status: PersonStatus.INACTIVE },
      });

      // BR-REC-004: active plans are suspended so no further billing
      // cycles are generated for this person.
      await tx.recurringPlan.updateMany({
        where: {
          tenantId,
          personId: person.id,
          status: RecurringPlanStatus.ACTIVE,
        },
        data: { status: RecurringPlanStatus.PAUSED },
      });

      return deactivated;
    });

    const { advanceBalance, ...rest } = updated;
    return {
      ...rest,
      advanceBalanceMinor: advanceBalance.toString(),
    };
  }

  async findAll(
    tenantId: string,
    query?: { search?: string; status?: string; page?: number; limit?: number },
  ): Promise<PaginatedPeople> {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;

    const whereClause: any = { tenantId };

    if (query?.status) {
      whereClause.status = query.status;
    }

    if (query?.search) {
      const q = query.search.trim();
      whereClause.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { primaryPhone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.person.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.person.count({ where: whereClause }),
    ]);

    return {
      items: items.map((p) => {
        const { advanceBalance, ...rest } = p;
        return {
          ...rest,
          advanceBalanceMinor: advanceBalance.toString(),
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const person = await this.prisma.person.findFirst({
      where: { id, tenantId },
      include: {
        dues: {
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID '${id}' not found.`);
    }

    const { advanceBalance, ...safePerson } = person;
    return {
      ...safePerson,
      advanceBalanceMinor: advanceBalance.toString(),
      dues: person.dues.map((d) => {
        const { netAmount, lateFeeAmount, balanceRemaining, ...restD } = d;
        return {
          ...restD,
          netAmountMinor: netAmount.toString(),
          lateFeeAmountMinor: lateFeeAmount.toString(),
          balanceRemainingMinor: balanceRemaining.toString(),
        };
      }),
    };
  }

  async update(tenantId: string, id: string, dto: UpdatePersonDto) {
    const person = await this.prisma.person.findFirst({
      where: { id, tenantId },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID '${id}' not found.`);
    }

    let validatedCustomData = person.customData as unknown as Prisma.InputJsonValue;
    if (dto.customData !== undefined) {
      const definitions = await this.customFieldsService.findAll(tenantId);

      /*
       * Only the incoming keys are validated against the tenant schema.
       * The stored values are then merged underneath, so a value left
       * behind by a since-removed definition keeps working instead of
       * making the person permanently unupdatable.
       */
      /*
       * Requiredness is NOT enforced on this pass: the incoming body is a
       * partial patch, so an omitted required field is not a violation.
       * It is checked against the merged result below instead, which also
       * stops a required value being cleared to null.
       */
      const incoming = this.validateCustomData(dto.customData, definitions, false);
      const merged: Record<string, unknown> = {
        ...(person.customData as Record<string, unknown>),
        ...incoming,
      };

      /*
       * An explicit null / empty value in the patch clears that key, which
       * is different from omitting it. The required check below refuses the
       * clear for a required field, so this cannot silently empty one.
       */
      for (const [key, value] of Object.entries(dto.customData as Record<string, unknown>)) {
        if (value === null || value === undefined || value === '') {
          delete merged[key];
        }
      }

      /*
       * Requiredness is enforced against the final merged state, so a
       * create/update cannot leave a required field empty, and omitting a
       * required field from an update is not a way to erase it.
       */
      for (const def of definitions) {
        const value = merged[def.fieldKey];
        if (def.isRequired && (value === undefined || value === null || value === '')) {
          throw new BadRequestException(
            `Custom field '${def.fieldLabel}' (${def.fieldKey}) is required.`,
          );
        }
      }

      validatedCustomData = merged as unknown as Prisma.InputJsonValue;
    }

    if (dto.primaryPhone && dto.primaryPhone !== person.primaryPhone) {
      const existing = await this.prisma.person.findFirst({
        where: { tenantId, primaryPhone: dto.primaryPhone, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException(`Primary phone '${dto.primaryPhone}' is already in use by another person.`);
      }
    }

    const updated = await this.prisma.person.update({
      where: { id },
      data: {
        fullName: dto.fullName !== undefined ? dto.fullName : undefined,
        primaryPhone: dto.primaryPhone !== undefined ? dto.primaryPhone : undefined,
        secondaryPhone: dto.secondaryPhone !== undefined ? dto.secondaryPhone : undefined,
        email: dto.email !== undefined ? dto.email : undefined,
        address: dto.address !== undefined ? dto.address : undefined,
        customData: validatedCustomData as any,
      },
    });

    const { advanceBalance, ...rest } = updated;
    return {
      ...rest,
      advanceBalanceMinor: advanceBalance.toString(),
    };
  }

  /**
   * Unified financial statement (FR-PER-04).
   *
   * Read-only view over the records the financial services already
   * maintain. Every figure below is read from its authoritative
   * column rather than recomputed:
   *
   *   dues        -> Due.balanceRemaining / netAmount / lateFeeAmount (BR-DUE-001)
   *   payments    -> Payment.totalAmount / allocatedToDues / creditedToAdvance
   *   allocations -> PaymentAllocation.allocatedPrincipal / allocatedLateFee /
   *                  totalAllocated / refundedAmount
   *   refunds     -> Refund.refundAmount
   *   advance     -> Person.advanceBalance (BR-ADV-001)
   *   history     -> FinancialTransactionLog (BR-13, non-repudiable trail)
   *
   * Allocations are reached through the person's own dues and payments
   * are matched on both personId and tenantId, so no record can leak
   * across a tenant boundary even if the underlying data is malformed.
   */
  async getStatement(tenantId: string, personId: string) {
    // Tenant-scoped ownership: a foreign id is indistinguishable
    // from an absent one, matching this service's existing convention.
    const person = await this.prisma.person.findFirst({
      where: { id: personId, tenantId },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID '${personId}' not found.`);
    }

    const [dues, payments, refunds, ledger] = await Promise.all([
      this.prisma.due.findMany({
        where: { personId: person.id, tenantId },
        include: { paymentAllocations: true },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.payment.findMany({
        where: { personId: person.id, tenantId },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.refund.findMany({
        where: { personId: person.id, tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.financialTransactionLog.findMany({
        where: { personId: person.id, tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    let outstandingDue = ZERO;
    let netDue = ZERO;
    let lateFeeTotal = ZERO;
    let allocatedToDues = ZERO;
    let allocatedPrincipal = ZERO;
    let allocatedLateFee = ZERO;
    let allocationRefunded = ZERO;

    for (const due of dues) {
      outstandingDue += due.balanceRemaining;
      netDue += due.netAmount;
      lateFeeTotal += due.lateFeeAmount;

      for (const alloc of due.paymentAllocations) {
        allocatedToDues += alloc.totalAllocated;
        allocatedPrincipal += alloc.allocatedPrincipal;
        allocatedLateFee += alloc.allocatedLateFee;
        allocationRefunded += alloc.refundedAmount;
      }
    }

    let paymentsCollected = ZERO;
    let creditedToAdvance = ZERO;
    for (const payment of payments) {
      paymentsCollected += payment.totalAmount;
      creditedToAdvance += payment.creditedToAdvance;
    }

    let refundedTotal = ZERO;
    let dueAllocationRefunded = ZERO;
    let advanceWalletRefunded = ZERO;
    for (const refund of refunds) {
      refundedTotal += refund.refundAmount;
      if (refund.refundType === 'ADVANCE_WALLET') {
        advanceWalletRefunded += refund.refundAmount;
      } else {
        dueAllocationRefunded += refund.refundAmount;
      }
    }

    return {
      person: {
        id: person.id,
        fullName: person.fullName,
        primaryPhone: person.primaryPhone,
        email: person.email,
        status: person.status,
        // Authoritative wallet balance (BR-ADV-001).
        advanceBalanceMinor: person.advanceBalance.toString(),
      },
      dues: dues.map((due) => ({
        id: due.id,
        chargeId: due.chargeId,
        dueDate: due.dueDate.toISOString().slice(0, 10),
        status: due.status,
        netAmountMinor: due.netAmount.toString(),
        lateFeeAmountMinor: due.lateFeeAmount.toString(),
        balanceRemainingMinor: due.balanceRemaining.toString(),
        allocations: due.paymentAllocations.map((alloc) => ({
          id: alloc.id,
          paymentId: alloc.paymentId,
          allocatedPrincipalMinor: alloc.allocatedPrincipal.toString(),
          allocatedLateFeeMinor: alloc.allocatedLateFee.toString(),
          totalAllocatedMinor: alloc.totalAllocated.toString(),
          refundedAmountMinor: alloc.refundedAmount.toString(),
          createdAt: alloc.createdAt.toISOString(),
        })),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        paymentMode: payment.paymentMode,
        status: payment.status,
        referenceNumber: payment.referenceNumber,
        // Kept distinct from allocations so the same money is never
        // counted twice at two different levels of the statement.
        totalAmountMinor: payment.totalAmount.toString(),
        allocatedToDuesMinor: payment.allocatedToDues.toString(),
        creditedToAdvanceMinor: payment.creditedToAdvance.toString(),
        paymentDate: payment.paymentDate.toISOString(),
      })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        refundType: refund.refundType,
        refundAmountMinor: refund.refundAmount.toString(),
        refundMode: refund.refundMode,
        refundReason: refund.refundReason,
        referenceNumber: refund.referenceNumber,
        paymentId: refund.paymentId,
        paymentAllocationId: refund.paymentAllocationId,
        createdAt: refund.createdAt.toISOString(),
      })),
      /*
       * The immutable ledger is the BR-13 trail: it already carries
       * charge, payment, allocation, advance and refund events for this
       * person, so it is surfaced rather than rebuilt.
       */
      ledger: ledger.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        referenceEntityType: entry.referenceEntityType,
        referenceEntityId: entry.referenceEntityId,
        amountMinor: entry.amount.toString(),
        balanceSnapshotMinor: entry.balanceSnapshot.toString(),
        metadata: entry.metadata,
        performedByUserId: entry.performedByUserId,
        createdAt: entry.createdAt.toISOString(),
      })),
      totals: {
        netDueMinor: netDue.toString(),
        lateFeeMinor: lateFeeTotal.toString(),
        outstandingDueMinor: outstandingDue.toString(),
        paymentsCollectedMinor: paymentsCollected.toString(),
        allocatedToDuesMinor: allocatedToDues.toString(),
        allocatedPrincipalMinor: allocatedPrincipal.toString(),
        allocatedLateFeeMinor: allocatedLateFee.toString(),
        creditedToAdvanceMinor: creditedToAdvance.toString(),
        advanceBalanceMinor: person.advanceBalance.toString(),
        refundedMinor: refundedTotal.toString(),
        dueAllocationRefundedMinor: dueAllocationRefunded.toString(),
        advanceWalletRefundedMinor: advanceWalletRefunded.toString(),
        allocationRefundedMinor: allocationRefunded.toString(),
      },
    };
  }
}
