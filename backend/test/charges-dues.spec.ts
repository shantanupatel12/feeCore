import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, RecurringFrequency, DueStatus } from '@prisma/client';
import { ChargesService } from '../src/modules/charges/charges.service.js';
import { RecurringPlansService } from '../src/modules/charges/recurring-plans.service.js';
import { DuesService } from '../src/modules/dues/dues.service.js';

describe('Phase 2: Charges, Recurring Plans & Due Generation Engine Test Suite', () => {
  let prisma: PrismaClient;
  let chargesService: ChargesService;
  let recurringPlansService: RecurringPlansService;
  let duesService: DuesService;

  let tenantId: string;
  let userId: string;
  let personId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    chargesService = new ChargesService(prisma as any);
    recurringPlansService = new RecurringPlansService(prisma as any);
    duesService = new DuesService(prisma as any);

    // Create Test Tenant, User, Person
    const tenant = await prisma.tenant.create({
      data: { name: 'Phase2 Academy', category: 'School' },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: 'collector@phase2.com',
        passwordHash: 'dummyhash',
        fullName: 'Collector Bob',
        role: 'ROLE_COLLECTOR',
      },
    });
    userId = user.id;

    const person = await prisma.person.create({
      data: {
        tenantId,
        fullName: 'Alice Student',
        primaryPhone: '+919876543210',
      },
    });
    personId = person.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.financialTransactionLog.deleteMany({ where: { tenantId } });
      await prisma.due.deleteMany({ where: { tenantId } });
      await prisma.charge.deleteMany({ where: { tenantId } });
      await prisma.recurringPlan.deleteMany({ where: { tenantId } });
      await prisma.person.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it('1. Creates a One-Time Charge and immediately generates a Due', async () => {
    const res = await chargesService.createOneTimeCharge(tenantId, userId, {
      personId,
      category: 'Tuition',
      description: 'Q1 Tuition Fee',
      baseAmountMinor: '500000', // ₹5,000.00
      discountAmountMinor: '50000', // ₹500.00 discount
      dueDate: '2026-10-15',
    });

    expect(res.charge.id).toBeDefined();
    expect(res.charge.baseAmountMinor).toBe('500000');
    expect(res.charge.discountAmountMinor).toBe('50000');

    expect(res.due.id).toBeDefined();
    expect(res.due.netAmountMinor).toBe('450000'); // Net = 5000 - 500 = 4500
    expect(res.due.balanceRemainingMinor).toBe('450000');
    expect(res.due.status).toBe(DueStatus.PENDING);
  });

  it('2. Rejects invalid discount amounts (negative or exceeding base amount)', async () => {
    await expect(
      chargesService.createOneTimeCharge(tenantId, userId, {
        personId,
        category: 'Sports',
        baseAmountMinor: '100000',
        discountAmountMinor: '150000', // Discount > Base
        dueDate: '2026-10-15',
      }),
    ).rejects.toThrow(/exceed base amount/);
  });

  it('3. Creates a Monthly Recurring Plan with anchor day 31', async () => {
    const plan = await recurringPlansService.create(tenantId, {
      personId,
      category: 'Hostel',
      baseAmountMinor: '300000', // ₹3,000.00
      frequency: RecurringFrequency.MONTHLY,
      anchorDay: 31,
      startDate: '2026-01-31',
    });

    expect(plan.id).toBeDefined();
    expect(plan.anchorDay).toBe(31);
    expect(plan.frequency).toBe('MONTHLY');
    expect(plan.status).toBe('ACTIVE');
  });

  it('4. Dues Generation Engine: Idempotent generation with month-end anchor day clamping', async () => {
    const plans = await recurringPlansService.findAll(tenantId, { personId });
    const monthlyPlan = plans.find((p) => p.frequency === 'MONTHLY');
    expect(monthlyPlan).toBeDefined();

    // Trigger due generation for 3 months up to 2026-03-31
    const gen1 = await duesService.generateDues(tenantId, {
      recurringPlanId: monthlyPlan!.id,
      targetDate: '2026-03-31',
    });

    // Should generate dues for Jan (2026-01-31), Feb (2026-02-28 clamped from 31!), Mar (2026-03-31)
    expect(gen1.generatedCount).toBe(3);
    expect(gen1.skippedCount).toBe(0);

    // Verify Feb due date is clamped to Feb 28th
    const allDues = await duesService.findAll(tenantId, { personId });
    const febDue = allDues.items.find((d) => d.cyclePeriodKey === '2026-02');
    expect(febDue).toBeDefined();
    const febDate = new Date(febDue!.dueDate);
    expect(febDate.getUTCDate()).toBe(28); // Clamped to Feb 28 in non-leap year

    // Reset plan's nextExecutionDate back to 2026-01-31 to simulate a re-run/concurrent worker scenario
    await prisma.recurringPlan.update({
      where: { id: monthlyPlan!.id },
      data: { nextExecutionDate: new Date('2026-01-31') },
    });

    // Re-trigger due generation for the exact same target date (Idempotency test)
    const gen2 = await duesService.generateDues(tenantId, {
      recurringPlanId: monthlyPlan!.id,
      targetDate: '2026-03-31',
    });

    // Zero duplicate dues created! All existing 3 periods cleanly skipped due to compound unique index
    expect(gen2.generatedCount).toBe(0);
    expect(gen2.skippedCount).toBe(3);
  });

  it('5. Evaluates Due Status dynamically (Overdue transition when due date is in the past)', async () => {
    // Create past due
    const pastCharge = await chargesService.createOneTimeCharge(tenantId, userId, {
      personId,
      category: 'Exam Fee',
      baseAmountMinor: '50000',
      dueDate: '2020-01-01', // Past date
    });

    const dueDetail = await duesService.findOne(tenantId, pastCharge.due.id);
    expect(dueDetail.status).toBe(DueStatus.OVERDUE);
  });
});
