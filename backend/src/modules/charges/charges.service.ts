import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { CreateChargeDto } from './dto/charge.dto.js';
import { Charge, DueStatus, PersonStatus } from '@prisma/client';

@Injectable()
export class ChargesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parses a minor-unit amount (BR-CORE-001 tier 2: `bigint` primitives).
   *
   * BigInt() throws a SyntaxError on 'abc' or accepts '12.5' by truncating,
   * so the input is constrained to a plain non-negative integer first and
   * turned into a 400 rather than an unhandled 500.
   */
  private parseMinorUnits(value: string | undefined, field: string): bigint {
    if (value === undefined || value === null) {
      return BigInt(0);
    }
    const trimmed = String(value).trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new BadRequestException(
        `${field} must be a non-negative integer amount in minor units.`,
      );
    }
    return BigInt(trimmed);
  }

  /**
   * Resolves the discount to an absolute minor-unit amount (BR-CHG-002).
   *
   * Percentage uses floor(BaseAmount * P / 100). BigInt division truncates
   * toward zero, which is floor for these non-negative operands, so the
   * tenant never loses a minor unit to rounding.
   */
  private resolveDiscount(
    baseAmount: bigint,
    dto: CreateChargeDto,
  ): { discountAmount: bigint; discountPercent?: number } {
    const hasFixed = dto.discountAmountMinor !== undefined;
    const hasPercent = dto.discountPercent !== undefined;

    if (hasFixed && hasPercent) {
      throw new BadRequestException(
        'Provide either discountAmountMinor or discountPercent, not both.',
      );
    }

    if (hasPercent) {
      const p = dto.discountPercent as number;
      if (!Number.isInteger(p) || p <= 0 || p > 100) {
        throw new BadRequestException('discountPercent must be an integer between 1 and 100.');
      }
      return { discountAmount: (baseAmount * BigInt(p)) / BigInt(100), discountPercent: p };
    }

    return { discountAmount: this.parseMinorUnits(dto.discountAmountMinor, 'discountAmountMinor') };
  }

  async createOneTimeCharge(tenantId: string, userId: string, dto: CreateChargeDto) {
    const baseAmount = this.parseMinorUnits(dto.baseAmountMinor, 'baseAmountMinor');

    if (baseAmount <= BigInt(0)) {
      throw new BadRequestException('Base amount must be greater than zero.');
    }

    const { discountAmount, discountPercent } = this.resolveDiscount(baseAmount, dto);

    if (discountAmount < BigInt(0) || discountAmount > baseAmount) {
      throw new BadRequestException('Discount amount cannot be negative or exceed base amount.');
    }

    const netAmount = baseAmount - discountAmount;
    const dueDate = new Date(dto.dueDate);

    // Verify Person exists and belongs to tenant
    const person = await this.prisma.person.findFirst({
      where: { id: dto.personId, tenantId },
    });

    if (!person) {
      throw new NotFoundException(`Person '${dto.personId}' not found in this tenant.`);
    }

    /*
     * FR-PER-03 / Edge Case 11: a deactivated person cannot take on new
     * charges. Settling their existing dues stays permitted, which is why
     * this blocks only charge creation.
     */
    if (person.status !== PersonStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'Cannot create charges for an inactive person',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Charge record
      const charge = await tx.charge.create({
        data: {
          tenantId,
          personId: dto.personId,
          category: dto.category,
          description: dto.description || null,
          baseAmount,
          discountAmount,
          createdByUserId: userId,
        },
      });

      // 2. Immediately create corresponding Due record
      const due = await tx.due.create({
        data: {
          tenantId,
          personId: dto.personId,
          chargeId: charge.id,
          dueDate,
          netAmount,
          lateFeeAmount: BigInt(0),
          balanceRemaining: netAmount,
          status: DueStatus.PENDING,
        },
      });

      // 3. Log into Immutable Financial Transaction Ledger
      await tx.financialTransactionLog.create({
        data: {
          tenantId,
          personId: dto.personId,
          eventType: 'CHARGE_CREATED',
          referenceEntityType: 'Charge',
          referenceEntityId: charge.id,
          amount: netAmount,
          balanceSnapshot: person.advanceBalance,
          performedByUserId: userId,
          metadata: {
            category: dto.category,
            baseAmount: baseAmount.toString(),
            discountAmount: discountAmount.toString(),
            netAmount: netAmount.toString(),
            // Only recorded when the discount was expressed as a
            // percentage; the stored column is always the resolved amount.
            ...(discountPercent !== undefined
              ? { discountPercent: String(discountPercent) }
              : {}),
            dueId: due.id,
          },
        },
      });

      return {
        charge: {
          id: charge.id,
          tenantId: charge.tenantId,
          personId: charge.personId,
          recurringPlanId: charge.recurringPlanId,
          category: charge.category,
          description: charge.description,
          baseAmountMinor: charge.baseAmount.toString(),
          discountAmountMinor: charge.discountAmount.toString(),
          netAmountMinor: (charge.baseAmount - charge.discountAmount).toString(),
          createdByUserId: charge.createdByUserId,
          createdAt: charge.createdAt,
        },
        due: {
          id: due.id,
          tenantId: due.tenantId,
          personId: due.personId,
          chargeId: due.chargeId,
          recurringPlanId: due.recurringPlanId,
          cyclePeriodKey: due.cyclePeriodKey,
          dueDate: due.dueDate,
          netAmountMinor: due.netAmount.toString(),
          lateFeeAmountMinor: due.lateFeeAmount.toString(),
          ruleLateFeeAmountMinor: due.ruleLateFeeAmount.toString(),
          balanceRemainingMinor: due.balanceRemaining.toString(),
          status: due.status,
          createdAt: due.createdAt,
          updatedAt: due.updatedAt,
        },
      };
    });
  }

  async findAll(tenantId: string, query?: { personId?: string; category?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (query?.personId) where.personId = query.personId;
    if (query?.category) where.category = query.category;

    const [items, total] = await Promise.all([
      this.prisma.charge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          person: {
            select: { id: true, fullName: true, primaryPhone: true },
          },
        },
      }),
      this.prisma.charge.count({ where }),
    ]);

    return {
      items: items.map((c) => {
        const { baseAmount, discountAmount, ...rest } = c;
        return {
          ...rest,
          baseAmountMinor: baseAmount.toString(),
          discountAmountMinor: discountAmount.toString(),
          netAmountMinor: (baseAmount - discountAmount).toString(),
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
