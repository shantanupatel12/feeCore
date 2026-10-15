import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole } from '@prisma/client';

/**
 * FR-AUD-01: `GET /api/v1/audit-logs` (the global prefix supplies
 * `api/v1`). The SRS defines this route without a tenant path
 * segment, and ownership comes solely from the verified JWT, so no
 * client-supplied tenant identifier exists to trust or ignore.
 *
 * `audit:logs:view` is ALLOW for Owner/Admin and DENY for Collector
 * and Viewer (permission matrix), so this endpoint is Admin-only.
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ROLE_ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: AuditLogQueryDto) {
    return this.auditService.listAuditLogs(user.tenantId, query);
  }
}