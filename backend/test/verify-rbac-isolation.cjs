const http = require('http');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const BASE_URL = 'http://127.0.0.1:4000/api/v1';

const CREDENTIALS = {
  admin: {
    email: 'admin@feecore.dev',
    password: 'Password@123',
    role: 'ROLE_ADMIN',
  },
  collector: {
    email: 'demo.collector@feecore.dev',
    password: 'CollectorDemo@2026!',
    role: 'ROLE_COLLECTOR',
  },
  viewer: {
    email: 'demo.user@feecore.dev',
    password: 'UserDemo@2026!',
    role: 'ROLE_VIEWER',
  },
};

function req(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const r = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function login(email, password) {
  const res = await req('POST', `/tenants/${TENANT_ID}/auth/login`, { email, password });
  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(`Login failed for ${email} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function run() {
  console.log('====================================================');
  console.log('FEECORE PRE-DEPLOYMENT RBAC & ISOLATION VERIFICATION');
  console.log('====================================================\n');

  const tokens = {};
  const users = {};

  // 1. Authenticate Demo Accounts
  console.log('--- 1. Authenticating Demo Accounts ---');
  for (const [key, creds] of Object.entries(CREDENTIALS)) {
    try {
      const data = await login(creds.email, creds.password);
      tokens[key] = data.accessToken;
      users[key] = data.user;
      console.log(`  PASS: ${creds.role} (${creds.email}) authenticated. User ID: ${data.user.id}`);
    } catch (err) {
      console.error(`  FAIL: ${creds.role} login failed: ${err.message}`);
    }
  }

  // 2. Admin Permissions & Capabilities
  console.log('\n--- 2. Verifying Admin Capabilities (ROLE_ADMIN) ---');
  {
    // Audit logs
    const res = await req('GET', '/audit-logs', null, tokens.admin);
    console.log(`  Audit logs access: ${res.status === 200 ? 'PASS (200)' : `FAIL (${res.status})`}`);

    // Org profile update
    const profRes = await req('GET', '/tenant/profile', null, tokens.admin);
    console.log(`  Org profile read: ${profRes.status === 200 ? 'PASS (200)' : `FAIL (${profRes.status})`}`);

    // Terminology
    const termRes = await req('GET', '/tenant/terminology', null, tokens.admin);
    console.log(`  Terminology read: ${termRes.status === 200 ? 'PASS (200)' : `FAIL (${termRes.status})`}`);

    // Export
    const expRes = await req('GET', '/exports/people', null, tokens.admin);
    console.log(`  Export people: ${expRes.status === 200 ? 'PASS (200)' : `FAIL (${expRes.status})`}`);
  }

  // 3. Collector Permissions & Restrictions (ROLE_COLLECTOR)
  console.log('\n--- 3. Verifying Collector Isolation (ROLE_COLLECTOR) ---');
  {
    // Should be PERMITTED:
    // Read people
    const pRes = await req('GET', `/tenants/${TENANT_ID}/people`, null, tokens.collector);
    console.log(`  Read people: ${pRes.status === 200 ? 'PASS (200)' : `FAIL (${pRes.status})`}`);

    // Read dues
    const dRes = await req('GET', `/tenants/${TENANT_ID}/dues`, null, tokens.collector);
    console.log(`  Read dues: ${dRes.status === 200 ? 'PASS (200)' : `FAIL (${dRes.status})`}`);

    // Read receipts
    const rRes = await req('GET', `/tenants/${TENANT_ID}/receipts`, null, tokens.collector);
    console.log(`  Read receipts: ${rRes.status === 200 ? 'PASS (200)' : `FAIL (${rRes.status})`}`);

    // Generate dues (allowed for Collector per SRS)
    const genRes = await req('POST', `/tenants/${TENANT_ID}/dues/generate`, {}, tokens.collector);
    console.log(`  Generate dues: ${genRes.status === 200 || genRes.status === 201 ? 'PASS' : `FAIL (${genRes.status})`}`);

    // Should be FORBIDDEN:
    // Audit logs -> 403
    const auditRes = await req('GET', '/audit-logs', null, tokens.collector);
    console.log(`  Access audit logs (should be 403): ${auditRes.status === 403 ? 'PASS (403)' : `FAIL (${auditRes.status})`}`);

    // Export people -> 403
    const expRes = await req('GET', '/exports/people', null, tokens.collector);
    console.log(`  Export people (should be 403): ${expRes.status === 403 ? 'PASS (403)' : `FAIL (${expRes.status})`}`);

    // Terminology write -> 403
    const termRes = await req('PUT', '/tenant/terminology', { personLabelSingular: 'Member' }, tokens.collector);
    console.log(`  Modify terminology (should be 403): ${termRes.status === 403 ? 'PASS (403)' : `FAIL (${termRes.status})`}`);

    // Org profile write -> 403
    const orgRes = await req('PUT', '/tenant/profile', { legalName: 'Hacked' }, tokens.collector);
    console.log(`  Modify org profile (should be 403): ${orgRes.status === 403 ? 'PASS (403)' : `FAIL (${orgRes.status})`}`);

    // Deactivate person -> 403
    const deactRes = await req('POST', `/tenants/${TENANT_ID}/people/dummy-id/deactivate`, {}, tokens.collector);
    console.log(`  Deactivate person (should be 403): ${deactRes.status === 403 ? 'PASS (403)' : `FAIL (${deactRes.status})`}`);

    // Waive late fee -> 403
    const waiveRes = await req('POST', `/tenants/${TENANT_ID}/dues/dummy-id/waive-late-fee`, { reason: 'test' }, tokens.collector);
    console.log(`  Waive late fee (should be 403): ${waiveRes.status === 403 ? 'PASS (403)' : `FAIL (${waiveRes.status})`}`);

    // Process refund -> 403
    const refRes = await req('POST', `/tenants/${TENANT_ID}/refunds/allocations`, { paymentAllocationId: 'dummy', refundAmountMinor: '100', refundMode: 'CASH', refundReason: 'test' }, tokens.collector);
    console.log(`  Process refund (should be 403): ${refRes.status === 403 ? 'PASS (403)' : `FAIL (${refRes.status})`}`);
  }

  // 4. Viewer Permissions & Restrictions (ROLE_VIEWER)
  console.log('\n--- 4. Verifying Viewer Isolation (ROLE_VIEWER) ---');
  {
    // Should be FORBIDDEN:
    // Create person -> 403
    const createP = await req('POST', `/tenants/${TENANT_ID}/people`, { fullName: 'Test', primaryPhone: '+919999900000' }, tokens.viewer);
    console.log(`  Create person (should be 403): ${createP.status === 403 ? 'PASS (403)' : `FAIL (${createP.status})`}`);

    // Create charge -> 403
    const createC = await req('POST', `/tenants/${TENANT_ID}/charges`, { personId: 'x', category: 'FEE', baseAmountMinor: '100', dueDate: '2026-12-31' }, tokens.viewer);
    console.log(`  Create charge (should be 403): ${createC.status === 403 ? 'PASS (403)' : `FAIL (${createC.status})`}`);

    // Collect payment -> 403
    const collectP = await req('POST', `/tenants/${TENANT_ID}/payments`, { dueId: 'x', amountPaidMinor: '100', paymentMode: 'CASH' }, tokens.viewer);
    console.log(`  Collect payment (should be 403): ${collectP.status === 403 ? 'PASS (403)' : `FAIL (${collectP.status})`}`);

    // Generate dues -> 403
    const genD = await req('POST', `/tenants/${TENANT_ID}/dues/generate`, {}, tokens.viewer);
    console.log(`  Generate dues (should be 403): ${genD.status === 403 ? 'PASS (403)' : `FAIL (${genD.status})`}`);

    // Audit logs -> 403
    const auditRes = await req('GET', '/audit-logs', null, tokens.viewer);
    console.log(`  Access audit logs (should be 403): ${auditRes.status === 403 ? 'PASS (403)' : `FAIL (${auditRes.status})`}`);

    // Deactivate person -> 403
    const deactRes = await req('POST', `/tenants/${TENANT_ID}/people/dummy-id/deactivate`, {}, tokens.viewer);
    console.log(`  Deactivate person (should be 403): ${deactRes.status === 403 ? 'PASS (403)' : `FAIL (${deactRes.status})`}`);

    // Process refund -> 403
    const refRes = await req('POST', `/tenants/${TENANT_ID}/refunds/allocations`, { paymentAllocationId: 'dummy', refundAmountMinor: '100', refundMode: 'CASH', refundReason: 'test' }, tokens.viewer);
    console.log(`  Process refund (should be 403): ${refRes.status === 403 ? 'PASS (403)' : `FAIL (${refRes.status})`}`);

    // Waive late fee -> 403
    const waiveRes = await req('POST', `/tenants/${TENANT_ID}/dues/dummy-id/waive-late-fee`, { reason: 'test' }, tokens.viewer);
    console.log(`  Waive late fee (should be 403): ${waiveRes.status === 403 ? 'PASS (403)' : `FAIL (${waiveRes.status})`}`);
  }

  // 5. Financial Data Isolation (Viewer vs Admin vs Collector)
  console.log('\n--- 5. Financial Data Isolation Investigation ---');
  {
    // Can Viewer read organization-wide dashboard metrics?
    const dashRes = await req('GET', `/tenants/${TENANT_ID}/dashboard/metrics`, null, tokens.viewer);
    console.log(`  Viewer GET /dashboard/metrics status: ${dashRes.status}`);

    // Can Viewer read all people in tenant?
    const peopleRes = await req('GET', `/tenants/${TENANT_ID}/people`, null, tokens.viewer);
    console.log(`  Viewer GET /people status: ${peopleRes.status}, count: ${peopleRes.body?.data?.length ?? 'N/A'}`);

    // Can Viewer read all dues in tenant?
    const duesRes = await req('GET', `/tenants/${TENANT_ID}/dues`, null, tokens.viewer);
    console.log(`  Viewer GET /dues status: ${duesRes.status}, count: ${duesRes.body?.data?.length ?? 'N/A'}`);

    // Can Viewer read collection reports? (should be 403)
    const collRepRes = await req('GET', `/tenants/${TENANT_ID}/reports/collections`, null, tokens.viewer);
    console.log(`  Viewer GET /reports/collections (should be 403): ${collRepRes.status === 403 ? 'PASS (403)' : `FAIL (${collRepRes.status})`}`);

    // Can Viewer read dues report? (should be 403)
    const duesRepRes = await req('GET', `/tenants/${TENANT_ID}/reports/dues`, null, tokens.viewer);
    console.log(`  Viewer GET /reports/dues (should be 403): ${duesRepRes.status === 403 ? 'PASS (403)' : `FAIL (${duesRepRes.status})`}`);
  }

  console.log('\n====================================================');
}

run().catch((e) => console.error('FATAL:', e));
