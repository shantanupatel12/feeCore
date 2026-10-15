import { Module } from '@nestjs/common';
import { RouteAliasesController } from './route-aliases.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { PeopleModule } from '../people/people.module.js';
import { DuesModule } from '../dues/dues.module.js';
import { RefundsModule } from '../refunds/refunds.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { ReportsModule } from '../reports/reports.module.js';

/*
 * Every imported module already exports the service this controller delegates
 * to, so no existing module needed modification.
 */
@Module({
  imports: [AuthModule, PeopleModule, DuesModule, RefundsModule, DashboardModule, ReportsModule],
  controllers: [RouteAliasesController],
})
export class RouteAliasesModule {}
