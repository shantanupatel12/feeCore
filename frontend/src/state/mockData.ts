import { DueDto, PersonDto, RecurringPlanDto, RecurringFrequency, DueStatus, PersonStatus, RecurringPlanStatus } from '@feecore/shared-types';

export const INITIAL_PEOPLE: PersonDto[] = [
  {
    id: 'p-1',
    tenantId: 't-demo',
    fullName: 'Rahul Sharma',
    primaryPhone: '+919876543210',
    secondaryPhone: null,
    email: 'rahul.sharma@example.com',
    address: 'Flat 402, Royal Residency, Pune',
    advanceBalanceMinor: '150000', // ₹1,500 advance
    customData: { roll_number: '101', section: 'A' },
    status: 'ACTIVE' as PersonStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'p-2',
    tenantId: 't-demo',
    fullName: 'Priya Verma',
    primaryPhone: '+919876500000',
    secondaryPhone: '+919876511111',
    email: 'priya.v@example.com',
    address: 'B-12 Green Valley, Mumbai',
    advanceBalanceMinor: '0',
    customData: { roll_number: '102', section: 'B' },
    status: 'ACTIVE' as PersonStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'p-3',
    tenantId: 't-demo',
    fullName: 'Amit Patel',
    primaryPhone: '+919811122233',
    secondaryPhone: null,
    email: 'amit.patel@example.com',
    address: 'Sector 15, Gandhinagar',
    advanceBalanceMinor: '500000', // ₹5,000 advance
    customData: { roll_number: '103', section: 'A' },
    status: 'ACTIVE' as PersonStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const INITIAL_DUES: DueDto[] = [
  {
    id: 'due-1',
    tenantId: 't-demo',
    personId: 'p-1',
    chargeId: 'chg-1',
    recurringPlanId: null,
    cyclePeriodKey: null,
    dueDate: '2026-10-15',
    netAmountMinor: '450000', // ₹4,500.00
    lateFeeAmountMinor: '0',
    balanceRemainingMinor: '450000',
    status: 'PENDING' as DueStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person: { id: 'p-1', fullName: 'Rahul Sharma', primaryPhone: '+919876543210' },
  },
  {
    id: 'due-2',
    tenantId: 't-demo',
    personId: 'p-2',
    chargeId: 'chg-2',
    recurringPlanId: null,
    cyclePeriodKey: null,
    dueDate: '2026-08-01',
    netAmountMinor: '300000', // ₹3,000.00
    lateFeeAmountMinor: '0',
    balanceRemainingMinor: '300000',
    status: 'OVERDUE' as DueStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person: { id: 'p-2', fullName: 'Priya Verma', primaryPhone: '+919876500000' },
  },
  {
    id: 'due-3',
    tenantId: 't-demo',
    personId: 'p-3',
    chargeId: 'chg-3',
    recurringPlanId: 'plan-1',
    cyclePeriodKey: '2026-09',
    dueDate: '2026-09-30',
    netAmountMinor: '250000', // ₹2,500.00
    lateFeeAmountMinor: '0',
    balanceRemainingMinor: '100000', // Partially paid (₹1,000 left)
    status: 'PARTIALLY_PAID' as DueStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person: { id: 'p-3', fullName: 'Amit Patel', primaryPhone: '+919811122233' },
  },
];

export const INITIAL_PLANS: RecurringPlanDto[] = [
  {
    id: 'plan-1',
    tenantId: 't-demo',
    personId: 'p-3',
    category: 'Maintenance',
    baseAmountMinor: '250000',
    frequency: 'MONTHLY' as RecurringFrequency,
    anchorDay: 1,
    startDate: '2026-01-01',
    endDate: null,
    nextExecutionDate: '2026-10-01',
    status: 'ACTIVE' as RecurringPlanStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
