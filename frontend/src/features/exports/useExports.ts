import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import { ExportableEntity } from '@feecore/shared-types';

export type ExportEntity = ExportableEntity;

interface UseExportsResult {
  isExporting: boolean;
  exportError: string | null;
  downloadExport: (entity: ExportEntity) => Promise<void>;
}

export const useExports = (tenantId: string): UseExportsResult => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const downloadExport = useCallback(async (entity: ExportEntity) => {
    if (!tenantId) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const response = await apiClient.get<string | { csv?: string }>(
        `/exports/${entity}`
      );

      const csvContent = typeof response === 'string' ? response : (response.csv ?? '');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${entity}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err.message ?? 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [tenantId]);

  return { isExporting, exportError, downloadExport };
};
