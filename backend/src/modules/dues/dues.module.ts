import { Module } from '@nestjs/common';
import { DuesService } from './dues.service.js';
import { DuesController } from './dues.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [DuesController],
  providers: [DuesService],
  exports: [DuesService],
})
export class DuesModule {}
