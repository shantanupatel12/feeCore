import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ChargesService } from './charges.service.js';
import { CreateChargeDto } from './dto/charge.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/auth.service.js';

@Controller('tenants/:tenantId/charges')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Post()
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async createOneTimeCharge(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChargeDto,
  ) {
    return this.chargesService.createOneTimeCharge(user.tenantId, user.sub, dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('personId') personId?: string,
    @Query('category') category?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.chargesService.findAll(user.tenantId, { personId, category, page, limit });
  }
}

