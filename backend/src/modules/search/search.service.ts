import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { SearchQueryDto } from './dto/search-query.dto.js';

const DEFAULT_LIMIT = 20;

/**
 * Global search (FR-SRH-01 / BR-02 / BR-08).
 *
 * Resolves the four SRS-required targets against the authenticated
 * tenant only: person name, person phone, person email and receipt
 * number.
 *
 * Matching reuses the convention already established by
 * `PeopleService.findAll`: trimmed input with a case-insensitive
 * `contains`, so search is partial and case-insensitive by default
 * rather than introducing new fuzzy semantics.
 *
 * Filtering happens in PostgreSQL via Prisma; nothing is loaded into
 * application memory to be filtered in TypeScript, and the existing
 * `idx_people_search` index covers the person branch. No N+1 queries:
 * two bounded queries run concurrently.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, query: SearchQueryDto) {
    const q = (query.q ?? '').trim();
    const limit = query.limit ?? DEFAULT_LIMIT;

    // Defensive: a blank query resolves to nothing rather than
    // scanning the tenant's tables.
    if (q.length === 0) {
      return { q, people: [], receipts: [], total: 0, limit };
    }

    const [people, receipts] = await Promise.all([
      this.prisma.person.findMany({
        where: {
          tenantId,
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { primaryPhone: { contains: q, mode: 'insensitive' } },
            { secondaryPhone: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.receipt.findMany({
        where: {
          tenantId,
          receiptNumber: { contains: q, mode: 'insensitive' },
        },
        orderBy: { issuedAt: 'desc' },
        take: limit,
      }),
    ]);

    return {
      q,
      // Contact details and custom fields are returned per BR-02.
      people: people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        primaryPhone: p.primaryPhone,
        secondaryPhone: p.secondaryPhone,
        email: p.email,
        status: p.status,
        customData: p.customData,
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        paymentId: r.paymentId,
        issuedAt: r.issuedAt.toISOString(),
      })),
      total: people.length + receipts.length,
      limit,
    };
  }
}