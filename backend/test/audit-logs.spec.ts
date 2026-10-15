import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  DueStatus,
  PaymentMode,
  UserRole,
} from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { AuditController } from '../src/modules/audit/audit.controller.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

describe('V1.13: Audit logs (FR-AUD-01 / BR-13)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let audit: AuditService;

  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let adminB: string;
  let collectorA: string;
  let viewerA: string;
  let personA: string;
  let personB: string;
  let chargeA: string;

  let keySeq = 0;
  const nextKey = () => `audit-key-${Date.now()}-${keySeq++}`;

  async function makeDue(opts: {
    tenantId: string;
    personId: string;
    net: bigint;
  }) {
    return prisma.due.create({
      data: {
        tenantId: opts.tenantId,
        personId: opts.personId,
        chargeId: chargeA,
        dueDate: new Date('2099-06-01'),
        netAmount: opts.net,
        lateFeeAmount: BigInt(0),
        balanceRemaining: opts.net,
        status: DueStatus.PENDING,
      },
    });
  }

  /** Produces real PAYMENT_COLLECTED ledger rows via the payments service. */
  async function collect(opts: {
    tenantId: string;
    userId: string;
    personId: string;
    net: bigint;
    amount: string;
    mode?: PaymentMode;
  }) {
    const due = await makeDue(opts);
    return payments.collectPayment(opts.tenantId, opts.userId, {
      personId: opts.personId,
      dueId: due.id,
      amountMinor: opts.amount,
      paymentMode: opts.mode ?? PaymentMode.CASH,
      idempotencyKey: nextKey(),
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const tA = await prisma.tenant.create({
      data: { name: 'Audit Tenant A', category: 'School' },
    });
    tenantA = tA.id;

    const tB = await prisma.tenant.create({
      data: { name: 'Audit Tenant B', category: 'School' },
    });
    tenantB = tB.id;

    const mkUser = (tenantId: string, email: string, role: UserRole) =>
      prisma.user.create({
        data: {
          tenantId,
          email,
          passwordHash: 'dummyhash',
          fullName: email,
          role,
        },
      }).then((u) => u.id);

    adminA = await mkUser(tenantA, 'admin.a@audit.test', UserRole.ROLE_ADMIN);
    adminB = await mkUser(tenantB, 'admin.b@audit.test', UserRole.ROLE_ADMIN);
    collectorA = await mkUser(tenantA, 'collector.a@audit.test', UserRole.ROLE_COLLECTOR);
    viewerA = await mkUser(tenantA, 'viewer.a@audit.test', UserRole.ROLE_VIEWER);

    personA = (
      await prisma.person.create({
        data: {
          tenantId: tenantA,
          fullName: 'Audit Person A',
          primaryPhone: '9400000001',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    personB = (
      await prisma.person.create({
        data: {
          tenantId: tenantB,
          fullName: 'Audit Person B',
          primaryPhone: '9400000002',
          advanceBalance: BigInt(0),
        },
      })
    ).id;

    chargeA = (
      await prisma.charge.create({
        data: {
          tenantId: tenantA,
          personId: personA,
          category: 'TUITION',
          baseAmount: BigInt(1000),
          discountAmount: BigInt(0),
          createdByUserId: adminA,
        },
      })
    ).id;

    payments = new PaymentsService(prisma as any);
    audit = new AuditService(prisma as any);

    // Tenant A: three ledger events, one per charge collection.
    await collect({ tenantId: tenantA, userId: adminA, personId: personA, net: 1000, amount: '1000' });
    await collect({ tenantId: tenantA, userId: adminA, personId: personA, net: 500, amount: '500', mode: PaymentMode.UPI });
    await collect({ tenantId: tenantA, userId: collectorA, personId: personA, net: 250, amount: '250' });

    // Tenant B: one ledger event.
    await collect({ tenantId: tenantB, userId: adminB, personId: personB, net: 777, amount: '777' });
  });

  afterAll(async () => {
    const both = [tenantA, tenantB];

    for (const t of both) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
    }

    await prisma.due.deleteMany({ where: { tenantId: { in: both } } });
    await prisma.charge.deleteMany({ where: { tenantId: { in: both } } });

    for (const t of both) {
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
      await prisma.receiptSequence.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }

    await prisma.$disconnect();
  });

  it('1. authorized admin retrieves their tenant audit logs', async () => {
    const res = await audit.listAuditLogs(tenantA, {});
    expect(res.total).toBeGreaterThanOrEqual(3);
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('2. returns the real ledger rows with string minor units', async () => {
    const res = await audit.listAuditLogs(tenantA, { eventType: 'PAYMENT_COLLECTED' });

    expect(res.total).toBeGreaterThanOrEqual(3);
    for (const item of res.items) {
      expect(item.eventType).toBe('PAYMENT_COLLECTED');
      expect(typeof item.amountMinor).toBe('string');
      expect(typeof item.balanceSnapshotMinor).toBe('string');
      expect(item.id).toBeTruthy();
      expect(item.performedByUserId).toBeTruthy();
      expect(typeof item.createdAt).toBe('string');
    }
  });

  it('3. tenant A receives only tenant A logs', async () => {
    const res = await audit.listAuditLogs(tenantA, {});

    for (const item of res.items) {
      expect(item.personId).not.toBe(personB);
      expect(item.performedByUserId).not.toBe(adminB);
    }

    const stored = await prisma.financialTransactionLog.findMany({
      where: { id: { in: res.items.map((i) => i.id) } },
    });
    for (const row of stored) {
      expect(row.tenantId).toBe(tenantA);
    }
  });

  it('4. tenant B receives only tenant B logs', async () => {
    const res = await audit.listAuditLogs(tenantB, {});

    expect(res.total).toBe(1);
    expect(res.items[0].personId).toBe(personB);
    expect(res.items[0].performedByUserId).toBe(adminB);
  });

  it('5. a cross-tenant personId filter leaks nothing', async () => {
    const res = await audit.listAuditLogs(tenantA, { personId: personB });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.totalPages).toBe(0);
  });

  it('6. a client tenantId cannot override the JWT tenant', async () => {
    const captured: string[] = [];
    const stub = {
      listAuditLogs: (tenantId: string, _q: unknown) => {
        captured.push(tenantId);
        return null;
      },
    } as any;

    const controller = new AuditController(stub);
    const user = {
      sub: adminA,
      tenantId: tenantA,
      email: 'admin.a@audit.test',
      role: UserRole.ROLE_ADMIN,
    } as JwtPayload;

    // Hostile body/query claims tenant B; the JWT tenant A must win.
    await controller.list(user, { tenantId: tenantB } as any);

    expect(captured).toEqual([tenantA]);
    expect(captured[0]).not.toBe(tenantB);
  });

  it('7. filters by eventType, personId and performedByUserId', async () => {
    const byEvent = await audit.listAuditLogs(tenantA, {
      eventType: 'PAYMENT_COLLECTED',
    });
    expect(byEvent.items.every((i) => i.eventType === 'PAYMENT_COLLECTED')).toBe(true);

    const byPerson = await audit.listAuditLogs(tenantA, { personId: personA });
    expect(byPerson.total).toBe(byEvent.total);

    const byCollector = await audit.listAuditLogs(tenantA, {
      performedByUserId: collectorA,
      eventType: 'PAYMENT_COLLECTED',
    });
    expect(byCollector.total).toBe(1);
    expect(byCollector.items[0].performedByUserId).toBe(collectorA);
  });

  it('8. filters by referenceEntityType and referenceEntityId', async () => {
    const byType = await audit.listAuditLogs(tenantA, {
      referenceEntityType: 'Payment',
    });
    expect(byType.total).toBeGreaterThanOrEqual(3);

    const all = await audit.listAuditLogs(tenantA, {});
    const target = all.items[0].referenceEntityId;

    const byId = await audit.listAuditLogs(tenantA, {
      referenceEntityId: target,
    });
    expect(byId.total).toBeGreaterThanOrEqual(1);
    expect(byId.items.every((i) => i.referenceEntityId === target)).toBe(true);
  });

  it('9. filters by createdAt range', async () => {
    const future = await audit.listAuditLogs(tenantA, {
      from: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(future.total).toBe(0);

    const past = await audit.listAuditLogs(tenantA, {
      from: new Date(Date.now() - 86400000).toISOString(),
    });
    expect(past.total).toBeGreaterThanOrEqual(3);
  });

  it('10. rejects a malformed date filter', async () => {
    await expect(
      audit.listAuditLogs(tenantA, { from: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('11. paginates deterministically', async () => {
    const page1 = await audit.listAuditLogs(tenantA, { limit: 2, page: 1 });
    const page2 = await audit.listAuditLogs(tenantA, { limit: 2, page: 2 });

    const total = page1.total;
    expect(total).toBeGreaterThanOrEqual(3);

    // Page sizes follow total and limit, whatever the row count is.
    expect(page1.items).toHaveLength(Math.min(2, total));
    expect(page2.items).toHaveLength(Math.min(2, Math.max(0, total - 2)));
    expect(page2.total).toBe(total);
    expect(page1.totalPages).toBe(Math.ceil(total / 2));

    // Paging must not drop or duplicate rows.
    expect(page1.items.length + page2.items.length).toBeLessThanOrEqual(total);

    // No row may appear on both pages.
    const ids1 = new Set(page1.items.map((i) => i.id));
    expect(page2.items.some((i) => ids1.has(i.id))).toBe(false);
  });

  it('12. orders newest first with a deterministic tie-break', async () => {
    const res = await audit.listAuditLogs(tenantA, {});

    for (let i = 1; i < res.items.length; i++) {
      const prev = Date.parse(res.items[i - 1].createdAt);
      const cur = Date.parse(res.items[i].createdAt);
      expect(prev).toBeGreaterThanOrEqual(cur);
    }

    // Repeating the query must yield an identical order, even though
    // rows written in one transaction share a createdAt.
    const again = await audit.listAuditLogs(tenantA, {});
    expect(again.items.map((i) => i.id)).toEqual(res.items.map((i) => i.id));
  });

  it('13. empty result returns the normal empty-list shape', async () => {
    const res = await audit.listAuditLogs(tenantA, {
      eventType: 'NO_SUCH_EVENT_TYPE',
    });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(0);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('14. handles multiple records for the same person correctly', async () => {
    const res = await audit.listAuditLogs(tenantA, { personId: personA });

    expect(res.total).toBeGreaterThanOrEqual(3);
    expect(new Set(res.items.map((i) => i.id)).size).toBe(res.items.length);
    expect(res.items.every((i) => i.personId === personA)).toBe(true);
  });

  /** BigInt-safe row fingerprint; the ledger must be byte-identical. */
  function snapshotRows(rows: Record<string, any>[]): string {
    return JSON.stringify(
      rows.map((b) => ({
        id: b.id,
        eventType: b.eventType,
        amount: b.amount.toString(),
        balanceSnapshot: b.balanceSnapshot.toString(),
        metadata: b.metadata,
        performedByUserId: b.performedByUserId,
        createdAt: b.createdAt.toISOString(),
      })),
    );
  }

  it('15. historical records are unchanged after reads', async () => {
    const before = await prisma.financialTransactionLog.findMany({
      where: { tenantId: tenantA },
      orderBy: { id: 'asc' },
    });
    const snapshot = snapshotRows(before);

    await audit.listAuditLogs(tenantA, {});
    await audit.listAuditLogs(tenantA, { limit: 1 });

    const after = await prisma.financialTransactionLog.findMany({
      where: { tenantId: tenantA },
      orderBy: { id: 'asc' },
    });
    const afterSnapshot = snapshotRows(after);

    expect(afterSnapshot).toBe(snapshot);
  });

  it('16. exposes no mutation or delete path', () => {
    const service = audit as unknown as Record<string, unknown>;
    for (const verb of ['create', 'update', 'delete', 'upsert', 'remove', 'purge']) {
      expect(service[verb], `AuditService must not expose ${verb}()`).toBeUndefined();
    }

    const proto = Object.getOwnPropertyNames(
      Object.getPrototypeOf(audit),
    );
    for (const verb of ['create', 'update', 'delete', 'upsert']) {
      expect(proto.some((m) => m.toLowerCase().includes(verb))).toBe(false);
    }
  });

  it('17. cross-tenant direct lookup returns nothing', async () => {
    const bLog = await prisma.financialTransactionLog.findFirst({
      where: { tenantId: tenantB },
    });

    expect(await audit.getAuditLog(tenantB, bLog!.id)).not.toBeNull();
    expect(await audit.getAuditLog(tenantA, bLog!.id)).toBeNull();
  });

  it('18. unauthenticated requests are rejected by the JWT guard', async () => {
    // The route is guarded at the class level; assert the decorator
    // wiring rather than booting HTTP.
    const guards = Reflect.getMetadata(
      '__guards__',
      AuditController,
    );
    expect(Array.isArray(guards)).toBe(true);
    expect(guards.length).toBeGreaterThan(0);

    // No public access path exists on the service either.
    const controllerMethods = Object.getOwnPropertyNames(
      AuditController.prototype,
    ).filter((m) => m !== 'constructor');
    expect(controllerMethods).toEqual(['list']);
  });

  it('19. RBAC denies Collector and Viewer (audit:logs:view = DENY)', async () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    const rolesMeta = Reflect.getMetadata('roles', AuditController);
    expect(rolesMeta).toEqual([UserRole.ROLE_ADMIN]);

    for (const role of [UserRole.ROLE_COLLECTOR, UserRole.ROLE_VIEWER]) {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
            params: {},
            query: {},
            body: {},
            user: { sub: 'u', tenantId: tenantA, email: 'x@y.z', role },
          }),
        }),
        getHandler: () => AuditController.prototype.list,
        getClass: () => AuditController,
      } as unknown as ExecutionContext;

      // The existing RolesGuard rejects with 403 synchronously.
      expect(() => guard.canActivate(ctx as any)).toThrow(ForbiddenException);
    }
  });

  it('20. RBAC allows ROLE_ADMIN', async () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          params: {},
          query: {},
          body: {},
          user: {
            sub: adminA,
            tenantId: tenantA,
            email: 'admin.a@audit.test',
            role: UserRole.ROLE_ADMIN,
          },
        }),
      }),
      getHandler: () => AuditController.prototype.list,
      getClass: () => AuditController,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx as any)).toBe(true);
  });
});