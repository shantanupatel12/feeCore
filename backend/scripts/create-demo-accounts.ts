import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

export const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

export const DEMO_CREDENTIALS = {
  tenantId: DEMO_TENANT_ID,
  admin: {
    email: 'admin@feecore.dev',
    password: 'Password@123',
    fullName: 'Admin User',
    role: UserRole.ROLE_ADMIN,
  },
  collector: {
    email: 'demo.collector@feecore.dev',
    password: 'CollectorDemo@2026!',
    fullName: 'Demo Collector',
    role: UserRole.ROLE_COLLECTOR,
  },
  viewer: {
    email: 'demo.user@feecore.dev',
    password: 'UserDemo@2026!',
    fullName: 'Demo User',
    role: UserRole.ROLE_VIEWER,
  },
};

async function main() {
  console.log(`[FeeCore Seed] Seeding demo accounts for tenant: ${DEMO_TENANT_ID}`);

  // 1. Ensure Tenant exists
  const tenant = await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    create: {
      id: DEMO_TENANT_ID,
      name: 'FeeCore Dev',
      category: 'School',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
    },
    update: {
      name: 'FeeCore Dev',
      status: 'ACTIVE',
    },
  });
  console.log(`[FeeCore Seed] Tenant ensured: ${tenant.name} (${tenant.id})`);

  // 2. Ensure TenantSettings exists
  await prisma.tenantSettings.upsert({
    where: { tenantId: DEMO_TENANT_ID },
    create: {
      tenantId: DEMO_TENANT_ID,
      personLabelSingular: 'Person',
      personLabelPlural: 'People',
      chargeLabelSingular: 'Charge',
      chargeLabelPlural: 'Charges',
      receiptPrefix: 'REC',
      autoApplyAdvance: false,
      lateFeePriority: 'PRINCIPAL_FIRST',
    },
    update: {},
  });

  // 3. Upsert Admin account
  const adminHash = await argon2.hash(DEMO_CREDENTIALS.admin.password);
  const existingAdmin = await prisma.user.findFirst({
    where: { tenantId: DEMO_TENANT_ID, email: DEMO_CREDENTIALS.admin.email },
  });
  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        role: DEMO_CREDENTIALS.admin.role,
        passwordHash: adminHash,
        fullName: DEMO_CREDENTIALS.admin.fullName,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Updated Admin account: ${DEMO_CREDENTIALS.admin.email}`);
  } else {
    await prisma.user.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        email: DEMO_CREDENTIALS.admin.email,
        passwordHash: adminHash,
        fullName: DEMO_CREDENTIALS.admin.fullName,
        role: DEMO_CREDENTIALS.admin.role,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Created Admin account: ${DEMO_CREDENTIALS.admin.email}`);
  }

  // 4. Upsert Collector account
  const collectorHash = await argon2.hash(DEMO_CREDENTIALS.collector.password);
  const existingCollector = await prisma.user.findFirst({
    where: { tenantId: DEMO_TENANT_ID, email: DEMO_CREDENTIALS.collector.email },
  });
  if (existingCollector) {
    await prisma.user.update({
      where: { id: existingCollector.id },
      data: {
        role: DEMO_CREDENTIALS.collector.role,
        passwordHash: collectorHash,
        fullName: DEMO_CREDENTIALS.collector.fullName,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Updated Collector account: ${DEMO_CREDENTIALS.collector.email}`);
  } else {
    await prisma.user.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        email: DEMO_CREDENTIALS.collector.email,
        passwordHash: collectorHash,
        fullName: DEMO_CREDENTIALS.collector.fullName,
        role: DEMO_CREDENTIALS.collector.role,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Created Collector account: ${DEMO_CREDENTIALS.collector.email}`);
  }

  // 5. Upsert Viewer account
  const userHash = await argon2.hash(DEMO_CREDENTIALS.viewer.password);
  const existingViewer = await prisma.user.findFirst({
    where: { tenantId: DEMO_TENANT_ID, email: DEMO_CREDENTIALS.viewer.email },
  });
  if (existingViewer) {
    await prisma.user.update({
      where: { id: existingViewer.id },
      data: {
        role: DEMO_CREDENTIALS.viewer.role,
        passwordHash: userHash,
        fullName: DEMO_CREDENTIALS.viewer.fullName,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Updated Viewer account: ${DEMO_CREDENTIALS.viewer.email}`);
  } else {
    await prisma.user.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        email: DEMO_CREDENTIALS.viewer.email,
        passwordHash: userHash,
        fullName: DEMO_CREDENTIALS.viewer.fullName,
        role: DEMO_CREDENTIALS.viewer.role,
        status: 'ACTIVE',
      },
    });
    console.log(`[FeeCore Seed] Created Viewer account: ${DEMO_CREDENTIALS.viewer.email}`);
  }

  // 6. Safe demo data: ensure at least one person and due exist for testing
  const peopleCount = await prisma.person.count({ where: { tenantId: DEMO_TENANT_ID } });
  if (peopleCount === 0) {
    console.log('[FeeCore Seed] No demo people found. Seeding safe test person and dues...');
    const person = await prisma.person.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        fullName: 'Rahul Sharma',
        primaryPhone: '9876543210',
        email: 'rahul.sharma@example.com',
        status: 'ACTIVE',
      },
    });

    const adminUser = await prisma.user.findFirst({
      where: { tenantId: DEMO_TENANT_ID, email: DEMO_CREDENTIALS.admin.email },
    });

    if (adminUser) {
      const charge = await prisma.charge.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          personId: person.id,
          category: 'TUITION',
          description: 'Term 1 Tuition Fee',
          baseAmount: BigInt(500000), // INR 5,000.00
          discountAmount: BigInt(0),
          createdByUserId: adminUser.id,
        },
      });

      await prisma.due.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          personId: person.id,
          chargeId: charge.id,
          netAmount: BigInt(500000),
          balanceRemaining: BigInt(500000),
          lateFeeAmount: BigInt(0),
          ruleLateFeeAmount: BigInt(0),
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days ahead
          status: 'PENDING',
        },
      });
      console.log('[FeeCore Seed] Seeded safe demo charge and due for Rahul Sharma');
    }
  }

  console.log('\n======================================================');
  console.log('       FEECORE DEMO ACCOUNTS (DEVELOPMENT ONLY)       ');
  console.log('======================================================');
  console.log(`Tenant ID:  ${DEMO_TENANT_ID}`);
  console.log(`1. ADMIN:     ${DEMO_CREDENTIALS.admin.email} / ${DEMO_CREDENTIALS.admin.password}`);
  console.log(`2. COLLECTOR: ${DEMO_CREDENTIALS.collector.email} / ${DEMO_CREDENTIALS.collector.password}`);
  console.log(`3. VIEWER:    ${DEMO_CREDENTIALS.viewer.email} / ${DEMO_CREDENTIALS.viewer.password}`);
  console.log('======================================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[FeeCore Seed Error]', e);
  await prisma.$disconnect();
  process.exit(1);
});