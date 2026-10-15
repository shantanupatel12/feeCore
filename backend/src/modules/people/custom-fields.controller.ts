import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service.js';
import {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from './dto/custom-field.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole } from '@prisma/client';

/**
 * FR-CFD-01 / BR-12.
 *
 * Mounted at `api/v1/custom-fields`, the path named by
 * `requirements-traceability.md`. The previous mount exposed the same
 * operations at `tenants/:tenantId/custom-fields`, where the `:tenantId`
 * segment was never read by the handler and could only ever disagree with
 * the authenticated tenant, so the SRS path is used instead.
 *
 * RBAC reuses the existing role guard against the permission matrix:
 * `custom_fields:schema:view` is ALLOW for every role, while
 * `custom_fields:schema:manage` is ALLOW for Owner/Admin and DENY for
 * Collector and Viewer. `UserRole` has no separate owner value, so
 * "Owner / Admin" is `ROLE_ADMIN`.
 */
@Controller('custom-fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  /** `custom_fields:schema:view` — ALLOW for all roles. */
  @Get()
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.customFieldsService.findAll(user.tenantId);
  }

  /** `custom_fields:schema:manage` — Owner/Admin only. */
  @Post()
  @Roles(UserRole.ROLE_ADMIN)
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomFieldDto) {
    return this.customFieldsService.create(user.tenantId, dto);
  }

  /** `custom_fields:schema:manage` — Owner/Admin only. */
  @Patch(':id')
  @Roles(UserRole.ROLE_ADMIN)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.customFieldsService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ROLE_ADMIN)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.customFieldsService.remove(user.tenantId, id);
  }
}