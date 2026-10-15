import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

async function main() {
  console.log('Creating demo accounts for tenant:', TENANT_ID);

  const collectorPassword = 'CollectorDemo@2026!';
  const userPassword = 'UserDemo@2026!';

  const collectorHash = await argon2.hash(collectorPassword);
  const userHash = await argon2.hash(userPassword);

  const collectorEmail = 'demo.collector@feecore.dev';
  const userEmail = 'demo.user@feecore.dev';

  // Check if collector demo account exists
  const existingCollector = await prisma.user.findFirst({
    where: { tenantId: TENANT_ID, email: collectorEmail },
  });

  if (existingCollector) {
    console.log('Collector demo account already exists, updating role and password...');
    await prisma.user.update({
      where: { id: existingCollector.id },
      data: {
        role: UserRole.ROLE_COLLECTOR,
        passwordHash: collectorHash,
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        tenantId: TENANT_ID,
        email: collectorEmail,
        passwordHash: collectorHash,
        fullName: 'Demo Collector',
        role: UserRole.ROLE_COLLECTOR,
        status: 'ACTIVE',
      },
    });
    console.log('Created collector demo account');
  }

  // Check if user demo account exists
  const existingUser = await prisma.user.findFirst({
    where: { tenantId: TENANT_ID, email: userEmail },
  });

  if (existingUser) {
    console.log('User demo account already exists, updating role and password...');
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        role: UserRole.ROLE_VIEWER,
        passwordHash: userHash,
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        tenantId: TENANT_ID,
        email: userEmail,
        passwordHash: userHash,
        fullName: 'Demo User',
        role: UserRole.ROLE_VIEWER,
        status: 'ACTIVE',
      },
    });
    console.log('Created user demo account');
  }

  console.log('\n=== DEMO ACCOUNT CREDENTIALS (DEVELOPMENT ONLY) ===');
  console.log('Tenant ID:', TENANT_ID);
  console.log('Collector:  demo.collector@feecore.dev /', collectorPassword);
  console.log('User:       demo.user@feecore.dev /', userPassword);
  console.log('Admin:      admin@feecore.dev / Password@123 (existing)');
  console.log('\nStore these credentials securely. Do not commit to version control.');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});