import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from '../services/reports.service.js';
import {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../validators/reports-query.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../../auth/auth.service.js';

/**
 * `reports:collection:view` and `reports:dues:view` are ALLOW for
 * Admin, Collector and Viewer, so no role narrowing is applied here
 * beyond the global guards. (`reports:export` is a separate,
 * Admin-only permission and is not implemented in this MVP.)
 */
@Controller('tenants/:tenantId/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('collections')
  async collectionReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: CollectionReportQueryDto,
  ) {
    // Tenant scope comes from the verified JWT only.
    return this.reportsService.collectionReport(user.tenantId, query);
  }

  @Get('dues')
  async duesReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: DuesReportQueryDto,
  ) {
    return this.reportsService.duesReport(user.tenantId, query);
  }
}