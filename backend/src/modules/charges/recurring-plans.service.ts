import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { CreateRecurringPlanDto, UpdateRecurringPlanDto } from './dto/recurring-plan.dto.js';
import { RecurringPlan, RecurringPlanStatus } from '@prisma/client';

@Injectable()
export class RecurringPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateRecurringPlanDto) {
    const baseAmountBigInt = BigInt(dto.baseAmountMinor);
    if (baseAmountBigInt <= BigInt(0)) {
      throw new BadRequestException('Base amount must be greater than zero.');
    }

    const person = await this.prisma.person.findFirst({
      where: { id: dto.personId, tenantId },
    });

    if (!person) {
      throw new NotFoundException(`Person '${dto.personId}' not found.`);
    }

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;

    const plan = await this.prisma.recurringPlan.create({
      data: {
        tenantId,
        personId: dto.personId,
        category: dto.category,
        baseAmount: baseAmountBigInt,
        frequency: dto.frequency,
        anchorDay: dto.anchorDay ?? startDate.getDate(),
        startDate,
        endDate,
        nextExecutionDate: startDate,
        status: RecurringPlanStatus.ACTIVE,
      },
    });

    const { baseAmount, ...rest } = plan;
    return {
      ...rest,
      baseAmountMinor: baseAmount.toString(),
    };
  }

  async findAll(tenantId: string, query?: { personId?: string; status?: RecurringPlanStatus }) {
    const where: any = { tenantId };
    if (query?.personId) where.personId = query.personId;
    if (query?.status) where.status = query.status;

    const plans = await this.prisma.recurringPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        person: {
          select: { id: true, fullName: true, primaryPhone: true },
        },
      },
    });

    return plans.map((p) => ({
      ...p,
      baseAmountMinor: p.baseAmount.toString(),
    }));
  }

  async update(tenantId: string, id: string, dto: UpdateRecurringPlanDto) {
    const plan = await this.prisma.recurringPlan.findFirst({
      where: { id, tenantId },
    });

    if (!plan) {
      throw new NotFoundException(`Recurring plan '${id}' not found.`);
    }

    const updated = await this.prisma.recurringPlan.update({
      where: { id },
      data: {
        status: dto.status ?? undefined,
        baseAmount: dto.baseAmountMinor ? BigInt(dto.baseAmountMinor) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });

    return {
      ...updated,
      baseAmountMinor: updated.baseAmount.toString(),
    };
  }
}
