import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { UserRole } from '@prisma/client';
import { ExportsService } from './exports.service.js';
import { CollectionReportQueryDto } from '../reports/validators/reports-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * FR-EXP-01: `GET /api/v1/exports/{entity}` — streaming CSV export for
 * People, Dues, Payments and Reports.
 *
 * `reports:export` is ALLOW for Owner/Admin and DENY for Collector and Viewer
 * in `docs/permission-matrix.md`, and `UserRole` has no separate owner value,
 * so this is ROLE_ADMIN. No new permission or role is introduced.
 */
@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get(':entity')
  @Roles(UserRole.ROLE_ADMIN)
  async exportEntity(
    @CurrentUser() user: JwtPayload,
    @Param('entity') entity: string,
    @Query() query: CollectionReportQueryDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const resolved = this.exportsService.resolveEntity(entity);
    const { stream, filename } = this.exportsService.buildCsv(user.tenantId, resolved, query);

    /*
     * Tenant scope comes from the verified JWT only. The `:entity` path
     * segment and every query parameter are ignored for ownership; the
     * `CollectionReportQueryDto` pipe additionally rejects unknown query keys
     * because the global pipe runs with `forbidNonWhitelisted: true`.
     */
    reply
      .code(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`);

    // Sending the stream keeps the response chunked and avoids buffering.
    return reply.send(stream);
  }
}