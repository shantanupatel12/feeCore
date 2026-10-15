import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import {
  ImportResultDto,
} from '@feecore/shared-types';

interface ValidationError {
  row: number;
  message: string;
}

interface UseImportPeopleModalResult {
  csvText: string;
  csvFile: File | null;
  errors: ValidationError[];
  isProcessing: boolean;
  result: ImportResultDto | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCsvChange: (text: string) => void;
  validateCsv: () => void;
  processImport: () => Promise<boolean>;
  reset: () => void;
}

const REQUIRED_COLUMNS = ['name'];
const EMAIL_OR_PHONE_COLUMNS = ['email', 'phone'];

export const useImportPeopleModal = ({ tenantId }: { tenantId: string }): UseImportPeopleModalResult => {
  const [csvText, setCsvText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ImportResultDto | null>(null);

  useEffect(() => {
    if (csvFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setCsvText(text);
      };
      reader.readAsText(csvFile);
    }
  }, [csvFile]);

  const parseCsv = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const lines = text.trim().split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] ?? '';
      });
      rows.push(row);
    }

    return { headers, rows };
  };

  const validateCsv = useCallback(() => {
    const validationErrors: ValidationError[] = [];
    const { headers, rows } = parseCsv(csvText);

    if (headers.length === 0) {
      validationErrors.push({ row: 0, message: 'CSV file is empty or has no headers' });
      setErrors(validationErrors);
      return;
    }

    const lowerHeaders = headers.map((h) => h.toLowerCase());
    const hasRequiredName = lowerHeaders.includes('name');
    if (!hasRequiredName) {
      validationErrors.push({ row: 0, message: 'Missing required column: "name"' });
    }

    const hasEmailOrPhone = EMAIL_OR_PHONE_COLUMNS.some((col) => lowerHeaders.includes(col));
    if (!hasEmailOrPhone) {
      validationErrors.push({ row: 0, message: 'Missing required column: "email" or "phone"' });
    }

    rows.forEach((row, idx) => {
      const rowNumber = idx + 2;

      if (!row.name || row.name.trim().length === 0) {
        validationErrors.push({ row: rowNumber, message: 'Missing required value: "name"' });
      }

      const hasEmail = row.email && row.email.trim().length > 0;
      const hasPhone = row.phone && row.phone.trim().length > 0;
      if (!hasEmail && !hasPhone) {
        validationErrors.push({ row: rowNumber, message: 'Missing required value: "email" or "phone"' });
      }
    });

    setErrors(validationErrors);
  }, [csvText]);

  const processImport = useCallback(async (): Promise<boolean> => {
    if (!tenantId || !csvText.trim()) {
      return false;
    }

    if (errors.length > 0) {
      return false;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const response = await apiClient.post<{ import: ImportResultDto }>(
        `/tenants/${tenantId}/imports/people`,
        { csv: btoa(csvText) }
      );
      setResult(response.import);
      return response.import.failureCount === 0;
    } catch (err: any) {
      setErrors([{ row: 0, message: err.message ?? 'Import failed' }]);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [tenantId, csvText, errors]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
      setErrors([]);
      setResult(null);
    }
  }, []);

  const handleCsvChange = useCallback((text: string) => {
    setCsvText(text);
  }, []);

  const reset = useCallback(() => {
    setCsvText('');
    setCsvFile(null);
    setErrors([]);
    setResult(null);
    setIsProcessing(false);
  }, []);

  return {
    csvText,
    csvFile,
    errors,
    isProcessing,
    result,
    handleFileChange,
    handleCsvChange,
    validateCsv,
    processImport,
    reset,
  };
};
