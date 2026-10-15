import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PeopleService } from './people.service.js';
import {
  CreatePersonDto,
  UpdatePersonDto,
  QueryPeopleDto,
  resolvePeopleSearchTerm,
} from './dto/person.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole } from '@prisma/client';

const OPERATIONAL_ROLES = [UserRole.ROLE_ADMIN, UserRole.ROLE_COLLECTOR] as const;

@Controller('tenants/:tenantId/people')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post()
  @Roles(...OPERATIONAL_ROLES)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePersonDto,
  ) {
    return this.peopleService.create(user.tenantId, dto);
  }

  /**
   * FR-PER-02: search people by name, phone or email.
   *
   * `query` is the SRS-defined parameter; `search` is a backward-compatible
   * alias that is already supported. When both are supplied `query` wins and
   * `search` is ignored — they are never combined, so the result can never be
   * the union or intersection of two different terms by surprise.
   *
   * Read access for all roles (Admin, Collector, Viewer).
   */
  @Get()
  async findAll(
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

  @Get(':id')
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.peopleService.findOne(user.tenantId, id);
  }

  /**
   * FR-PER-03 soft deactivation.
   *
   * `people:deactivate` is ALLOW for Owner/Admin and DENY for Collector and
   * Viewer in the permission matrix, and `UserRole` has no separate owner
   * value, so this is ROLE_ADMIN.
   */
  @Post(':id/deactivate')
  @Roles(UserRole.ROLE_ADMIN)
  async deactivate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.peopleService.deactivate(user.tenantId, id);
  }

  @Put(':id')
  @Roles(...OPERATIONAL_ROLES)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.peopleService.update(user.tenantId, id, dto);
  }
}

