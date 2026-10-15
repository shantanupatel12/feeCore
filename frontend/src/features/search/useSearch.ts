import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import {
  SearchResponse,
  SearchPersonResult,
  SearchReceiptResult,
} from '@feecore/shared-types';

interface UseSearchResult {
  query: string;
  results: Array<SearchPersonResult | SearchReceiptResult>;
  isLoading: boolean;
  error: string | null;
  search: (q: string) => void;
  clear: () => void;
}

export const useSearch = (tenantId: string): UseSearchResult => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<SearchPersonResult | SearchReceiptResult>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<SearchResponse>(
        `/search?q=${encodeURIComponent(q.trim())}&limit=20`
      );
      setResults([...response.people, ...response.receipts]);
    } catch (err: any) {
      setError(err.message ?? 'Search failed');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
  }, []);

  return { query, results, isLoading, error, search, clear };
};
