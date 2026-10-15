import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PeopleService } from './people.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * FR-PER-04: `GET /api/v1/people/{id}/statement` (the global prefix
 * supplies `api/v1`). The SRS defines this route without a tenant path
 * segment and ownership comes solely from the verified JWT, so there
 * is no client-supplied tenant identifier to trust.
 *
 * `people:statement:view` is ALLOW for Admin, Collector and Viewer, so
 * no role narrowing applies beyond the global guard.
 */
@Controller('people')
@UseGuards(JwtAuthGuard)
export class PersonStatementController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get(':id/statement')
  async statement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.peopleService.getStatement(user.tenantId, id);
  }
}