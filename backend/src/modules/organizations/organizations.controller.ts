import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service.js';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto.js';
import { UpdateReceiptConfigDto } from './dto/update-receipt-config.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * FR-ORG-01: `PUT /api/v1/tenant/profile` (and the matching read),
 * per the SRS route. The profile belongs to the authenticated tenant,
 * so the tenant is taken only from the verified JWT.
 *
 * `org:profile:view` is ALLOW for all roles while `org:profile:update`
 * is ALLOW for Owner/Admin and DENY for Collector and Viewer, so the
 * read is open to any authenticated user and the write is Admin-only.
 */
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.organizationsService.getProfile(user.tenantId);
  }

  @Put('profile')
  @Roles(UserRole.ROLE_ADMIN)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOrganizationProfileDto,
  ) {
    return this.organizationsService.updateProfile(user.tenantId, dto);
  }

  /**
   * FR-ORG-03: `PUT /api/v1/tenant/receipt-config`, per the SRS route.
   *
   * `org:settings:update` covers "currency, timezone, tax, and receipt
   * settings" and is ALLOW for Owner/Admin only, so this write is
   * Admin-only. The read follows `org:profile:view` (all roles).
   */
  @Get('receipt-config')
  async getReceiptConfig(@CurrentUser() user: JwtPayload) {
    return this.organizationsService.getReceiptConfig(user.tenantId);
  }

  @Put('receipt-config')
  @Roles(UserRole.ROLE_ADMIN)
  async updateReceiptConfig(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateReceiptConfigDto,
  ) {
    return this.organizationsService.updateReceiptConfig(user.tenantId, dto);
  }
}