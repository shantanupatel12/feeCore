import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import {
  AuditLogDto,
} from '@feecore/shared-types';

export interface ActivityFilters {
  personId?: string;
  eventType?: string;
  referenceEntityType?: string;
  referenceEntityId?: string;
  performedByUserId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

interface UseActivityResult {
  logs: AuditLogDto[];
  isLoading: boolean;
  error: string | null;
  pagination: { page: number; limit: number; total: number; totalPages: number } | null;
  filters: ActivityFilters;
  eventTypeOptions: { value: string; label: string }[];
  fetchLogs: () => void;
  setFilters: (filters: ActivityFilters) => void;
  loadMore: () => void;
  refresh: () => void;
}

const eventTypeOptions = [
  { value: 'payment.create', label: 'Payment Created' },
  { value: 'payment.refund', label: 'Payment Refunded' },
  { value: 'receipt.generate', label: 'Receipt Generated' },
  { value: 'person.create', label: 'Person Created' },
  { value: 'person.update', label: 'Person Updated' },
  { value: 'person.delete', label: 'Person Deleted' },
  { value: 'charge.create', label: 'Charge Created' },
  { value: 'charge.update', label: 'Charge Updated' },
  { value: 'charge.delete', label: 'Charge Deleted' },
  { value: 'dues.assign', label: 'Dues Assigned' },
  { value: 'dues.pay', label: 'Dues Paid' },
  { value: 'dues.write_off', label: 'Dues Written Off' },
  { value: 'custom_field.create', label: 'Custom Field Created' },
  { value: 'custom_field.update', label: 'Custom Field Updated' },
  { value: 'custom_field.delete', label: 'Custom Field Deleted' },
  { value: 'import.start', label: 'Import Started' },
  { value: 'import.complete', label: 'Import Completed' },
  { value: 'export.generate', label: 'Export Generated' },
  { value: 'organization.update', label: 'Organization Updated' },
  { value: 'terminology.update', label: 'Terminology Updated' },
  { value: 'receipt_config.update', label: 'Receipt Config Updated' },
];

export const useActivity = (tenantId: string): UseActivityResult => {
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [filters, setFiltersState] = useState<ActivityFilters>({
    page: 1,
    limit: 50,
  });

  const fetchLogs = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.eventType) params.append('eventType', filters.eventType);
      if (filters.referenceEntityType) params.append('referenceEntityType', filters.referenceEntityType);
      if (filters.from) params.append('from', filters.from);
      if (filters.to) params.append('to', filters.to);
      params.append('page', String(filters.page ?? 1));
      params.append('limit', String(filters.limit ?? 50));

      const response = await apiClient.get<{
        items?: AuditLogDto[];
        logs?: AuditLogDto[];
        total?: number;
        page?: number;
        limit?: number;
        totalPages?: number;
        pagination?: { page: number; limit: number; total: number; totalPages: number };
      }>(`/audit-logs?${params.toString()}`);

      const items = response.items || response.logs || [];
      setLogs(items);
      if (response.pagination) {
        setPagination(response.pagination);
      } else if (response.total !== undefined) {
        setPagination({
          page: response.page ?? 1,
          limit: response.limit ?? 50,
          total: response.total ?? 0,
          totalPages: response.totalPages ?? 1,
        });
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load activity logs');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, filters]);

  const setFilters = useCallback((newFilters: ActivityFilters) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters, page: 1 }));
  }, []);

  const loadMore = useCallback(() => {
    if (pagination && pagination.page < pagination.totalPages) {
      setFiltersState((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }));
    }
  }, [pagination]);

  const refresh = useCallback(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    isLoading,
    error,
    pagination,
    filters,
    eventTypeOptions,
    fetchLogs,
    setFilters,
    loadMore,
    refresh,
  };
};
