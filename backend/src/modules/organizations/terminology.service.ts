import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { UpdateTerminologyDto } from './dto/update-terminology.dto.js';

/**
 * Terminology aliases (FR-ORG-02), stored in the existing
 * `tenant_settings` row. No schema change was needed.
 *
 * The row is created on demand with the Prisma column defaults
 * (Person/People/Charge/Charges), so tenants that never configured
 * terminology keep working with no manual data migration.
 *
 * The SRS requires no audit entry for terminology changes, so none is
 * written here.
 */
@Injectable()
export class TerminologyService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    personLabelSingular: string;
    personLabelPlural: string;
    chargeLabelSingular: string;
    chargeLabelPlural: string;
    updatedAt: Date;
  }) {
    return {
      personLabelSingular: row.personLabelSingular,
      personLabelPlural: row.personLabelPlural,
      chargeLabelSingular: row.chargeLabelSingular,
      chargeLabelPlural: row.chargeLabelPlural,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Reads terminology, materialising defaults for a tenant that has no row yet. */
  async getTerminology(tenantId: string) {
    const row = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });

    return this.serialize(row);
  }

  async updateTerminology(tenantId: string, dto: UpdateTerminologyDto) {
    /*
     * Singular and plural are written to their own columns; each is
     * only included when the client actually supplied it, so a partial
     * update cannot silently swap or blank the other form.
     */
    const row = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...(dto.personLabelSingular !== undefined && {
          personLabelSingular: dto.personLabelSingular,
        }),
        ...(dto.personLabelPlural !== undefined && {
          personLabelPlural: dto.personLabelPlural,
        }),
        ...(dto.chargeLabelSingular !== undefined && {
          chargeLabelSingular: dto.chargeLabelSingular,
        }),
        ...(dto.chargeLabelPlural !== undefined && {
          chargeLabelPlural: dto.chargeLabelPlural,
        }),
      },
      update: {
        ...(dto.personLabelSingular !== undefined && {
          personLabelSingular: dto.personLabelSingular,
        }),
        ...(dto.personLabelPlural !== undefined && {
          personLabelPlural: dto.personLabelPlural,
        }),
        ...(dto.chargeLabelSingular !== undefined && {
          chargeLabelSingular: dto.chargeLabelSingular,
        }),
        ...(dto.chargeLabelPlural !== undefined && {
          chargeLabelPlural: dto.chargeLabelPlural,
        }),
      },
    });

    return this.serialize(row);
  }
}