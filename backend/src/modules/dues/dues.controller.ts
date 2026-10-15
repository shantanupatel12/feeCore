import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DuesService } from './dues.service.js';
import { QueryDuesDto, GenerateDuesDto } from './dto/due.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { AdvanceWalletService } from '../payments/services/advance-wallet.service.js';
import { LateFeeService } from '../payments/services/late-fee.service.js';
import {
  ApplyAdvanceDto,
  AssessLateFeeDto,
  AssessLateFeesDto,
  WaiveLateFeeDto,
} from '../payments/dto/payment.dto.js';

@Controller('tenants/:tenantId/dues')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DuesController {
  constructor(
    private readonly duesService: DuesService,
    private readonly advanceWalletService: AdvanceWalletService,
    private readonly lateFeeService: LateFeeService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryDuesDto,
  ) {
    /*
     * Tenant scope comes from the verified JWT, never from the
     * URL. A missing or spoofed path param must not be able to
     * widen the query.
     */
    return this.duesService.findAll(user.tenantId, query);
  }

  /**
   * FR-DUE-02: dues whose current date is past the due date with a positive
   * balance. Declared before the `:id` route so the static `overdue` segment
   * is never captured as an id.
   *
   * `dues:view` is ALLOW for Admin, Collector and Viewer, so no role
   * narrowing is applied, matching the existing `GET /dues` route.
   */
  @Get('overdue')
  async findOverdue(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryDuesDto,
  ) {
    // Tenant scope comes from the verified JWT, never from the URL.
    return this.duesService.findOverdue(user.tenantId, query);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.duesService.findOne(user.tenantId, id);
  }

  @Post('generate')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async generateDues(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateDuesDto,
  ) {
    return this.duesService.generateDues(user.tenantId, dto);
  }

  /**
   * Apply available advance credit to an outstanding Due (FR-ADV-02).
   */
  @Post(':id/apply-advance')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async applyAdvance(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyAdvanceDto,
  ) {
    return this.advanceWalletService.applyAdvanceToDue(user.tenantId, user.sub, {
      ...dto,
      dueId: id,
    });
  }

  /**
   * Assess late fee on a delinquent Due (BR-CHG-003).
   */
  /**
   * FR-CHG-03 rule-driven evaluation trigger (state-models `DAILY_CRON_EVAL`).
   * Admin-only per `dues:recalculate` in the permission matrix.
   */
  @Post('assess-late-fees')
  @Roles(UserRole.ROLE_ADMIN)
  async assessLateFees(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssessLateFeesDto,
  ) {
    return this.lateFeeService.evaluateOverdueDues(user.tenantId, user.sub, dto.asOfDate);
  }

  @Post(':id/assess-late-fee')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async assessLateFee(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AssessLateFeeDto,
  ) {
    return this.lateFeeService.assessLateFee(user.tenantId, user.sub, id, dto);
  }

  /**
   * Admin waiver of late fee penalty (BR-CHG-003 / SoD).
   */
  @Post(':id/waive-late-fee')
  @Roles(UserRole.ROLE_ADMIN)
  async waiveLateFee(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: WaiveLateFeeDto,
  ) {
    return this.lateFeeService.waiveLateFee(user.tenantId, user.sub, id, dto);
  }
}
