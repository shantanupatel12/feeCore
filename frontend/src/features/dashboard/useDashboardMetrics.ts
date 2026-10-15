import { useState, useEffect } from 'react';
import { DashboardMetricsDto } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface DashboardMetrics {
  totalOutstanding: number;
  overdueCount: number;
  openDueCount: number;
  paidDueCount: number;
  peopleCount: number;
  activePeopleCount: number;
  todayCollected: number;
  todayPaymentsCount: number;
  periodCollected: number;
  allTimeCollected: number;
  allTimeRefunds: number;
  allTimeNetCollected: number;
  dueRaisedToday: number;
  dueRaisedTodayCount: number;
  outstandingLateFee: number;
  totalOverdue: number;
  paymentsTodayCount: number;
  advanceHeld: number;
  asOf: string;
}

export function useDashboardMetrics(tenantId: string | null): {
  metrics: DashboardMetrics | null;
  isLoading: boolean;
  error: string | null;
} {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const fetchMetrics = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiClient.get<DashboardMetricsDto>(
          `/tenants/${tenantId}/dashboard/metrics`,
        );

        setMetrics({
          totalOutstanding: Number(data.dues.totalOutstandingMinor) / 100,
          overdueCount: data.overdue.overdueDueCount,
          openDueCount: data.dues.openDueCount,
          paidDueCount: data.dues.paidDueCount,
          peopleCount: data.people.total,
          activePeopleCount: data.people.active,
          todayCollected: Number(data.collection.todayCollectedMinor) / 100,
          todayPaymentsCount: data.collection.todayPaymentsCount,
          periodCollected: Number(data.collection.periodCollectedMinor) / 100,
          allTimeCollected: Number(data.collection.allTimeCollectedMinor) / 100,
          allTimeRefunds: Number(data.collection.allTimeRefundsMinor) / 100,
          allTimeNetCollected: Number(data.collection.allTimeNetCollectedMinor) / 100,
          dueRaisedToday: Number(data.dues.dueRaisedTodayMinor) / 100,
          dueRaisedTodayCount: data.dues.dueRaisedTodayCount,
          outstandingLateFee: Number(data.dues.outstandingLateFeeMinor) / 100,
          totalOverdue: Number(data.overdue.totalOverdueMinor) / 100,
          paymentsTodayCount: data.overdue.paymentsTodayCount,
          advanceHeld: Number(data.advance.totalHeldMinor) / 100,
          asOf: data.asOf,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message || 'Failed to load dashboard metrics');
        } else {
          setError('Failed to load dashboard metrics');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetrics();
  }, [tenantId]);

  return { metrics, isLoading, error };
}
