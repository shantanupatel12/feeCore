import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RecurringPlansService } from './recurring-plans.service.js';
import { CreateRecurringPlanDto, UpdateRecurringPlanDto } from './dto/recurring-plan.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRole, RecurringPlanStatus } from '@prisma/client';
import { JwtPayload } from '../auth/auth.service.js';

@Controller('tenants/:tenantId/recurring-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecurringPlansController {
  constructor(private readonly recurringPlansService: RecurringPlansService) {}

  @Post()
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRecurringPlanDto,
  ) {
    return this.recurringPlansService.create(user.tenantId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('personId') personId?: string,
    @Query('status') status?: RecurringPlanStatus,
  ) {
    return this.recurringPlansService.findAll(user.tenantId, { personId, status });
  }

  @Put(':id')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringPlanDto,
  ) {
    return this.recurringPlansService.update(user.tenantId, id, dto);
  }
}

