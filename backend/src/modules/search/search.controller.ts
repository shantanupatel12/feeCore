import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * FR-SRH-01: `GET /api/v1/search?q=` (the global prefix supplies
 * `api/v1`). The tenant comes only from the verified JWT.
 *
 * The permission matrix defines no search-specific permission;
 * `people:view` ("Search, view people lists, and inspect person
 * profiles") and `receipts:view` are both ALLOW for Admin, Collector
 * and Viewer, so no role narrowing applies beyond authentication.
 */
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(@CurrentUser() user: JwtPayload, @Query() query: SearchQueryDto) {
    return this.searchService.search(user.tenantId, query);
  }
}