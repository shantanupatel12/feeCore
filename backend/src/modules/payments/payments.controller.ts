import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { AdvanceWalletService } from './services/advance-wallet.service.js';
import { LateFeeService } from './services/late-fee.service.js';
import {
  CreatePaymentDto,
  CreateMultiDuePaymentDto,
  CreateAdvancePaymentDto,
  ApplyAdvanceDto,
  AssessLateFeeDto,
  WaiveLateFeeDto,
} from './dto/payment.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole } from '@prisma/client';

@Controller('tenants/:tenantId/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly advanceWalletService: AdvanceWalletService,
    private readonly lateFeeService: LateFeeService,
  ) {}

  /**
   * Primary payment intake endpoint.
   * Handles single-due payment or multi-due payment if allocations are provided.
   */
  @Post()
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async collect(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    if (dto.allocations && dto.allocations.length > 0 && dto.personId && dto.totalAmountMinor) {
      return this.paymentsService.collectMultiDuePayment(
        user.tenantId,
        user.sub,
        {
          personId: dto.personId,
          totalAmountMinor: dto.totalAmountMinor,
          paymentMode: dto.paymentMode,
          allocations: dto.allocations,
          creditedToAdvanceMinor: dto.creditedToAdvanceMinor,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
        },
      );
    }

    return this.paymentsService.collectPayment(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /**
   * Explicit multiple-charge payment settlement (FR-PAY-03 / BR-PAY-003).
   */
  @Post('multi-due')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async collectMultiDue(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMultiDuePaymentDto,
  ) {
    return this.paymentsService.collectMultiDuePayment(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /**
   * Advance payment collection to Person credit wallet (FR-ADV-01 / BR-ADV-001).
   */
  @Post('advance')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async collectAdvance(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAdvancePaymentDto,
  ) {
    return this.advanceWalletService.collectAdvancePayment(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /**
   * Manual application of advance wallet balance to Due (FR-ADV-02 / BR-ADV-002).
   */
  @Post('apply-advance')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async applyAdvance(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApplyAdvanceDto,
  ) {
    return this.advanceWalletService.applyAdvanceToDue(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /**
   * Assessment of late fee penalty on a delinquent Due (BR-CHG-003 / Edge Case 7).
   */
  @Post('late-fee/assess/:dueId')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async assessLateFee(
    @CurrentUser() user: JwtPayload,
    @Param('dueId') dueId: string,
    @Body() dto: AssessLateFeeDto,
  ) {
    return this.lateFeeService.assessLateFee(
      user.tenantId,
      user.sub,
      dueId,
      dto,
    );
  }

  /**
   * Admin waiver of assessed late fee penalty (BR-CHG-003 / SoD: Admin only).
   */
  @Post('late-fee/waive/:dueId')
  @Roles(UserRole.ROLE_ADMIN)
  async waiveLateFee(
    @CurrentUser() user: JwtPayload,
    @Param('dueId') dueId: string,
    @Body() dto: WaiveLateFeeDto,
  ) {
    return this.lateFeeService.waiveLateFee(
      user.tenantId,
      user.sub,
      dueId,
      dto,
    );
  }
}