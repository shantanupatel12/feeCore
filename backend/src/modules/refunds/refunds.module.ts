import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DuesModule } from '../dues/dues.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [AuthModule, DuesModule, PaymentsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}