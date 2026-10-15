import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PeopleService } from '../people/people.service.js';
import { DuesService } from '../dues/dues.service.js';
import { RefundsService } from '../refunds/refunds.service.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { ReportsService } from '../reports/services/reports.service.js';
import {
  QueryPeopleDto,
  resolvePeopleSearchTerm,
} from '../people/dto/person.dto.js';
import { GenerateDuesDto } from '../dues/dto/due.dto.js';
import { CreateRefundDto } from '../refunds/dto/refund.dto.js';
import { DashboardQueryDto } from '../dashboard/dto/dashboard-query.dto.js';
import {
  CollectionReportQueryDto,
  DuesReportQueryDto,
} from '../reports/validators/reports-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * SRS route-conformance aliases.
 *
 * Every route here is **additive**: the existing `tenants/:tenantId/...`
 * routes remain untouched and keep serving existing clients. Each handler is a
 * one-line delegation to the *same* service method the original controller
 * calls, so there is exactly one business implementation per operation and no
 * calculation, validation rule or financial behaviour is duplicated.
 *
 * Tenant scope comes exclusively from `user.tenantId` on the verified JWT, on
 * every route. No handler reads a tenant from the path, query or body, and the
 * global `forbidNonWhitelisted` pipe rejects a `tenantId` query key outright.
 *
 * Authorization mirrors the protected original exactly: no new permission and
 * no new role is introduced, and read-only routes keep carrying no role
 * narrowing beyond the global guards, just as their originals do.
 *
 * Controllers are declared at the API root (`@Controller()` with no prefix) so
 * only these six explicit paths are added, rather than exposing a module's
 * whole surface under a second prefix.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RouteAliasesController {
  constructor(
    private readonly peopleService: PeopleService,
    private readonly duesService: DuesService,
    private readonly refundsService: RefundsService,
    private readonly dashboardService: DashboardService,
    private readonly reportsService: ReportsService,
  ) {}

  /** FR-PER-02 — `GET /api/v1/people?query=`. */
  @Get('people')
  async searchPeople(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryPeopleDto,
  ) {
    return this.peopleService.findAll(user.tenantId, {
      search: resolvePeopleSearchTerm(query),
      status: query?.status,
      page: query?.page,
      limit: query?.limit,
    });
  }

  /** FR-REC-02 — `POST /api/v1/jobs/generate-dues`. */
  @Post('jobs/generate-dues')
  @Roles(UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR)
  async generateDues(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateDuesDto,
  ) {
    return this.duesService.generateDues(user.tenantId, dto);
  }

  /** FR-REF-01 — `POST /api/v1/refunds/due-allocation`. */
  @Post('refunds/due-allocation')
  @Roles(UserRole.ROLE_ADMIN)
  async refundAllocation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refundsService.refundAllocation(user.tenantId, user.sub, dto);
  }

  /** FR-DSH-01 — `GET /api/v1/dashboard/metrics`. */
  @Get('dashboard/metrics')
  async dashboardMetrics(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getMetrics(user.tenantId, query);
  }

  /** FR-REP-01 — `GET /api/v1/reports/collections`. */
  @Get('reports/collections')
  async collectionReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: CollectionReportQueryDto,
  ) {
    return this.reportsService.collectionReport(user.tenantId, query);
  }

  /** FR-REP-02 — `GET /api/v1/reports/dues`. */
  @Get('reports/dues')
  async duesReport(
    @CurrentUser() user: JwtPayload,
    @Query() query: DuesReportQueryDto,
  ) {
    return this.reportsService.duesReport(user.tenantId, query);
  }
}