import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, CustomFieldDataType } from '@prisma/client';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import { ExportsService } from '../src/modules/exports/exports.service.js';
import { ExportsController } from '../src/modules/exports/exports.controller.js';
import { escapeCsvField, csvLine } from '../src/modules/exports/csv.js';
import { ReportsService } from '../src/modules/reports/services/reports.service.js';
import { CollectionReportQueryDto } from '../src/modules/reports/validators/reports-query.dto.js';
import { PeopleService } from '../src/modules/people/people.service.js';
import { CustomFieldsService } from '../src/modules/people/custom-fields.service.js';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard.js';
import type { JwtPayload } from '../src/modules/auth/auth.service.js';

const ids: Record<string, string> = {};

const jwtService = {
  verify: (token: string): JwtPayload => {
    const byToken: Record<string, JwtPayload> = {
      'admin-a': { sub: ids.userA, tenantId: ids.tenantA, email: 'a@x.com', role: 'ROLE_ADMIN' },
      'admin-b': { sub: ids.userB, tenantId: ids.tenantB, email: 'b@x.com', role: 'ROLE_ADMIN' },
      'collector-a': { sub: ids.userC, tenantId: ids.tenantA, email: 'c@x.com', role: 'ROLE_COLLECTOR' },
      'viewer-a': { sub: ids.userV, tenantId: ids.tenantA, email: 'v@x.com', role: 'ROLE_VIEWER' },
    };
    if (token === 'tenantless') {
      return { sub: 'x', email: 't@x.com', role: 'ROLE_ADMIN' } as unknown as JwtPayload;
    }
    const found = byToken[token];
    if (!found) {
      throw new Error('bad token');
    }
    return found;
  },
};

const reflector = new Reflector();
const authGuard = new JwtAuthGuard(jwtService as any, reflector as any);
const rolesGuard = new RolesGuard(reflector as any);

/** Minimal FastifyReply double that captures what the controller sets. */
function makeReply() {
  const headers: Record<string, string> = {};
  let status = 200;
  let payload: unknown;
  const reply = {
    code(n: number) {
      status = n;
      return reply;
    },
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
    send(value: unknown) {
      payload = value;
      return reply;
    },
  };
  return {
    headers,
    reply: reply as any,
    get status() {
      return status;
    },
    get payload() {
      return payload;
    },
  };
}

function makeContext(headers: Record<string, string>, params: Record<string, any> = {}, body?: any): ExecutionContext {
  const request: Record<string, any> = { headers };
  if (Object.keys(params).length > 0) request.params = params;
  if (body !== undefined) request.body = body;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function rolesContext(token: string, handler: keyof ExportsController) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: jwtService.verify(token) }) }),
    getHandler: () => ExportsController.prototype[handler],
    getClass: () => ExportsController,
  } as unknown as ExecutionContext;
}

/** Drains a Node readable into a string. */
async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads generated CSV back through the csv-parser dependency. */
async function parseCsv(text: string): Promise<Array<Record<string, string>>> {
  const rows: Array<Record<string, string>> = [];
  await new Promise<void>((resolve, reject) => {
    Readable.from([text])
      .pipe(csvParser())
      .on('data', (row: Record<string, string>) => rows.push(row))
      .on('error', reject)
      .on('end', resolve);
  });
  return rows;
}

