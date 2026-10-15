import {
  Controller,
  Get,
  Param,
  Query,
  Header,
  UseGuards,
} from '@nestjs/common';
import { ReceiptsService } from './receipts.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/auth.service.js';

/**
 * Receipt read endpoints. `receipts:view` and `receipts:download`
 * are ALLOW for Admin, Collector and Viewer, so no role narrowing is
 * applied here beyond the global guards.
 */
@Controller('tenants/:tenantId/receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async listReceipts(
    @CurrentUser() user: JwtPayload,
    @Query('personId') personId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.receiptsService.listReceipts(user.tenantId, {
      personId,
      page,
      limit,
    });
  }

  /*
   * Declared before `:id` so the static `by-payment` segment is never
   * swallowed by the `:id` pattern.
   */
  @Get('by-payment/:paymentId')
  async getReceiptByPayment(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId') paymentId: string,
  ) {
    return this.receiptsService.getReceiptByPayment(user.tenantId, paymentId);
  }

  /**
   * Printable PDF. Declared before the `:id` routes so the static
   * `pdf` segment is never captured as an id.
   */
  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header(
    'Content-Disposition',
    'attachment; filename="receipt.pdf"',
  )
  async downloadReceiptPdf(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.receiptsService.renderReceiptPdf(user.tenantId, id);
  }

  @Get(':id')
  async getReceipt(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    // Tenant scope comes from the verified JWT only.
    return this.receiptsService.getReceipt(user.tenantId, id);
  }

  /**
   * Deterministic reprint. Renders exclusively from the frozen
   * snapshot, never from live tables.
   */
  @Get(':id/print')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async printReceipt(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.receiptsService.renderReceiptHtml(user.tenantId, id);
  }
}