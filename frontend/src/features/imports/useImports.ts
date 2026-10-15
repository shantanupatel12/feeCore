import { useState, useCallback } from 'react';
import { ImportResultDto, ImportError } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export function useImports() {
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultDto | null>(null);

  const importPeople = useCallback(async (csv: string): Promise<ImportResultDto> => {
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const response = await apiClient.post<ImportResultDto>(
        `/imports/people`,
        { csv },
      );
      setImportResult(response);
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setImportError(err.message || 'Failed to import people');
      } else {
        setImportError('Failed to import people');
      }
      throw err;
    } finally {
      setIsImporting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setImportError(null);
    setImportResult(null);
  }, []);

  return {
    isImporting,
    importError,
    importResult,
    importPeople,
    reset,
  };
}
