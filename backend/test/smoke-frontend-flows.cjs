const http = require('http');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const EMAIL = 'admin@feecore.dev';
const PASSWORD = 'Password@123';
const BASE_URL = 'http://127.0.0.1:4000/api/v1';

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            resolve({ status: res.statusCode, body: parsed, raw: data });
          } catch (e) {
            resolve({ status: res.statusCode, body: data, raw: data });
          }
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('--- FEECORE PHASE 4 TASK 4: FRONTEND FUNCTIONAL VERIFICATION ---');

  // 1. LOGIN
  console.log('\n1. Testing Login...');
  const loginRes = await request('POST', `/tenants/${TENANT_ID}/auth/login`, {
    email: EMAIL,
    password: PASSWORD,
  });
  if (loginRes.status !== 200 || !loginRes.body?.accessToken) {
    throw new Error(`Login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }
  const token = loginRes.body.accessToken;
  console.log('✓ Login successful! Token received.');

  // 2. DASHBOARD METRICS
  console.log('\n2. Testing Dashboard Metrics...');
  const dashRes = await request('GET', `/tenants/${TENANT_ID}/dashboard/metrics`, null, token);
  if (dashRes.status !== 200) {
    throw new Error(`Dashboard metrics failed with status ${dashRes.status}`);
  }
  console.log('✓ Dashboard metrics loaded successfully:', JSON.stringify(dashRes.body));

  // 3. PEOPLE
  console.log('\n3. Testing People (Create & List)...');
  const personRes = await request(
    'POST',
    `/tenants/${TENANT_ID}/people`,
    {
      fullName: 'Rahul Sharma',
      primaryPhone: '+919876543210',
      email: 'rahul.sharma@example.com',
    },
    token,
  );
  if (personRes.status !== 201 && personRes.status !== 200) {
    throw new Error(`Create person failed with status ${personRes.status}: ${JSON.stringify(personRes.body)}`);
  }
  const personId = personRes.body.id;
  console.log(`✓ Person created successfully (ID: ${personId})`);

  const listPeopleRes = await request('GET', `/tenants/${TENANT_ID}/people`, null, token);
  if (listPeopleRes.status !== 200 || !listPeopleRes.body.items?.some((p) => p.id === personId)) {
    throw new Error(`List people failed to find created person`);
  }
  console.log(`✓ People list verified (total: ${listPeopleRes.body.total})`);

  // 4. CHARGES & DUES CREATION
  console.log('\n4. Testing One-Time Charge creation...');
  const chargeRes = await request(
    'POST',
    `/tenants/${TENANT_ID}/charges`,
    {
      personId,
      category: 'Tuition',
      description: 'Term 1 Tuition Fee',
      baseAmountMinor: '500000', // ₹5,000.00
      dueDate: '2026-11-01T00:00:00.000Z',
    },
    token,
  );
  if (chargeRes.status !== 201 && chargeRes.status !== 200) {
    throw new Error(`Create charge failed with status ${chargeRes.status}: ${JSON.stringify(chargeRes.body)}`);
  }
  console.log('✓ One-time charge created successfully:', chargeRes.body.charge?.id);

  // 5. DUES
  console.log('\n5. Testing Dues list...');
  const duesRes = await request('GET', `/tenants/${TENANT_ID}/dues?personId=${personId}`, null, token);
  if (duesRes.status !== 200 || duesRes.body.items?.length === 0) {
    throw new Error(`Dues list failed: ${JSON.stringify(duesRes.body)}`);
  }
  const due = duesRes.body.items[0];
  console.log(`✓ Due verified (ID: ${due.id}, Status: ${due.status}, Balance: ₹${Number(due.balanceRemainingMinor)/100})`);

  // 6. PAYMENT
  console.log('\n6. Testing Payment Collection...');
  const idempotencyKey = `smoke-pay-${Date.now()}`;
  const payRes = await request(
    'POST',
    `/tenants/${TENANT_ID}/payments`,
    {
      dueId: due.id,
      paymentMode: 'CASH',
      amountMinor: '200000', // ₹2,000.00 partial payment
      notes: 'Smoke test partial payment',
      idempotencyKey,
    },
    token,
  );
  if (payRes.status !== 201 && payRes.status !== 200) {
    throw new Error(`Payment collection failed with status ${payRes.status}: ${JSON.stringify(payRes.body)}`);
  }
  const payment = payRes.body.payment;
  const receipt = payRes.body.receipt;
  const allocation = payRes.body.allocation;
  console.log(`✓ Payment collected successfully (Payment ID: ${payment.id}, Receipt ID: ${receipt?.id}, Receipt No: ${receipt?.receiptNumber})`);

  // 7. RECEIPT
  console.log('\n7. Testing Receipt Details & PDF/Print URLs...');
  if (!receipt?.id) throw new Error('Receipt missing in payment result');
  const receiptRes = await request('GET', `/tenants/${TENANT_ID}/receipts/${receipt.id}`, null, token);
  if (receiptRes.status !== 200) {
    throw new Error(`Receipt fetch failed: ${receiptRes.status}`);
  }
  console.log(`✓ Receipt details retrieved (Number: ${receiptRes.body.receiptNumber})`);

  const receiptPdfRes = await request('GET', `/tenants/${TENANT_ID}/receipts/${receipt.id}/pdf`, null, token);
  if (receiptPdfRes.status !== 200) {
    throw new Error(`Receipt PDF endpoint failed: ${receiptPdfRes.status}`);
  }
  console.log('✓ Receipt PDF endpoint verified (200 OK)');

  // 8. REFUND
  console.log('\n8. Testing Refund Allocation...');
  if (!allocation?.id) throw new Error('Payment allocation missing for refund test');
  const refundRes = await request(
    'POST',
    `/tenants/${TENANT_ID}/refunds/allocations`,
    {
      paymentAllocationId: allocation.id,
      refundAmountMinor: '50000', // ₹500.00 refund
      refundMode: 'CASH',
      refundReason: 'Customer requested discount post-payment',
    },
    token,
  );
  if (refundRes.status !== 201 && refundRes.status !== 200) {
    throw new Error(`Refund failed with status ${refundRes.status}: ${JSON.stringify(refundRes.body)}`);
  }
  console.log(`✓ Refund processed successfully (Refund ID: ${refundRes.body.refund?.id}, Restored Due Balance: ₹${Number(refundRes.body.due?.balanceRemainingMinor)/100})`);

  // 9. REPORTS
  console.log('\n9. Testing Reports...');
  const colReport = await request('GET', `/tenants/${TENANT_ID}/reports/collections`, null, token);
  if (colReport.status !== 200) throw new Error(`Collection report failed: ${colReport.status}`);
  console.log(`✓ Collection report loaded (${colReport.body.items?.length} payments, Net Collected: ₹${Number(colReport.body.totals?.totalNetCollectedMinor)/100})`);

  const duesReport = await request('GET', `/tenants/${TENANT_ID}/reports/dues`, null, token);
  if (duesReport.status !== 200) throw new Error(`Dues report failed: ${duesReport.status}`);
  console.log(`✓ Dues report loaded (${duesReport.body.items?.length} dues, Outstanding: ₹${Number(duesReport.body.totals?.totalOutstandingMinor)/100})`);

  // 10. SETTINGS
  console.log('\n10. Testing Settings Endpoints...');
  const profRes = await request('GET', `/tenant/profile`, null, token);
  if (profRes.status !== 200) throw new Error(`Tenant profile failed: ${profRes.status}`);
  console.log(`✓ Tenant profile verified (Name: ${profRes.body.name})`);

  const termRes = await request('GET', `/tenant/terminology`, null, token);
  if (termRes.status !== 200) throw new Error(`Terminology settings failed: ${termRes.status}`);
  console.log(`✓ Terminology verified (${termRes.body.personLabelSingular} / ${termRes.body.chargeLabelSingular})`);

  const rcRes = await request('GET', `/tenant/receipt-config`, null, token);
  if (rcRes.status !== 200) throw new Error(`Receipt config failed: ${rcRes.status}`);
  console.log(`✓ Receipt config verified (Prefix: ${rcRes.body.receiptPrefix})`);

  // 11. SEARCH
  console.log('\n11. Testing Search...');
  const searchRes = await request('GET', `/search?q=Rahul`, null, token);
  if (searchRes.status !== 200 || !searchRes.body.people?.some((p) => p.id === personId)) {
    throw new Error(`Search failed to return created person: ${JSON.stringify(searchRes.body)}`);
  }
  console.log(`✓ Global search returned ${searchRes.body.people.length} matching people.`);

  // 12. IMPORT / EXPORT
  console.log('\n12. Testing Export Endpoint...');
  const exportRes = await request('GET', `/exports/people`, null, token);
  if (exportRes.status !== 200) throw new Error(`People export failed: ${exportRes.status}`);
  console.log(`✓ People export verified (${exportRes.raw.split('\n').length} CSV rows)`);

  // 13. ACTIVITY / AUDIT LOGS
  console.log('\n13. Testing Activity / Audit Logs...');
  const auditRes = await request('GET', `/audit-logs`, null, token);
  if (auditRes.status !== 200) throw new Error(`Audit logs failed: ${auditRes.status}`);
  console.log(`✓ Audit logs verified (${auditRes.body.items?.length} log entries found)`);

  // 14. LOGOUT / RE-LOGIN
  console.log('\n14. Testing Re-Login...');
  const unauthRes = await request('GET', `/tenants/${TENANT_ID}/dashboard/metrics`);
  if (unauthRes.status !== 401) throw new Error(`Unauthenticated access expected 401, got ${unauthRes.status}`);
  console.log('✓ Unauthenticated request rejected with 401 Unauthorized.');

  const reLoginRes = await request('POST', `/tenants/${TENANT_ID}/auth/login`, {
    email: EMAIL,
    password: PASSWORD,
  });
  if (reLoginRes.status !== 200 || !reLoginRes.body?.accessToken) {
    throw new Error('Re-login failed');
  }
  console.log('✓ Re-login verified with fresh token.');

  console.log('\n=========================================');
  console.log('ALL 14 FRONTEND/BACKEND FLOWS VERIFIED 100% PASS');
  console.log('=========================================');
}

run().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
