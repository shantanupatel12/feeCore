import { useState } from 'react';
import { PersonDto, DueDto, RecurringPlanDto, RecurringFrequency, RecurringPlanStatus } from '@feecore/shared-types';
import { INITIAL_PEOPLE, INITIAL_DUES, INITIAL_PLANS } from './mockData.js';

export function useMockAppState() {
  const [people, setPeople] = useState<PersonDto[]>(INITIAL_PEOPLE);
  const [dues, setDues] = useState<DueDto[]>(INITIAL_DUES);
  const [plans, setPlans] = useState<RecurringPlanDto[]>(INITIAL_PLANS);
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleCreatePerson = (data: { fullName: string; primaryPhone: string; secondaryPhone?: string; email?: string; address?: string }) => {
    const newPerson: PersonDto = {
      id: `p-${Date.now()}`,
      tenantId: 't-demo',
      fullName: data.fullName,
      primaryPhone: data.primaryPhone,
      secondaryPhone: data.secondaryPhone || null,
      email: data.email || null,
      address: data.address || null,
      advanceBalanceMinor: '0',
      customData: {},
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPeople([newPerson, ...people]);
    return newPerson;
  };

  const handleCreateCharge = (data: { personId: string; category: string; description: string; baseAmountMinor: string; discountAmountMinor: string; dueDate: string }) => {
    const person = people.find((p) => p.id === data.personId);
    const net = BigInt(data.baseAmountMinor) - BigInt(data.discountAmountMinor || '0');

    const newDue: DueDto = {
      id: `due-${Date.now()}`,
      tenantId: 't-demo',
      personId: data.personId,
      chargeId: `chg-${Date.now()}`,
      recurringPlanId: null,
      cyclePeriodKey: null,
      dueDate: data.dueDate,
      netAmountMinor: net.toString(),
      lateFeeAmountMinor: '0',
      balanceRemainingMinor: net.toString(),
      status: new Date(data.dueDate) < new Date() ? 'OVERDUE' : 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      person: person ? { id: person.id, fullName: person.fullName, primaryPhone: person.primaryPhone } : undefined,
    };

    setDues([newDue, ...dues]);
    return { net, person };
  };

  const handleCreatePlan = (data: { personId: string; category: string; baseAmountMinor: string; frequency: RecurringFrequency; anchorDay: number; startDate: string }) => {
    const person = people.find((p) => p.id === data.personId);
    const newPlan: RecurringPlanDto = {
      id: `plan-${Date.now()}`,
      tenantId: 't-demo',
      personId: data.personId,
      category: data.category,
      baseAmountMinor: data.baseAmountMinor,
      frequency: data.frequency,
      anchorDay: data.anchorDay,
      startDate: data.startDate,
      endDate: null,
      nextExecutionDate: data.startDate,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setPlans([newPlan, ...plans]);
    return { person, newPlan };
  };

  const handleTogglePlanStatus = (planId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setPlans(plans.map((p) => (p.id === planId ? { ...p, status: newStatus as RecurringPlanStatus } : p)));
    return newStatus;
  };

  const generateDuesLogic = () => {
    let newCount = 0;
    const updatedDues = [...dues];

    plans.filter((p) => p.status === 'ACTIVE').forEach((plan) => {
      const person = people.find((p) => p.id === plan.personId);
      const periodKey = `2026-10`;

      const exists = updatedDues.some((d) => d.recurringPlanId === plan.id && d.cyclePeriodKey === periodKey);
      if (!exists) {
        updatedDues.unshift({
          id: `due-auto-${Date.now()}-${plan.id}`,
          tenantId: 't-demo',
          personId: plan.personId,
          chargeId: `chg-auto-${Date.now()}`,
          recurringPlanId: plan.id,
          cyclePeriodKey: periodKey,
          dueDate: '2026-10-01',
          netAmountMinor: plan.baseAmountMinor,
          lateFeeAmountMinor: '0',
          balanceRemainingMinor: plan.baseAmountMinor,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          person: person ? { id: person.id, fullName: person.fullName, primaryPhone: person.primaryPhone } : undefined,
        });
        newCount++;
      }
    });
    setDues(updatedDues);
    return newCount;
  };

  return {
    people,
    dues,
    plans,
    notification,
    showToast,
    handleCreatePerson,
    handleCreateCharge,
    handleCreatePlan,
    handleTogglePlanStatus,
    generateDuesLogic
  };
}