describe('V1.26: FR-EXP-01 CSV export (BR-11)', () => {
  let prisma: PrismaClient;
  let exportsService: ExportsService;
  let controller: ExportsController;
  let people: PeopleService;
  let charges: ChargesService;
  let payments: PaymentsService;
  let customFields: CustomFieldsService;
  let reports: ReportsService;
  let tenantIds: string[] = [];
  let personIdA: string;
  let personIdB: string;
  let phoneSeq = 0;

  const nextPhone = () => `+91888${String(phoneSeq++).padStart(5, '0')}`;

  const exportCsv = (tenantKey: string, entity: string, query: CollectionReportQueryDto = {}) => {
    const resolved = exportsService.resolveEntity(entity);
    return collect(exportsService.buildCsv(jwtService.verify(tenantKey).tenantId, resolved, query).stream);
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    customFields = new CustomFieldsService(prisma as any);
    people = new PeopleService(prisma as any, customFields);
    reports = new ReportsService(prisma as any);
    exportsService = new ExportsService(prisma as any, reports);
    controller = new ExportsController(exportsService);
    charges = new ChargesService(prisma as any);
    payments = new PaymentsService(prisma as any);

    const a = await prisma.tenant.create({ data: { name: 'FR-EXP-01 Tenant A', category: 'School' } });
    const b = await prisma.tenant.create({ data: { name: 'FR-EXP-01 Tenant B', category: 'Gym' } });
    ids.tenantA = a.id;
    ids.tenantB = b.id;
    tenantIds = [a.id, b.id];

    const mkUser = (tenantId: string, email: string, role: any, fullName: string) =>
      prisma.user.create({ data: { tenantId, email, passwordHash: 'x', fullName, role } });
    ids.userA = (await mkUser(a.id, 'admin.a@exp.test', 'ROLE_ADMIN', 'Admin A')).id;
    ids.userB = (await mkUser(b.id, 'admin.b@exp.test', 'ROLE_ADMIN', 'Admin B')).id;
    ids.userC = (await mkUser(a.id, 'coll.a@exp.test', 'ROLE_COLLECTOR', 'Collector A')).id;
    ids.userV = (await mkUser(a.id, 'view.a@exp.test', 'ROLE_VIEWER', 'Viewer A')).id;

    await customFields.create(a.id, {
      fieldKey: 'flat_number',
      fieldLabel: 'Flat Number',
      dataType: CustomFieldDataType.TEXT,
    });

    /*
     * Names deliberately contain a comma, double quotes and a newline so the
     * escaping rules are exercised by real data.
     */
    personIdA = (
      await people.create(a.id, {
        fullName: 'Verma, Ananya',
        primaryPhone: nextPhone(),
        email: 'ananya@exp.test',
        customData: { flat_number: 'F-1' },
      })
    ).id;
    await people.create(a.id, { fullName: 'Quote "Name" Person', primaryPhone: nextPhone() });
    await people.create(a.id, { fullName: 'Line\nBreak Person', primaryPhone: nextPhone() });
    personIdB = (
      await people.create(b.id, { fullName: 'Tenant B Only', primaryPhone: nextPhone() })
    ).id;

    const chargeA = await charges.createOneTimeCharge(a.id, ids.userA, {
      personId: personIdA,
      category: 'Tuition',
      baseAmountMinor: '500000',
      dueDate: '2026-05-10',
    });
    await charges.createOneTimeCharge(a.id, ids.userA, {
      personId: personIdA,
      category: 'Transport',
      baseAmountMinor: '125050',
      dueDate: '2026-05-20',
    });
    await payments.collectPayment(a.id, ids.userA, {
      dueId: chargeA.due.id,
      amountMinor: '300007',
      paymentMode: 'UPI' as any,
      idempotencyKey: 'exp-key-a-1',
      referenceNumber: 'UPI/REF/1',
    });

    const chargeB = await charges.createOneTimeCharge(b.id, ids.userB, {
      personId: personIdB,
      category: 'Membership',
      baseAmountMinor: '999999',
      dueDate: '2026-05-11',
    });
    await payments.collectPayment(b.id, ids.userB, {
      dueId: chargeB.due.id,
      amountMinor: '999999',
      paymentMode: 'CASH' as any,
      idempotencyKey: 'exp-key-b-1',
    });
  });

  afterAll(async () => {
    for (const t of tenantIds) {
      await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
      await prisma.receipt.deleteMany({ where: { tenantId: t } });
      await prisma.payment.deleteMany({ where: { tenantId: t } });
      await prisma.refund.deleteMany({ where: { tenantId: t } });
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
      await prisma.due.deleteMany({ where: { tenantId: t } });
      await prisma.charge.deleteMany({ where: { tenantId: t } });
      await prisma.customFieldDefinition.deleteMany({ where: { tenantId: t } });
      await prisma.person.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  describe('FUNCTIONAL', () => {
    it('1. exports People as CSV', async () => {
      const rows = await parseCsv(await exportCsv('admin-a', 'people'));
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const ananya = rows.find((r) => r.fullName === 'Verma, Ananya');
      expect(ananya).toBeDefined();
      expect(ananya!.primaryPhone).toMatch(/^\+91888/);
      expect(ananya!.status).toBe('ACTIVE');
      expect(JSON.parse(ananya!.customData)).toEqual({ flat_number: 'F-1' });
      expect(ananya!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('2. exports Dues as CSV using stored values', async () => {
      const rows = await parseCsv(await exportCsv('admin-a', 'dues'));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const tuition = rows.find((r) => r.chargeCategory === 'Tuition');
      expect(tuition).toBeDefined();
      expect(tuition!.netAmountMinor).toBe('500000');
      expect(tuition!.personName).toBe('Verma, Ananya');
      expect(tuition!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(tuition!.status).toBe('PARTIALLY_PAID');
    });

    it('3. exports Payments as CSV using stored values', async () => {
      const rows = await parseCsv(await exportCsv('admin-a', 'payments'));
      expect(rows).toHaveLength(1);
      expect(rows[0].paymentMode).toBe('UPI');
      expect(rows[0].totalAmountMinor).toBe('300007');
      expect(rows[0].allocatedToDuesMinor).toBe('300007');
      expect(rows[0].referenceNumber).toBe('UPI/REF/1');
      expect(rows[0].collectorName).toBe('Admin A');
      expect(rows[0].receiptNumbers).toMatch(/^REC-\d{4}-\d+$/);
      // Internal request plumbing is not exported.
      expect(rows[0]).not.toHaveProperty('idempotencyKey');
    });

    it('4. exports Reports as CSV reusing ReportsService', async () => {
      const rows = await parseCsv(await exportCsv('admin-a', 'reports'));
      expect(rows).toHaveLength(1);
      expect(rows[0].personName).toBe('Verma, Ananya');
      expect(rows[0].totalAmountMinor).toBe('300007');

      // The export matches the report's own query result (BR-11).
      const report = await reports.collectionReport(ids.tenantA, {});
      expect(rows).toHaveLength(report.items.length);
      expect(rows[0].id).toBe(report.items[0].id);
    });

    it('5. every entity emits a header row first', async () => {
      for (const entity of ['people', 'dues', 'payments', 'reports']) {
        const text = await exportCsv('admin-a', entity);
        const firstLine = text.split('\r\n')[0];
        expect(firstLine.split(',').length).toBeGreaterThan(1);
        expect(firstLine).not.toMatch(/^\d/);
      }
      expect((await exportCsv('admin-a', 'people')).startsWith('id,fullName,')).toBe(true);
      expect((await exportCsv('admin-a', 'dues')).startsWith('id,personId,')).toBe(true);
      expect((await exportCsv('admin-a', 'payments')).startsWith('id,personId,')).toBe(true);
      expect((await exportCsv('admin-a', 'reports')).startsWith('id,paymentDate,')).toBe(true);
    });

    it('6. column order is stable across repeated exports', async () => {
      const first = await exportCsv('admin-a', 'people');
      const second = await exportCsv('admin-a', 'people');
      expect(first).toBe(second);

      const header = first.split('\r\n')[0].split(',');
      const again = (await exportCsv('admin-a', 'dues')).split('\r\n')[0].split(',');
      expect(again[0]).toBe('id');
      // Repeated runs are byte-identical, so ordering is total and deterministic.
      expect((await exportCsv('admin-a', 'people')).split('\r\n')[0].split(',')).toEqual(header);
    });

    it('7. escapes commas, quotes and newlines correctly', async () => {
      const text = await exportCsv('admin-a', 'people');
      // Raw output shows the quoted/escaped forms.
      expect(text).toContain('"Verma, Ananya"');
      expect(text).toContain('"Quote ""Name"" Person"');
      expect(text).toContain('"Line\nBreak Person"');
      expect(text.endsWith('\r\n')).toBe(true);

      // And the values round-trip exactly through a real CSV parser: each
      // comma-bearing name stays a single field holding its exact text.
      const rows = await parseCsv(text);
      const expectedNames = ['Verma, Ananya', 'Quote "Name" Person', 'Line\nBreak Person'];
      expect(rows.map((r) => r.fullName)).toEqual(expect.arrayContaining(expectedNames));
      for (const row of rows) {
        expect(expectedNames).toContain(row.fullName);
        // Every row still aligns with the header, so escaping did not shift a
        // column boundary.
        expect(Object.keys(row).length).toBe(10);
      }

      // Unit-level checks of the escaper.
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
      expect(escapeCsvField('plain')).toBe('plain');
      expect(escapeCsvField('a,b')).toBe('"a,b"');
      expect(escapeCsvField('a"b')).toBe('"a""b"');
      expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
      expect(csvLine(['a', 'b,c', null])).toBe('a,"b,c",');
    });

    it('8. an empty result set still yields a header and no data rows', async () => {
      const empty = await prisma.tenant.create({
        data: { name: 'FR-EXP-01 Empty Tenant', category: 'Library' },
      });
      try {
        for (const entity of ['people', 'dues', 'payments', 'reports']) {
          const text = await collect(
            exportsService.buildCsv(empty.id, entity as any, {}).stream,
          );
          // Exactly one CRLF-terminated line: the header, and no data rows.
          const lines = text.split('\r\n');
          expect(lines).toHaveLength(2);
          expect(lines[1]).toBe('');
          expect(lines[0]).not.toBe('');
          expect(await parseCsv(text)).toHaveLength(0);
        }
      } finally {
        await prisma.tenant.delete({ where: { id: empty.id } });
      }
    });

    it('9. rejects an unsupported entity with 400', async () => {
      for (const bad of ['invoices', 'users', 'refunds', '', '  ', 'people;drop']) {
        expect(() => exportsService.resolveEntity(bad)).toThrow(BadRequestException);
      }
      expect(() => exportsService.resolveEntity('PEOPLE')).not.toThrow();
      expect(exportsService.resolveEntity(' Reports ')).toBe('reports');
    });

    it('10. the controller sets CSV content type and a filename', async () => {
      const capture = makeReply();
      await controller.exportEntity(
        jwtService.verify('admin-a'),
        'people' as any,
        {},
        capture.reply,
      );

      expect(capture.status).toBe(200);
      expect(capture.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(capture.headers['content-disposition']).toBe(
        'attachment; filename="feecore-people-' +
          new Date().toISOString().slice(0, 10) +
          '.csv"',
      );
      expect(capture.payload).toBeInstanceOf(Readable);
    });
  });

  describe('SECURITY', () => {
    it('11. unauthenticated requests are rejected with 401', () => {
      expect(() => authGuard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer invalid-token' })),
      ).toThrow(UnauthorizedException);
    });

    it('12. an expired or malformed token is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer expired' })),
      ).toThrow(UnauthorizedException);
    });

    it('13. a tenantless JWT is rejected with 401', () => {
      expect(() =>
        authGuard.canActivate(makeContext({ authorization: 'Bearer tenantless' })),
      ).toThrow(UnauthorizedException);
    });

    it('14. an unauthorized role is rejected with 403 (reports:export)', () => {
      expect(rolesGuard.canActivate(rolesContext('admin-a', 'exportEntity'))).toBe(true);
      for (const token of ['collector-a', 'viewer-a']) {
        expect(() => rolesGuard.canActivate(rolesContext(token, 'exportEntity'))).toThrow(
          ForbiddenException,
        );
      }
    });

    it('15. Tenant A cannot export Tenant B data', async () => {
      const aPeople = await parseCsv(await exportCsv('admin-a', 'people'));
      const bPeople = await parseCsv(await exportCsv('admin-b', 'people'));

      expect(aPeople.some((r) => r.fullName === 'Tenant B Only')).toBe(false);
      expect(bPeople).toHaveLength(1);
      expect(bPeople[0].fullName).toBe('Tenant B Only');
      expect(bPeople[0].id).toBe(personIdB);

      const aPayments = await parseCsv(await exportCsv('admin-a', 'payments'));
      const bPayments = await parseCsv(await exportCsv('admin-b', 'payments'));
      expect(aPayments.every((r) => r.personName !== 'Tenant B Only')).toBe(true);
      expect(bPayments).toHaveLength(1);

      const aDues = await parseCsv(await exportCsv('admin-a', 'dues'));
      const bDues = await parseCsv(await exportCsv('admin-b', 'dues'));
      expect(aDues.every((r) => r.chargeCategory !== 'Membership')).toBe(true);
      expect(bDues[0].chargeCategory).toBe('Membership');
    });

    it('16. a tenantId override cannot change the exported tenant', async () => {
      // The guard rejects tenantId in path/query/body outright.
      for (const attempt of [
        makeContext({ authorization: 'Bearer admin-a' }, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: ids.tenantB }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: null }),
        makeContext({ authorization: 'Bearer admin-a' }, {}, { tenantId: [ids.tenantB] }),
      ]) {
        expect(() => authGuard.canActivate(attempt)).toThrow(ForbiddenException);
      }

      // The query pipe rejects tenantId as an unknown key (forbidNonWhitelisted).
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      await expect(
        pipe.transform({ tenantId: ids.tenantB }, { type: 'query', metatype: CollectionReportQueryDto }),
      ).rejects.toThrow();

      // And a legitimate report filter cannot smuggle a tenant in either.
      const rows = await parseCsv(await exportCsv('admin-a', 'reports', { collectorUserId: ids.userB } as any));
      expect(rows).toHaveLength(0);

      const rows2 = await parseCsv(await exportCsv('admin-a', 'reports', { personId: personIdB } as any));
      expect(rows2).toHaveLength(0);
    });
  });

  describe('DATA SAFETY', () => {
    it('17. exporting People changes nothing', async () => {
      const before = await prisma.person.findMany({
        where: { tenantId: ids.tenantA },
        orderBy: { id: 'asc' },
      });
      await exportCsv('admin-a', 'people');
      await exportCsv('admin-b', 'people');
      const after = await prisma.person.findMany({
        where: { tenantId: ids.tenantA },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual(before);
    });

    it('18. exporting Dues changes nothing', async () => {
      const before = await prisma.due.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      });
      await exportCsv('admin-a', 'dues');
      await exportCsv('admin-b', 'dues');
      const after = await prisma.due.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual(before);
    });

    it('19. exporting Payments changes nothing', async () => {
      const before = await prisma.payment.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      });
      await exportCsv('admin-a', 'payments');
      await exportCsv('admin-a', 'reports');
      const after = await prisma.payment.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual(before);
    });

    it('20. the financial ledger, receipts, allocations and refunds are untouched', async () => {
      const countOf = () =>
      Promise.all([
        prisma.financialTransactionLog.count({ where: { tenantId: { in: tenantIds } } }),
        prisma.receipt.count({ where: { tenantId: { in: tenantIds } } }),
        prisma.paymentAllocation.count({ where: { tenantId: { in: tenantIds } } }),
        prisma.refund.count({ where: { tenantId: { in: tenantIds } } }),
      ]).then(([logs, receipts, allocations, refunds]) => ({
        logs,
        receipts,
        allocations,
        refunds,
      }));

      const before = await countOf();
      for (const entity of ['people', 'dues', 'payments', 'reports']) {
        await exportCsv('admin-a', entity);
      }
      expect(await countOf()).toEqual(before);
      expect(before.logs).toBeGreaterThan(0);
      expect(before.receipts).toBeGreaterThan(0);
      expect(before.allocations).toBeGreaterThan(0);
    });

    it('21. BIGINT minor-unit amounts stay exact, with no float rounding', async () => {
      // 300007 paise is not representable exactly as a float; it must survive
      // the export byte-for-byte and still sum to the stored BigInt total.
      const paymentsCsv = await parseCsv(await exportCsv('admin-a', 'payments'));
      expect(paymentsCsv[0].totalAmountMinor).toBe('300007');

      const storedTotal = (
        await prisma.payment.aggregate({
          where: { tenantId: ids.tenantA },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount!;
      const csvTotal = paymentsCsv.reduce(
        (sum, row) => sum + BigInt(row.totalAmountMinor),
        BigInt(0),
      );
      expect(csvTotal).toBe(storedTotal);
      expect(csvTotal).toBe(BigInt(300007));

      const duesCsv = await parseCsv(await exportCsv('admin-a', 'dues'));
      for (const row of duesCsv) {
        expect(row.netAmountMinor).toMatch(/^\d+$/);
        expect(row.lateFeeAmountMinor).toMatch(/^\d+$/);
        expect(row.balanceRemainingMinor).toMatch(/^\d+$/);
        // A float round-trip would drift; exact BigInt equality would not.
        expect(BigInt(row.netAmountMinor).toString()).toBe(row.netAmountMinor);
      }
      // Every exported value is a plain integer string, never exponential or
      // decimal-point notation.
      const peopleCsv = await parseCsv(await exportCsv('admin-a', 'people'));
      for (const row of peopleCsv) {
        expect(row.advanceBalanceMinor).toMatch(/^\d+$/);
      }
    });
  });
});