import { useState, useCallback, useEffect } from 'react';
import { RecurringPlanDto, RecurringFrequency, RecurringPlanStatus } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface UseRecurringPlansResult {
  plans: RecurringPlanDto[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createPlan: (data: {
    personId: string;
    category: string;
    baseAmountMinor: string;
    frequency: RecurringFrequency;
    anchorDay?: number;
    startDate: string;
    endDate?: string;
  }) => Promise<RecurringPlanDto>;
  toggleStatus: (planId: string, currentStatus: RecurringPlanStatus) => Promise<RecurringPlanDto>;
}

export function useRecurringPlans(tenantId: string): UseRecurringPlansResult {
  const [plans, setPlans] = useState<RecurringPlanDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<any[]>(
        `/tenants/${tenantId}/recurring-plans`,
      );

      setPlans(response.map((p: any) => ({
        ...p,
        baseAmountMinor: p.baseAmountMinor ?? (p.baseAmount ? p.baseAmount.toString() : '0'),
        startDate: p.startDate ? new Date(p.startDate).toISOString() : '',
        endDate: p.endDate ? new Date(p.endDate).toISOString() : null,
        nextExecutionDate: p.nextExecutionDate ?? '',
      })));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load plans');
      } else {
        setError('Failed to load plans');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const createPlan = async (data: any): Promise<RecurringPlanDto> => {
    return await apiClient.post(`/tenants/${tenantId}/recurring-plans`, data);
  };

  const toggleStatus = async (planId: string, currentStatus: RecurringPlanStatus): Promise<RecurringPlanDto> => {
    const newStatus: RecurringPlanStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const response = await apiClient.put<RecurringPlanDto>(`/tenants/${tenantId}/recurring-plans/${planId}`, { status: newStatus });
    setPlans((prev) => prev.map((p) =>
      p.id === planId ? { ...p, status: newStatus } : p
    ));
    return response;
  };

  return {
    plans,
    isLoading,
    error,
    refetch: fetchPlans,
    createPlan,
    toggleStatus,
  };
}
