import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from '../services/reports.service.js';
import {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../validators/reports-query.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../../auth/auth.service.js';
import { UserRole } from '@prisma/client';

/**
 * Reports endpoints. Restricted to Admin and Collector roles;
 * individual account holders (ROLE_VIEWER) must not inspect
 * tenant-wide financial collections or aging schedules.
 */
@Controller('tenants/:tenantId/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('collections')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async collectionReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: CollectionReportQueryDto,
  ) {
    // Tenant scope comes from the verified JWT only.
    return this.reportsService.collectionReport(user.tenantId, query);
  }

  @Get('dues')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async duesReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: DuesReportQueryDto,
  ) {
    return this.reportsService.duesReport(user.tenantId, query);
  }
}