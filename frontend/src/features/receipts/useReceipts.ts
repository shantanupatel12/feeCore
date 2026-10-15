import { useState, useCallback, useRef } from 'react';
import { PaginatedResult, ReceiptDto } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export function useReceipts(tenantId: string) {
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paginationRef = useRef(pagination);
  paginationRef.current = pagination;

  const fetchReceipts = useCallback(async (page: number, personId?: string) => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (personId) {
        params.set('personId', personId);
      }

      const response = await apiClient.get<PaginatedResult<ReceiptDto>>(
        `/tenants/${tenantId}/receipts?${params.toString()}`,
      );

      setReceipts(response.items);
      setPagination({
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load receipts');
      } else {
        setError('Failed to load receipts');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const loadPage = useCallback((page: number, personId?: string) => {
    fetchReceipts(page, personId);
  }, [fetchReceipts]);

  const refetch = useCallback(() => {
    fetchReceipts(paginationRef.current.page);
  }, [fetchReceipts]);

  const getReceiptByPayment = useCallback(async (paymentId: string): Promise<ReceiptDto> => {
    const response = await apiClient.get<ReceiptDto>(
      `/tenants/${tenantId}/receipts/by-payment/${paymentId}`,
    );
    return response;
  }, [tenantId]);

  const getReceipt = useCallback(async (receiptId: string): Promise<ReceiptDto> => {
    const response = await apiClient.get<ReceiptDto>(
      `/tenants/${tenantId}/receipts/${receiptId}`,
    );
    return response;
  }, [tenantId]);

  const downloadPdf = useCallback((receiptId: string): string => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
    return `${apiBase}/tenants/${tenantId}/receipts/${receiptId}/pdf`;
  }, [tenantId]);

  const printReceipt = useCallback((receiptId: string): string => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
    return `${apiBase}/tenants/${tenantId}/receipts/${receiptId}/print`;
  }, [tenantId]);

  return {
    receipts,
    pagination,
    isLoading,
    error,
    refetch,
    loadPage,
    getReceipt,
    getReceiptByPayment,
    downloadPdf,
    printReceipt,
  };
}
