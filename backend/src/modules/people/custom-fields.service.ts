import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
  normalizeFieldKey,
} from './dto/custom-field.dto.js';
import { CustomFieldDataType, CustomFieldDefinition, Prisma } from '@prisma/client';

/**
 * FR-CFD-01 / BR-12, ADR-007.
 *
 * Definitions are tenant-scoped rows in `custom_field_definitions`;
 * person values live in the `Person.customData` JSONB column. No tenant
 * ever queries or validates against another tenant's rows: every method
 * takes `tenantId` as its first argument and filters on it, including the
 * single-row lookups used by update/delete, so a foreign id surfaces as
 * NotFound rather than leaking existence.
 */
@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A `SELECT` field is only meaningful with a non-empty, duplicate-free
   * option list; options are meaningless on any other type. Validated here
   * rather than in the DTO because the resolved dataType is only known
   * after SRS synonyms are normalised.
   */
  private validateOptions(dataType: CustomFieldDataType, options: string[] | undefined) {
    if (dataType === CustomFieldDataType.SELECT) {
      if (!options || options.length === 0) {
        throw new BadRequestException(
          'A SELECT (dropdown) custom field requires a non-empty options array.',
        );
      }
      const trimmed = options.map((o) => o.trim());
      if (trimmed.some((o) => o.length === 0)) {
        throw new BadRequestException('SELECT options must not be blank.');
      }
      const unique = new Set(trimmed);
      if (unique.size !== trimmed.length) {
        throw new BadRequestException('SELECT options must not contain duplicates.');
      }
      return trimmed;
    }

    if (options && options.length > 0) {
      throw new BadRequestException(
        `Options are only valid for a SELECT (dropdown) field, not ${dataType}.`,
      );
    }
    return undefined;
  }

  async create(tenantId: string, dto: CreateCustomFieldDto): Promise<CustomFieldDefinition> {
    /*
     * Normalise before the duplicate check. The database already enforces
     * `uq_tenant_field_key`, but it fires *after* normalisation, so
     * "Class" and "class" would otherwise both pass a pre-check on the raw
     * input and surface as a raw Prisma error (500) instead of a 409.
     */
    const fieldKey = normalizeFieldKey(dto.fieldKey);
    if (fieldKey.length === 0) {
      throw new BadRequestException('fieldKey must contain at least one letter or digit.');
    }

    const options = this.validateOptions(dto.dataType, dto.options);

    const existing = await this.prisma.customFieldDefinition.findFirst({
      where: { tenantId, fieldKey },
    });

    if (existing) {
      throw new ConflictException(
        `Custom field with key '${fieldKey}' already exists for this tenant.`,
      );
    }

    return this.prisma.customFieldDefinition.create({
      data: {
        tenantId,
        fieldKey,
        fieldLabel: dto.fieldLabel,
        dataType: dto.dataType,
        isRequired: dto.isRequired ?? false,
        options: options === undefined ? undefined : (options as unknown as Prisma.InputJsonValue),
        displayOrder: dto.displayOrder ?? 0,
      },
    });
  }

  async findAll(tenantId: string): Promise<CustomFieldDefinition[]> {
    return this.prisma.customFieldDefinition.findMany({
      where: { tenantId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string): Promise<CustomFieldDefinition> {
    const field = await this.prisma.customFieldDefinition.findFirst({
      where: { id, tenantId },
    });
    if (!field) {
      throw new NotFoundException(`Custom field '${id}' not found.`);
    }
    return field;
  }

  /**
   * FR-CFD-01 update. Only `fieldLabel`, `dataType`, `isRequired`,
   * `options` and `displayOrder` are supported; `fieldKey` is immutable
   * because stored person values are keyed by it.
   *
   * Person values are deliberately untouched: redefining options must not
   * delete or rewrite values already captured on `Person.customData`.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    const current = await this.findOne(tenantId, id);

    const dataType = dto.dataType ?? current.dataType;
    const rawOptions = dto.options !== undefined ? dto.options : (current.options as string[] | null) ?? undefined;
    const options = this.validateOptions(dataType, rawOptions);

    return this.prisma.customFieldDefinition.update({
      where: { id: current.id },
      data: {
        fieldLabel: dto.fieldLabel ?? undefined,
        dataType: dto.dataType ?? undefined,
        isRequired: dto.isRequired ?? undefined,
        options:
          dto.options !== undefined && options !== undefined
            ? (options as unknown as Prisma.InputJsonValue)
            : undefined,
        displayOrder: dto.displayOrder ?? undefined,
      },
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const field = await this.findOne(tenantId, id);
    await this.prisma.customFieldDefinition.delete({ where: { id: field.id } });
  }
}