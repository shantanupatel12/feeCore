import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * `dashboard:view` is ALLOW for Admin, Collector and Viewer, so no
 * role narrowing is applied beyond the global guards.
 */
@Controller('tenants/:tenantId/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics(
    @CurrentUser() user: JwtPayload,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() query: DashboardQueryDto,
  ) {
    // Tenant scope comes from the verified JWT only; the :tenantId path
    // segment is never consulted for ownership.
    return this.dashboardService.getMetrics(user.tenantId, query);
  }
}