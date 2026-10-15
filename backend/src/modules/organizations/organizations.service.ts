import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto.js';
import { UpdateReceiptConfigDto } from './dto/update-receipt-config.dto.js';

/**
 * Organization profile (FR-ORG-01).
 *
 * Reads and updates the authenticated tenant's own `tenants` row.
 * There is no client-supplied tenant identifier in this API, so
 * ownership can only ever come from the verified JWT.
 *
 * The SRS does not require organization changes to be audited, so no
 * audit entry is written here; the existing `AuditLog` table remains
 * unwritten, as it was before this module.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    return this.serialize(tenant!);
  }

  async updateProfile(tenantId: string, dto: UpdateOrganizationProfileDto) {
    // Only the authenticated tenant's row is addressable.
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: dto.name,
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.taxId !== undefined && { taxId: dto.taxId }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      },
    });

    return this.serialize(tenant);
  }

  private serialize(tenant: {
    id: string;
    name: string;
    category: string;
    address: string | null;
    taxId: string | null;
    logoUrl: string | null;
    currency: string;
    timezone: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: tenant.id,
      name: tenant.name,
      category: tenant.category,
      address: tenant.address,
      taxId: tenant.taxId,
      logoUrl: tenant.logoUrl,
      currency: tenant.currency,
      timezone: tenant.timezone,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
  /**
   * Receipt configuration (FR-ORG-03).
   *
   * Reads and writes only the receipt fields that already exist. The
   * `receipt_sequences` counter is deliberately exposed read-only: it
   * is maintained inside the receipt issuance transaction, and
   * writing it from here would break the gapless, rollback-safe
   * numbering guarantee (BR-RCP-001).
   */
  async getReceiptConfig(tenantId: string) {
    const [settings, tenant] = await Promise.all([
      this.prisma.tenantSettings.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);

    const sequences = await this.prisma.receiptSequence.findMany({
      where: { tenantId },
      orderBy: { fiscalYear: 'desc' },
    });

    return {
      receiptPrefix: settings?.receiptPrefix ?? 'REC',
      receiptFooterText: settings?.receiptFooterText ?? null,
      logoUrl: tenant?.logoUrl ?? null,
      // Current numbering position, per fiscal year (read-only).
      sequences: sequences.map((s) => ({
        fiscalYear: s.fiscalYear,
        currentSequence: s.currentSequence,
      })),
    };
  }

  async updateReceiptConfig(tenantId: string, dto: UpdateReceiptConfigDto) {
    // `settings` and the tenant `logoUrl` live in two different rows;
    // both are addressable only by the authenticated tenant.
    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...(dto.receiptPrefix !== undefined && {
          receiptPrefix: dto.receiptPrefix,
        }),
        ...(dto.receiptFooterText !== undefined && {
          receiptFooterText: dto.receiptFooterText,
        }),
      },
      update: {
        ...(dto.receiptPrefix !== undefined && {
          receiptPrefix: dto.receiptPrefix,
        }),
        ...(dto.receiptFooterText !== undefined && {
          receiptFooterText: dto.receiptFooterText,
        }),
      },
    });

    if (dto.logoUrl !== undefined) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { logoUrl: dto.logoUrl },
      });
    }

    // Re-read through the single read path so both endpoints return the
    // same effective configuration.
    return this.getReceiptConfig(tenantId);
  }
}
