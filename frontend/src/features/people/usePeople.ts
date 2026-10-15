import { useState, useCallback, useEffect, useRef } from 'react';
import { PersonDto, CreatePersonRequest, UpdatePersonRequest, PaginatedResult } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface UsePeopleResult {
  people: PersonDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  loadPage: (page: number) => void;
  createPerson: (data: CreatePersonRequest) => Promise<PersonDto>;
  updatePerson: (id: string, data: UpdatePersonRequest) => Promise<PersonDto>;
  deactivatePerson: (id: string) => Promise<PersonDto>;
}

export function usePeople(tenantId: string): UsePeopleResult {
  const [people, setPeople] = useState<PersonDto[]>([]);
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
  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;

  const fetchPeople = useCallback(async (page: number, search: string) => {
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

      const response = await apiClient.get<PaginatedResult<PersonDto>>(
        `/tenants/${tenantId}/people?${params.toString()}`,
      );

      setPeople(response.items);
      setPagination({
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load people');
      } else {
        setError('Failed to load people');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const loadPage = useCallback((page: number) => {
    fetchPeople(page, searchTermRef.current);
  }, [fetchPeople]);

  const refetch = useCallback(() => {
    fetchPeople(paginationRef.current.page, searchTermRef.current);
  }, [fetchPeople]);

  useEffect(() => {
    fetchPeople(1, searchTerm);
  }, [searchTerm, fetchPeople]);

  const createPerson = async (data: CreatePersonRequest): Promise<PersonDto> => {
    return await apiClient.post<PersonDto>(`/tenants/${tenantId}/people`, data);
  };

  const updatePerson = async (id: string, data: UpdatePersonRequest): Promise<PersonDto> => {
    return await apiClient.put<PersonDto>(`/tenants/${tenantId}/people/${id}`, data);
  };

  const deactivatePerson = async (id: string): Promise<PersonDto> => {
    return await apiClient.post<PersonDto>(`/tenants/${tenantId}/people/${id}/deactivate`, {});
  };

  return {
    people,
    pagination,
    searchTerm,
    setSearchTerm,
    isLoading,
    error,
    refetch,
    loadPage,
    createPerson,
    updatePerson,
    deactivatePerson,
  };
}
