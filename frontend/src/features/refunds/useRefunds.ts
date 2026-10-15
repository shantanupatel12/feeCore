import { useState, useCallback } from 'react';
import { PaginatedResult, RefundDto, RefundResponse } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export function useRefunds(tenantId: string) {
  const [refunds, setRefunds] = useState<RefundDto[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const fetchRefunds = useCallback(async (page: number, filters?: {
    personId?: string;
    paymentId?: string;
    refundType?: string;
  }) => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (filters?.personId) params.set('personId', filters.personId);
      if (filters?.paymentId) params.set('paymentId', filters.paymentId);
      if (filters?.refundType) params.set('refundType', filters.refundType);

      const response = await apiClient.get<PaginatedResult<RefundDto>>(
        `/tenants/${tenantId}/refunds?${params.toString()}`,
      );

      setRefunds(response.items);
      setPagination({
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load refunds');
      } else {
        setError('Failed to load refunds');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const loadPage = useCallback((page: number, filters?: {
    personId?: string;
    paymentId?: string;
    refundType?: string;
  }) => {
    fetchRefunds(page, filters);
  }, [fetchRefunds]);

  const refundAllocation = useCallback(async (data: {
    paymentAllocationId: string;
    refundAmountMinor: string;
    refundMode: string;
    refundReason: string;
    referenceNumber?: string;
  }): Promise<RefundResponse> => {
    setIsRefunding(true);
    setRefundError(null);
    try {
      const body: Record<string, unknown> = {
        paymentAllocationId: data.paymentAllocationId,
        refundAmountMinor: data.refundAmountMinor,
        refundMode: data.refundMode,
        refundReason: data.refundReason,
      };
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;

      const response = await apiClient.post<RefundResponse>(
        `/tenants/${tenantId}/refunds/allocations`,
        body,
      );
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setRefundError(err.message || 'Failed to process refund');
      } else {
        setRefundError('Failed to process refund');
      }
      throw err;
    } finally {
      setIsRefunding(false);
    }
  }, [tenantId]);

  const refundAdvance = useCallback(async (data: {
    personId: string;
    refundAmountMinor: string;
    refundMode: string;
    refundReason: string;
    referenceNumber?: string;
  }): Promise<{
    refund: { id: string; refundAmountMinor: string };
    person: { id: string; advanceBalanceMinor: string };
  }> => {
    setIsRefunding(true);
    setRefundError(null);
    try {
      const body: Record<string, unknown> = {
        personId: data.personId,
        refundAmountMinor: data.refundAmountMinor,
        refundMode: data.refundMode,
        refundReason: data.refundReason,
      };
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;

      const response = await apiClient.post<{
        refund: { id: string; refundAmountMinor: string };
        person: { id: string; advanceBalanceMinor: string };
      }>(`/tenants/${tenantId}/refunds/advance-wallet`, body);
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setRefundError(err.message || 'Failed to process advance refund');
      } else {
        setRefundError('Failed to process advance refund');
      }
      throw err;
    } finally {
      setIsRefunding(false);
    }
  }, [tenantId]);

  const getRefund = useCallback(async (refundId: string): Promise<RefundDto> => {
    const response = await apiClient.get<RefundDto>(
      `/tenants/${tenantId}/refunds/${refundId}`,
    );
    return response;
  }, [tenantId]);

  return {
    refunds,
    pagination,
    isLoading,
    error,
    isRefunding,
    refundError,
    refetch: () => fetchRefunds(pagination.page),
    loadPage,
    getRefund,
    refundAllocation,
    refundAdvance,
  };
}

