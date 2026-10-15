/*
 * HTTP verification of the V1.30 route aliases against the COMPILED artifact
 * (dist/), because vitest/esbuild cannot emit `design:paramtypes` and therefore
 * cannot exercise Nest DI over HTTP. Run with:
 *   node test/verify-aliases.cjs
 */
require('reflect-metadata');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.resolve(__dirname, '..');
const { AppModule } = require(path.join(ROOT, 'dist/main/app.module.js'));
const { PeopleService } = require(path.join(ROOT, 'dist/modules/people/people.service.js'));
const { CustomFieldsService } = require(path.join(ROOT, 'dist/modules/people/custom-fields.service.js'));
const { ChargesService } = require(path.join(ROOT, 'dist/modules/charges/charges.service.js'));
const { PaymentsService } = require(path.join(ROOT, 'dist/modules/payments/payments.service.js'));

const SECRET = process.env.JWT_SECRET || 'feecore-super-secret-key-change-in-prod-2026';
const ids = {};
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const prisma = new PrismaClient();
  const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const server = app.getHttpServer();

  const customFields = new CustomFieldsService(prisma);
  const people = new PeopleService(prisma, customFields);
  const charges = new ChargesService(prisma);
  const payments = new PaymentsService(prisma);

  const a = await prisma.tenant.create({ data: { name: 'V130 Alias A', category: 'School', timezone: 'Asia/Kolkata' } });
  const b = await prisma.tenant.create({ data: { name: 'V130 Alias B', category: 'Gym', timezone: 'Asia/Kolkata' } });
  ids.a = a.id; ids.b = b.id;
  const mk = (t, e, r) => prisma.user.create({ data: { tenantId: t, email: e, passwordHash: 'x', fullName: e, role: r } });
  ids.adminA = (await mk(a.id, 'a.admin@v130.test', 'ROLE_ADMIN')).id;
  ids.adminB = (await mk(b.id, 'b.admin@v130.test', 'ROLE_ADMIN')).id;
  ids.collA = (await mk(a.id, 'a.coll@v130.test', 'ROLE_COLLECTOR')).id;
  ids.viewA = (await mk(a.id, 'a.view@v130.test', 'ROLE_VIEWER')).id;

  await people.create(a.id, { fullName: 'Alias Person Alpha', primaryPhone: '+918880000001', email: 'alpha@v130.test' });
  const pB = (await people.create(a.id, { fullName: 'Alias Person Beta', primaryPhone: '+918880000002' })).id;
  await people.create(a.id, { fullName: 'Alias Person Gamma', primaryPhone: '+918880000003' });
  await people.create(b.id, { fullName: 'Alias Person Alpha', primaryPhone: '+918880000099' });

  const chA = await charges.createOneTimeCharge(a.id, ids.adminA, { personId: pB, category: 'Tuition', baseAmountMinor: '800000', dueDate: '2026-05-10' });
  const payA = await payments.collectPayment(a.id, ids.adminA, { dueId: chA.due.id, amountMinor: '600000', paymentMode: 'CASH', idempotencyKey: 'v130-a-1', referenceNumber: 'CASH/A/1' });
  const allocA = payA.allocation.id;

  const tok = (sub, t, r) => jwt.sign({ sub, tenantId: t, email: 'x@y.z', role: r }, SECRET, { expiresIn: '8h' });
  const H = (t) => ({ Authorization: 'Bearer ' + t });
  const T = {
    adminA: tok(ids.adminA, a.id, 'ROLE_ADMIN'),
    adminB: tok(ids.adminB, b.id, 'ROLE_ADMIN'),
    collA: tok(ids.collA, a.id, 'ROLE_COLLECTOR'),
    viewA: tok(ids.viewA, a.id, 'ROLE_VIEWER'),
    expired: jwt.sign({ sub: ids.adminA, tenantId: a.id, role: 'ROLE_ADMIN' }, SECRET, { expiresIn: '-1h' }),
    tenantless: jwt.sign({ sub: ids.adminA, role: 'ROLE_ADMIN' }, SECRET, { expiresIn: '8h' }),
  };
  const P = '/api/v1';

  console.log('\n== 1. alias routes are served, not redirected ==');
  for (const [m, p, tok] of [
    ['get', `${P}/people?query=Alpha`, T.adminA],
    ['get', `${P}/dashboard/metrics`, T.adminA],
    ['get', `${P}/reports/collections`, T.adminA],
    ['get', `${P}/reports/dues`, T.adminA],
    ['post', `${P}/jobs/generate-dues`, T.adminA],
  ]) {
    const r = await request(server)[m](p).set(H(tok)).send({});
    check(`${m.toUpperCase()} ${p}`, r.status === 200 && r.status < 300, r.status);
  }
  const rf = await request(server).post(`${P}/refunds/due-allocation`).set(H(T.adminA))
    .send({ paymentAllocationId: allocA, refundAmountMinor: '1000', refundMode: 'CASH', refundReason: 'alias' });
  check(`POST ${P}/refunds/due-allocation`, rf.status === 201, rf.status);

  console.log('\n== 2. existing tenants/:tenantId routes still work ==');
  for (const [m, p] of [
    ['get', `${P}/tenants/${a.id}/people?query=Alias`],
    ['get', `${P}/tenants/${a.id}/dashboard/metrics`],
    ['get', `${P}/tenants/${a.id}/reports/collections`],
    ['get', `${P}/tenants/${a.id}/reports/dues`],
    ['get', `${P}/tenants/${a.id}/dues/overdue`],
    ['get', `${P}/tenants/${a.id}/dues`],
    ['get', `${P}/tenants/${a.id}/refunds`],
  ]) {
    const r = await request(server)[m](p).set(H(T.adminA));
    check(`${m.toUpperCase()} ${p.replace(a.id, ':tenantId')}`, r.status === 200, r.status);
  }
  const g2 = await request(server).post(`${P}/tenants/${a.id}/dues/generate`).set(H(T.adminA)).send({});
  check(`POST ${P}/tenants/:tenantId/dues/generate`, g2.status === 200, g2.status);

  console.log('\n== 3. authentication (401) ==');
  for (const [label, t] of [['none', null], ['invalid', 'garbage'], ['expired', T.expired], ['tenantless', T.tenantless]]) {
    for (const [m, p] of [
      ['get', `${P}/people?query=Alpha`], ['get', `${P}/dashboard/metrics`],
      ['get', `${P}/reports/collections`], ['get', `${P}/reports/dues`],
      ['post', `${P}/jobs/generate-dues`], ['post', `${P}/refunds/due-allocation`],
    ]) {
      let rq = request(server)[m](p).send({});
      if (t) rq = rq.set(H(t));
      const r = await rq;
      check(`401 ${label} ${m.toUpperCase()} ${p}`, r.status === 401, r.status);
    }
  }

  console.log('\n== 4. authorization matches originals ==');
  check('viewer denied jobs/generate-dues (alias)', (await request(server).post(`${P}/jobs/generate-dues`).set(H(T.viewA)).send({})).status === 403);
  check('viewer denied dues/generate (original)', (await request(server).post(`${P}/tenants/${a.id}/dues/generate`).set(H(T.viewA)).send({})).status === 403);
  check('collector allowed jobs/generate-dues', (await request(server).post(`${P}/jobs/generate-dues`).set(H(T.collA)).send({})).status === 200);
  check('collector denied refunds/due-allocation', (await request(server).post(`${P}/refunds/due-allocation`).set(H(T.collA)).send({})).status === 403);
  check('viewer denied refunds/due-allocation', (await request(server).post(`${P}/refunds/due-allocation`).set(H(T.viewA)).send({})).status === 403);
  for (const t of [T.adminA, T.collA, T.viewA]) {
    check(`people:view allowed for ${t === T.adminA ? 'admin' : t === T.collA ? 'collector' : 'viewer'}`,
      (await request(server).get(`${P}/people?query=Alias`).set(H(t))).status === 200);
  }

  console.log('\n== 5. tenantId override rejected ==');
  const ov = await request(server).get(`${P}/people?query=Alpha&tenantId=${b.id}`).set(H(T.adminA));
  check('query tenantId -> 403', ov.status === 403, ov.status);
  const ov2 = await request(server).post(`${P}/jobs/generate-dues`).set(H(T.adminA)).send({ tenantId: b.id });
  check('body tenantId rejected', ov2.status !== 200, ov2.status);
  for (const v of ['', 'null', '[]', `["${b.id}"]`, `{"id":"${b.id}"}`]) {
    const r = await request(server).get(`${P}/people?query=Alpha&tenantId=${encodeURIComponent(v)}`).set(H(T.adminA));
    check(`tenantId=${v || '(empty)'} -> 403`, r.status === 403, r.status);
  }

  console.log('\n== 6. tenant isolation ==');
  const listA = await request(server).get(`${P}/people`).set(H(T.adminA));
  check('tenant A list scoped', listA.body.items.every((p) => p.tenantId === a.id));
  const listB = await request(server).get(`${P}/people`).set(H(T.adminB));
  check('tenant B sees only its own', listB.body.total === 1 && listB.body.items[0].tenantId === b.id, listB.body.total);
  const crossTerm = '+918880000099';
  check('cross-tenant phone not searchable by A', (await request(server).get(`${P}/people?query=${encodeURIComponent(crossTerm)}`).set(H(T.adminA))).body.total === 0);
  const repA = await request(server).get(`${P}/reports/collections`).set(H(T.adminA));
  check('tenant A report total 600000', repA.body.totals.grossCollectedMinor === '600000', repA.body.totals);

  console.log('\n== 7. equivalence with originals ==');
  const e1 = await request(server).get(`${P}/people?query=Alias`).set(H(T.adminA));
  const e1o = await request(server).get(`${P}/tenants/${a.id}/people?query=Alias`).set(H(T.adminA));
  check('people alias body ===', JSON.stringify(e1.body) === JSON.stringify(e1o.body));
  for (const [leaf, qs] of [['dashboard/metrics', ''], ['dashboard/metrics', '?asOf=2026-05-20'], ['reports/collections', ''], ['reports/collections', '?from=2026-01-01&to=2026-12-31'], ['reports/dues', ''], ['reports/dues', '?status=OVERDUE']]) {
    const x = await request(server).get(`${P}/${leaf}${qs}`).set(H(T.adminA));
    const y = await request(server).get(`${P}/tenants/${a.id}/${leaf}${qs}`).set(H(T.adminA));
    check(`${leaf}${qs} equivalent`, x.status === 200 && JSON.stringify(x.body) === JSON.stringify(y.body), { alias: x.status, orig: y.status });
  }

  console.log('\n== 8. FR-PER-02 search semantics ==');
  check('partial -> 3', (await request(server).get(`${P}/people?query=Alias`).set(H(T.adminA))).body.total === 3);
  check('narrow -> 1', (await request(server).get(`${P}/people?query=Beta`).set(H(T.adminA))).body.total === 1);
  check('phone search', (await request(server).get(`${P}/people?query=${encodeURIComponent('+918880000003')}`).set(H(T.adminA))).body.total === 1);
  check('email search', (await request(server).get(`${P}/people?query=alpha@v130.test`).set(H(T.adminA))).body.total === 1);
  check('no match -> 0', (await request(server).get(`${P}/people?query=NoSuchThing`).set(H(T.adminA))).body.total === 0);
  const pg = await request(server).get(`${P}/people?query=Alias&page=2&limit=2`).set(H(T.adminA));
  check('pagination', pg.body.page === 2 && pg.body.limit === 2 && pg.body.total === 3 && pg.body.totalPages === 2 && pg.body.items.length === 1, pg.body);
  check('?search= alias still works', (await request(server).get(`${P}/people?search=Beta`).set(H(T.adminA))).body.total === 1);
  const prec = await request(server).get(`${P}/people?query=Beta&search=Alias`).set(H(T.adminA));
  check('precedence query>search', prec.body.total === 1 && prec.body.items[0].fullName === 'Alias Person Beta', prec.body.total);
  check('unknown param -> 400', (await request(server).get(`${P}/people?bogus=1`).set(H(T.adminA))).status === 400);
  check('unknown param -> 400 (original)', (await request(server).get(`${P}/tenants/${a.id}/people?bogus=1`).set(H(T.adminA))).status === 400);

  console.log('\n== 9. generate-dues idempotency ==');
  const before = await prisma.due.count({ where: { tenantId: a.id } });
  const g3 = await request(server).post(`${P}/jobs/generate-dues`).set(H(T.adminA)).send({});
  const g4 = await request(server).post(`${P}/jobs/generate-dues`).set(H(T.adminA)).send({});
  check('no duplicates created', g3.body.generatedDues === 0 && g4.body.generatedDues === 0 && (await prisma.due.count({ where: { tenantId: a.id } })) === before, { g3: g3.body, g4: g4.body });

  console.log('\n== 10. financial safety ==');
  const snap = async () => JSON.stringify({
    d: await prisma.due.findMany({ where: { tenantId: { in: [a.id, b.id] } }, orderBy: { id: 'asc' } }),
    p: await prisma.payment.count({ where: { tenantId: { in: [a.id, b.id] } } }),
    al: await prisma.paymentAllocation.findMany({ where: { tenantId: { in: [a.id, b.id] } }, orderBy: { id: 'asc' } }),
    rf: await prisma.refund.count({ where: { tenantId: { in: [a.id, b.id] } } }),
    rc: await prisma.receipt.count({ where: { tenantId: { in: [a.id, b.id] } } }),
    lg: await prisma.financialTransactionLog.count({ where: { tenantId: { in: [a.id, b.id] } } }),
  });
  const s0 = await snap();
  for (let i = 0; i < 3; i++) {
    await request(server).get(`${P}/people?query=Alias`).set(H(T.adminA));
    await request(server).get(`${P}/dashboard/metrics`).set(H(T.adminA));
    await request(server).get(`${P}/reports/collections`).set(H(T.adminA));
    await request(server).get(`${P}/reports/dues`).set(H(T.adminA));
    await request(server).get(`${P}/people`).set(H(T.adminB));
  }
  check('read-only aliases cause zero writes', (await snap()) === s0);

  const rfd = await prisma.refund.findFirst({ where: { tenantId: a.id } });
  check('refund recorded with exact minor units', rfd.refundAmount === BigInt(1000) && rfd.refundReason === 'alias', String(rfd.refundAmount));
  const badBody = { paymentAllocationId: allocA, refundMode: 'CASH' };
  check('missing fields -> 400 (alias)', (await request(server).post(`${P}/refunds/due-allocation`).set(H(T.adminA)).send(badBody)).status === 400);
  check('missing fields -> 400 (original)', (await request(server).post(`${P}/tenants/${a.id}/refunds/allocations`).set(H(T.adminA)).send(badBody)).status === 400);

  console.log('\n== cleanup ==');
  await app.close();
  for (const t of [a.id, b.id]) {
    await prisma.refund.deleteMany({ where: { tenantId: t } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
    await prisma.receipt.deleteMany({ where: { tenantId: t } });
    await prisma.payment.deleteMany({ where: { tenantId: t } });
    await prisma.financialTransactionLog.deleteMany({ where: { tenantId: t } });
    await prisma.due.deleteMany({ where: { tenantId: t } });
    await prisma.charge.deleteMany({ where: { tenantId: t } });
    await prisma.person.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.deleteMany({ where: { id: t } });
  }
  await prisma.$disconnect();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
