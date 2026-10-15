import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { LateFeeRulesService } from './late-fee-rules.service.js';
import {
  CreateLateFeeRuleDto,
  UpdateLateFeeRuleDto,
} from './dto/late-fee-rule.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';
import { UserRole, LateFeeRule } from '@prisma/client';

/**
 * FR-CHG-03: `POST /api/v1/late-fee-rules` is the path named by
 * `requirements-traceability.md`.
 *
 * RBAC reuses the existing matrix rather than inventing a permission. The
 * matrix has no dedicated "configure late fee rule" permission; its
 * late-fee entries are `dues:late_fee:waive` and `dues:recalculate`, both
 * ALLOW for Owner/Admin and DENY for Collector and Viewer. `dues:recalculate`
 * ("trigger on-demand late fee or due recomputation") is the closest fit and
 * keeps rule configuration at the elevated authority that
 * permission-matrix.md SoD requires for financial overrides.
 *
 * `UserRole` has no separate owner value, so "Owner / Admin" is ROLE_ADMIN.
 */
@Controller('late-fee-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LateFeeRulesController {
  constructor(private readonly lateFeeRulesService: LateFeeRulesService) {}

  /** Reads are open to any authenticated role, consistent with `dues:view`. */
  @Get()
  async findAll(@CurrentUser() user: JwtPayload) {
    const rules = await this.lateFeeRulesService.findAll(user.tenantId);
    return rules.map(serializeRule);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return serializeRule(await this.lateFeeRulesService.findOne(user.tenantId, id));
  }

  @Post()
  @Roles(UserRole.ROLE_ADMIN)
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLateFeeRuleDto) {
    return serializeRule(await this.lateFeeRulesService.create(user.tenantId, dto));
  }

  @Patch(':id')
  @Roles(UserRole.ROLE_ADMIN)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLateFeeRuleDto,
  ) {
    return serializeRule(await this.lateFeeRulesService.update(user.tenantId, id, dto));
  }
}

/** BigInt -> string per BR-CORE-001 tier 3. */
function serializeRule(rule: LateFeeRule) {
  return {
    ...rule,
    amountMinor: rule.amountMinor.toString(),
  };
}