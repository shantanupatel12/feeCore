import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../database/prisma/prisma.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { PeopleModule } from '../modules/people/people.module.js';
import { ChargesModule } from '../modules/charges/charges.module.js';
import { DuesModule } from '../modules/dues/dues.module.js';
import { PaymentsModule } from '../modules/payments/payments.module.js';
import { RefundsModule } from '../modules/refunds/refunds.module.js';
import { ReceiptsModule } from '../modules/receipts/receipts.module.js';
import { AuditModule } from '../modules/audit/audit.module.js';
import { OrganizationsModule } from '../modules/organizations/organizations.module.js';
import { SearchModule } from '../modules/search/search.module.js';
import { ImportsModule } from '../modules/imports/imports.module.js';
import { DashboardModule } from '../modules/dashboard/dashboard.module.js';
import { ReportsModule } from '../modules/reports/reports.module.js';
import { ExportsModule } from '../modules/exports/exports.module.js';
import { RouteAliasesModule } from '../modules/route-aliases/route-aliases.module.js';
import { HealthModule } from '../modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    PeopleModule,
    ChargesModule,
    DuesModule,
    PaymentsModule,
    RefundsModule,
    ReceiptsModule,
    DashboardModule,
    ReportsModule,
    ExportsModule,
    RouteAliasesModule,
    AuditModule,
    OrganizationsModule,
    SearchModule,
    ImportsModule,
    HealthModule,
  ],
})
export class AppModule {}
