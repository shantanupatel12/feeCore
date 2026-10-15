import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../../lib/apiClient.js';
import {
  OrganizationProfileDto,
  ReceiptConfigDto,
  TerminologyDto,
  CustomFieldDefinitionDto,
  UpdateOrganizationProfileRequest,
  UpdateReceiptConfigRequest,
  UpdateTerminologyRequest,
  CreateCustomFieldRequest,
  UpdateCustomFieldRequest,
} from '@feecore/shared-types';

interface UseSettingsResult {
  profile: OrganizationProfileDto | null;
  receiptConfig: ReceiptConfigDto | null;
  terminology: TerminologyDto | null;
  customFields: CustomFieldDefinitionDto[];
  customFieldsPagination: { page: number; limit: number; total: number } | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  fetchProfile: () => Promise<void>;
  updateProfile: (data: UpdateOrganizationProfileRequest) => Promise<void>;
  fetchReceiptConfig: () => Promise<void>;
  updateReceiptConfig: (data: UpdateReceiptConfigRequest) => Promise<void>;
  fetchTerminology: () => Promise<void>;
  updateTerminology: (data: UpdateTerminologyRequest) => Promise<void>;
  fetchCustomFields: (page?: number) => Promise<void>;
  createCustomField: (data: CreateCustomFieldRequest) => Promise<void>;
  updateCustomField: (id: string, data: UpdateCustomFieldRequest) => Promise<void>;
  deleteCustomField: (id: string) => Promise<void>;
}

export const useSettings = (tenantId: string): UseSettingsResult => {
  const [profile, setProfile] = useState<OrganizationProfileDto | null>(null);
  const [receiptConfig, setReceiptConfig] = useState<ReceiptConfigDto | null>(null);
  const [terminology, setTerminology] = useState<TerminologyDto | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinitionDto[]>([]);
  const [customFieldsPagination, setCustomFieldsPagination] = useState<{ page: number; limit: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<OrganizationProfileDto>(`/tenant/profile`);
      setProfile(response);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const updateProfile = useCallback(async (data: UpdateOrganizationProfileRequest) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.put(`/tenant/profile`, data);
      await fetchProfile();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to update profile');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchProfile]);

  const fetchReceiptConfig = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<ReceiptConfigDto>(`/tenant/receipt-config`);
      setReceiptConfig(response);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load receipt config');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const updateReceiptConfig = useCallback(async (data: UpdateReceiptConfigRequest) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.put(`/tenant/receipt-config`, data);
      await fetchReceiptConfig();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to update receipt config');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchReceiptConfig]);

  const fetchTerminology = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<TerminologyDto>(`/tenant/terminology`);
      setTerminology(response);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load terminology');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const updateTerminology = useCallback(async (data: UpdateTerminologyRequest) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.put(`/tenant/terminology`, data);
      await fetchTerminology();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to update terminology');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchTerminology]);

  const fetchCustomFields = useCallback(async (page = 1) => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<CustomFieldDefinitionDto[]>(`/custom-fields`);
      setCustomFields(Array.isArray(response) ? response : []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load custom fields');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const createCustomField = useCallback(async (data: CreateCustomFieldRequest) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.post(`/custom-fields`, data);
      await fetchCustomFields();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to create custom field');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchCustomFields]);

  const updateCustomField = useCallback(async (id: string, data: UpdateCustomFieldRequest) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.patch(`/custom-fields/${id}`, data);
      await fetchCustomFields();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to update custom field');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchCustomFields]);

  const deleteCustomField = useCallback(async (id: string) => {
    if (!tenantId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiClient.del(`/custom-fields/${id}`);
      await fetchCustomFields();
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to delete custom field');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [tenantId, fetchCustomFields]);

  useEffect(() => {
    if (tenantId) {
      fetchProfile();
    }
  }, [tenantId, fetchProfile]);

  return {
    profile,
    receiptConfig,
    terminology,
    customFields,
    customFieldsPagination,
    isLoading,
    error,
    isSaving,
    saveError,
    fetchProfile,
    updateProfile,
    fetchReceiptConfig,
    updateReceiptConfig,
    fetchTerminology,
    updateTerminology,
    fetchCustomFields,
    createCustomField,
    updateCustomField,
    deleteCustomField,
  };
};
