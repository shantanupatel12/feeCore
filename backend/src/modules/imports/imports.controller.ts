import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ImportsService } from './imports.service.js';
import { ImportPeopleCsvDto } from './dto/import-people-csv.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole } from '@prisma/client';

/**
 * FR-IMP-01: `POST /api/v1/imports/people`, the path named by
 * `requirements-traceability.md`.
 *
 * `import:people:execute` is ALLOW for Owner/Admin and DENY for Collector
 * and Viewer in the permission matrix, and `UserRole` has no separate owner
 * value, so the write is ROLE_ADMIN. No new permission is introduced.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('people')
  @Roles(UserRole.ROLE_ADMIN)
  async importPeople(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportPeopleCsvDto,
  ) {
    return this.importsService.importPeopleCsv(user.tenantId, user.sub, dto);
  }
}