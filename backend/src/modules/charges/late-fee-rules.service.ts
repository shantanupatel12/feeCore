import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import {
  CreateLateFeeRuleDto,
  UpdateLateFeeRuleDto,
} from './dto/late-fee-rule.dto.js';
import { LateFeeCalculationType, LateFeeRule } from '@prisma/client';

const ZERO = BigInt(0);

/**
 * FR-CHG-03 / BR-CHG-003 late fee rule configuration.
 *
 * The repository documents no rule-scoping dimension (no per-category or
 * per-plan selection anywhere in SRS §11.12, BR-CHG-003 or the traceability
 * matrix), and state-models.md says a fee is assessed "if configured". That
 * makes the configured rule tenant-wide, so the schema enforces one rule per
 * tenant with `uq_late_fee_rule_per_tenant` and evaluation stays
 * deterministic without inventing a selection rule.
 */
@Injectable()
export class LateFeeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parses minor units, rejecting anything BigInt would silently accept. */
  private parseMinor(raw: string, field: string): bigint {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
      throw new BadRequestException(
        `${field} must be a non-negative integer amount in minor units.`,
      );
    }
    return BigInt(raw.trim());
  }

  private requirePositive(amount: bigint, field: string) {
    if (amount <= ZERO) {
      throw new BadRequestException(`${field} must be greater than zero.`);
    }
  }

  async create(tenantId: string, dto: CreateLateFeeRuleDto): Promise<LateFeeRule> {
    const amountMinor = this.parseMinor(dto.amountMinor, 'amountMinor');
    this.requirePositive(amountMinor, 'amountMinor');

    const existing = await this.prisma.lateFeeRule.findFirst({ where: { tenantId } });
    if (existing) {
      throw new ConflictException(
        'This tenant already has a late fee rule configured. Update it instead.',
      );
    }

    return this.prisma.lateFeeRule.create({
      data: { tenantId, calculationType: dto.calculationType, amountMinor },
    });
  }

  async findAll(tenantId: string): Promise<LateFeeRule[]> {
    return this.prisma.lateFeeRule.findMany({ where: { tenantId } });
  }

  async findOne(tenantId: string, id: string): Promise<LateFeeRule> {
    const rule = await this.prisma.lateFeeRule.findFirst({ where: { id, tenantId } });
    if (!rule) {
      throw new NotFoundException(`Late fee rule '${id}' not found.`);
    }
    return rule;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateLateFeeRuleDto,
  ): Promise<LateFeeRule> {
    const current = await this.findOne(tenantId, id);

    const amountMinor =
      dto.amountMinor !== undefined
        ? this.parseMinor(dto.amountMinor, 'amountMinor')
        : current.amountMinor;
    this.requirePositive(amountMinor, 'amountMinor');

    return this.prisma.lateFeeRule.update({
      where: { id: current.id },
      data: {
        calculationType: dto.calculationType ?? undefined,
        amountMinor,
      },
    });
  }
}

/**
 * Total late fee the configured rule has accrued for a Due as of `overdueDays`.
 *
 * Exported so the evaluator and its tests share one definition of the
 * documented formula:
 *   FIXED  -> D_fixed                (charged once, on the first overdue day)
 *   DAILY  -> floor(D_day * days)   (days = calendar days past the due date)
 *
 * Never negative: DAILY with zero overdue days yields 0.
 */
export function calculateRuleLateFee(
  calculationType: LateFeeCalculationType,
  amountMinor: bigint,
  overdueDays: number,
): bigint {
  if (amountMinor < ZERO || overdueDays < 0) {
    return ZERO;
  }
  if (calculationType === LateFeeCalculationType.DAILY) {
    return amountMinor * BigInt(overdueDays);
  }
  return amountMinor;
}