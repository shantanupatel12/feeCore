import { useState, useCallback, useEffect, useRef } from 'react';
import { PaginatedResult } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface UseChargesResult {
  charges: any[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  loadPage: (page: number) => void;
  createCharge: (data: {
    personId: string;
    category: string;
    description?: string;
    baseAmountMinor: string;
    discountAmountMinor?: string;
    dueDate: string;
  }) => Promise<any>;
}

export function useCharges(tenantId: string): UseChargesResult {
  const [charges, setCharges] = useState<any[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paginationRef = useRef(pagination);
  paginationRef.current = pagination;

  const fetchCharges = useCallback(async (page: number) => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });

      const response = await apiClient.get<PaginatedResult<any>>(
        `/tenants/${tenantId}/charges?${params.toString()}`,
      );

      setCharges(response.items);
      setPagination({
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load charges');
      } else {
        setError('Failed to load charges');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const loadPage = useCallback((page: number) => {
    fetchCharges(page);
  }, [fetchCharges]);

  const refetch = useCallback(() => {
    fetchCharges(paginationRef.current.page);
  }, [fetchCharges]);

  useEffect(() => {
    fetchCharges(1);
  }, [fetchCharges]);

  const createCharge = async (data: {
    personId: string;
    category: string;
    description?: string;
    baseAmountMinor: string;
    discountAmountMinor?: string;
    dueDate: string;
  }): Promise<any> => {
    const body: any = {
      personId: data.personId,
      category: data.category,
      description: data.description || undefined,
      baseAmountMinor: data.baseAmountMinor,
      dueDate: data.dueDate,
    };

    if (data.discountAmountMinor && parseInt(data.discountAmountMinor, 10) > 0) {
      body.discountAmountMinor = data.discountAmountMinor;
    }

    return await apiClient.post(`/tenants/${tenantId}/charges`, body);
  };

  return {
    charges,
    pagination,
    isLoading,
    error,
    refetch,
    loadPage,
    createCharge,
  };
}
