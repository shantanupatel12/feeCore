import { useState, useCallback, useEffect, useRef } from 'react';
import { DueDto, PaginatedResult, DueStatus } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface UseDuesResult {
  dues: DueDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  loadPage: (page: number) => void;
  generateDues: (targetDate?: string) => Promise<{ generatedCount: number; skippedCount: number }>;
}

export function useDues(tenantId: string): UseDuesResult {
  const [dues, setDues] = useState<DueDto[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paginationRef = useRef(pagination);
  paginationRef.current = pagination;
  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;

  const fetchDues = useCallback(async (page: number, search: string, status: string) => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (status !== 'ALL') {
        params.set('status', status);
      }

      const response = await apiClient.get<PaginatedResult<DueDto>>(
        `/tenants/${tenantId}/dues?${params.toString()}`,
      );

      setDues(response.items);
      setPagination({
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load dues');
      } else {
        setError('Failed to load dues');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const loadPage = useCallback((page: number) => {
    fetchDues(page, searchTermRef.current, statusFilterRef.current);
  }, [fetchDues]);

  const refetch = useCallback(() => {
    fetchDues(paginationRef.current.page, searchTermRef.current, statusFilterRef.current);
  }, [fetchDues]);

  useEffect(() => {
    fetchDues(1, searchTerm, statusFilter);
  }, [fetchDues, searchTerm, statusFilter]);

  const generateDues = async (targetDate?: string): Promise<{ generatedCount: number; skippedCount: number }> => {
    const response = await apiClient.post<{ generatedCount: number; skippedCount: number }>(`/tenants/${tenantId}/dues/generate`, {
      targetDate: targetDate || undefined,
    });
    return response;
  };

  return {
    dues,
    pagination,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    isLoading,
    error,
    refetch,
    loadPage,
    generateDues,
  };
}
