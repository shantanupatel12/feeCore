import { Module } from '@nestjs/common';
import { ChargesService } from './charges.service.js';
import { ChargesController } from './charges.controller.js';
import { RecurringPlansService } from './recurring-plans.service.js';
import { RecurringPlansController } from './recurring-plans.controller.js';
import { LateFeeRulesService } from './late-fee-rules.service.js';
import { LateFeeRulesController } from './late-fee-rules.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ChargesController, RecurringPlansController, LateFeeRulesController],
  providers: [ChargesService, RecurringPlansService, LateFeeRulesService],
  exports: [ChargesService, RecurringPlansService, LateFeeRulesService],
})
export class ChargesModule {}
