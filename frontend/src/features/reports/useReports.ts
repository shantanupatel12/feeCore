import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import {
  CollectionReportResponse,
  DuesReportResponse,
  PaymentMode,
} from '@feecore/shared-types';

export interface ReportsFilters {
  from?: string;
  to?: string;
  paymentMode?: PaymentMode;
  collectorUserId?: string;
  personId?: string;
  status?: 'pending' | 'paid' | 'overdue';
  category?: string;
  ageBucketDays?: number;
  page?: number;
  limit?: number;
}

interface UseReportsResult {
  filters: ReportsFilters;
  setFilters: (filters: ReportsFilters) => void;
  collectionReport: CollectionReportResponse | null;
  duesReport: DuesReportResponse | null;
  isLoadingCollection: boolean;
  isLoadingDues: boolean;
  error: string | null;
  paymentModes: PaymentMode[];
  generateCollectionReport: () => void;
  generateDuesReport: () => void;
  clearReports: () => void;
}

export const useReports = (tenantId: string): UseReportsResult => {
  const [filters, setFiltersState] = useState<ReportsFilters>({});
  const [collectionReport, setCollectionReport] = useState<CollectionReportResponse | null>(null);
  const [duesReport, setDuesReport] = useState<DuesReportResponse | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(false);
  const [isLoadingDues, setIsLoadingDues] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paymentModes: PaymentMode[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'OTHER'];

  const setFilters = useCallback((newFilters: ReportsFilters) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters, page: 1 }));
  }, []);

  const generateCollectionReport = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingCollection(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.from) params.append('from', filters.from);
      if (filters.to) params.append('to', filters.to);
      if (filters.paymentMode) params.append('paymentMode', filters.paymentMode);
      if (filters.collectorUserId) params.append('collectorUserId', filters.collectorUserId);
      if (filters.personId) params.append('personId', filters.personId);

      const response = await apiClient.get<any>(
        `/tenants/${tenantId}/reports/collections?${params.toString()}`
      );
      setCollectionReport(response.collection || response);
      setDuesReport(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate collection report');
    } finally {
      setIsLoadingCollection(false);
    }
  }, [tenantId, filters]);

  const generateDuesReport = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingDues(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.from) params.append('from', filters.from);
      if (filters.to) params.append('to', filters.to);
      if (filters.paymentMode) params.append('paymentMode', filters.paymentMode);
      if (filters.status) params.append('status', filters.status);
      if (filters.category) params.append('category', filters.category);
      if (filters.personId) params.append('personId', filters.personId);
      if (filters.collectorUserId) params.append('collectorUserId', filters.collectorUserId);

      const response = await apiClient.get<any>(
        `/tenants/${tenantId}/reports/dues?${params.toString()}`
      );
      setDuesReport(response.dues || response);
      setCollectionReport(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate dues report');
    } finally {
      setIsLoadingDues(false);
    }
  }, [tenantId, filters]);

  const clearReports = useCallback(() => {
    setCollectionReport(null);
    setDuesReport(null);
    setError(null);
  }, []);

  return {
    filters,
    setFilters,
    collectionReport,
    duesReport,
    isLoadingCollection,
    isLoadingDues,
    error,
    paymentModes,
    generateCollectionReport,
    generateDuesReport,
    clearReports,
  };
};
