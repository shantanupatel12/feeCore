import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RefundsService } from './refunds.service.js';
import {
  CreateRefundDto,
  CreateAdvanceRefundDto,
} from './dto/refund.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { RefundType, UserRole } from '@prisma/client';

@Controller('tenants/:tenantId/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post('allocations')
  @Roles(UserRole.ROLE_ADMIN)
  async refundAllocation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRefundDto,
  ) {
    /*
     * Tenant scope comes from the verified JWT only; the
     * :tenantId path segment is never used for ownership.
     */
    return this.refundsService.refundAllocation(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /**
   * Flow B. Segregated from Flow A: debits the advance wallet and
   * touches no Due, Payment or Allocation.
   */
  @Post('advance-wallet')
  @Roles(UserRole.ROLE_ADMIN)
  async refundAdvance(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAdvanceRefundDto,
  ) {
    return this.refundsService.refundAdvance(
      user.tenantId,
      user.sub,
      dto,
    );
  }

  /*
   * `refunds:view` is ALLOW for Admin, Collector and Viewer, so the
   * read routes below carry no role narrowing beyond the guards.
   */
  @Get()
  async listRefunds(
    @CurrentUser() user: JwtPayload,
    @Query('personId') personId?: string,
    @Query('paymentId') paymentId?: string,
    @Query('refundType') refundType?: RefundType,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.refundsService.listRefunds(user.tenantId, {
      personId,
      paymentId,
      refundType,
      page,
      limit,
    });
  }

  @Get(':id')
  async getRefund(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.refundsService.getRefund(user.tenantId, id);
  }
}