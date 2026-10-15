import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TerminologyService } from './terminology.service.js';
import { UpdateTerminologyDto } from './dto/update-terminology.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * FR-ORG-02: `PUT /api/v1/tenant/terminology`, per the SRS route.
 *
 * A matching read is exposed because BR-01 requires the configured
 * labels to be available at runtime for consumers (UI labels, tables,
 * forms and receipt line-items); without a read path no consumer could
 * ever obtain the values this endpoint stores.
 *
 * `org:terminology:update` is ALLOW for Owner/Admin and DENY for
 * Collector and Viewer, so writes are Admin-only. Reads follow
 * `org:profile:view`, which is ALLOW for every role.
 */
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TerminologyController {
  constructor(private readonly terminologyService: TerminologyService) {}

  @Get('terminology')
  async getTerminology(@CurrentUser() user: JwtPayload) {
    return this.terminologyService.getTerminology(user.tenantId);
  }

  @Put('terminology')
  @Roles(UserRole.ROLE_ADMIN)
  async updateTerminology(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateTerminologyDto,
  ) {
    return this.terminologyService.updateTerminology(user.tenantId, dto);
  }
}