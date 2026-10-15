import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { AllocationService } from './services/allocation.service.js';
import { AdvanceWalletService } from './services/advance-wallet.service.js';
import { LateFeeService } from './services/late-fee.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReceiptsModule } from '../receipts/receipts.module.js';

@Module({
  imports: [AuthModule, ReceiptsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    AllocationService,
    AdvanceWalletService,
    LateFeeService,
  ],
  exports: [
    PaymentsService,
    AllocationService,
    AdvanceWalletService,
    LateFeeService,
  ],
})
export class PaymentsModule {}
