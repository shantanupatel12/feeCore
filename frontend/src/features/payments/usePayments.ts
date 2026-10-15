import { useState, useCallback } from 'react';
import { PaymentMode } from '@feecore/shared-types';
import { apiClient, ApiError } from '../../lib/apiClient.js';

export interface PaymentCollectionResult {
  payment: {
    id: string;
    tenantId: string;
    personId: string;
    collectorUserId: string;
    paymentMode: PaymentMode;
    totalAmountMinor: string;
    allocatedToDuesMinor: string;
    creditedToAdvanceMinor: string;
    referenceNumber: string | null;
    notes: string | null;
    status: string;
    paymentDate: string;
    receiptId?: string;
  };
  allocation?: {
    id: string;
    dueId: string;
    allocatedPrincipalMinor: string;
    allocatedLateFeeMinor: string;
    totalAllocatedMinor: string;
    refundedAmountMinor: string;
  };
  allocations?: Array<{
    id: string;
    dueId: string;
    allocatedPrincipalMinor: string;
    allocatedLateFeeMinor: string;
    totalAllocatedMinor: string;
    refundedAmountMinor: string;
  }>;
  due?: {
    id: string;
    netAmountMinor: string;
    lateFeeAmountMinor: string;
    balanceRemainingMinor: string;
    status: string;
  };
  dues?: Array<{
    id: string;
    netAmountMinor: string;
    lateFeeAmountMinor: string;
    balanceRemainingMinor: string;
    status: string;
  }>;
  receipt?: {
    id: string;
    receiptNumber: string;
  };
  advanceCreditMinor?: string;
  person?: {
    id: string;
    advanceBalanceMinor: string;
  };
}

export function usePayments(tenantId: string) {
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const collectPayment = useCallback(async (data: {
    dueId: string;
    paymentMode: PaymentMode;
    amountMinor?: string;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
  }): Promise<PaymentCollectionResult> => {
    setIsCollecting(true);
    setCollectError(null);
    try {
      const body: Record<string, unknown> = {
        dueId: data.dueId,
        paymentMode: data.paymentMode,
        idempotencyKey: data.idempotencyKey,
      };
      if (data.amountMinor) body.amountMinor = data.amountMinor;
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;
      if (data.notes) body.notes = data.notes;

      const response = await apiClient.post<PaymentCollectionResult>(
        `/tenants/${tenantId}/payments`,
        body,
      );
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setCollectError(err.message || 'Failed to collect payment');
      } else {
        setCollectError('Failed to collect payment');
      }
      throw err;
    } finally {
      setIsCollecting(false);
    }
  }, [tenantId]);

  const collectMultiDuePayment = useCallback(async (data: {
    personId: string;
    totalAmountMinor: string;
    paymentMode: PaymentMode;
    allocations: Array<{ dueId: string; amountMinor: string }>;
    creditedToAdvanceMinor?: string;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
  }): Promise<PaymentCollectionResult> => {
    setIsCollecting(true);
    setCollectError(null);
    try {
      const body: Record<string, unknown> = {
        personId: data.personId,
        totalAmountMinor: data.totalAmountMinor,
        paymentMode: data.paymentMode,
        allocations: data.allocations,
        idempotencyKey: data.idempotencyKey,
      };
      if (data.creditedToAdvanceMinor) body.creditedToAdvanceMinor = data.creditedToAdvanceMinor;
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;
      if (data.notes) body.notes = data.notes;

      const response = await apiClient.post<PaymentCollectionResult>(
        `/tenants/${tenantId}/payments/multi-due`,
        body,
      );
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setCollectError(err.message || 'Failed to collect multi-due payment');
      } else {
        setCollectError('Failed to collect multi-due payment');
      }
      throw err;
    } finally {
      setIsCollecting(false);
    }
  }, [tenantId]);

  const collectAdvancePayment = useCallback(async (data: {
    personId: string;
    amountMinor: string;
    paymentMode: PaymentMode;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
  }): Promise<{
    payment: PaymentCollectionResult['payment'];
    person: { id: string; advanceBalanceMinor: string };
  }> => {
    setIsCollecting(true);
    setCollectError(null);
    try {
      const body: Record<string, unknown> = {
        personId: data.personId,
        amountMinor: data.amountMinor,
        paymentMode: data.paymentMode,
        idempotencyKey: data.idempotencyKey,
      };
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;
      if (data.notes) body.notes = data.notes;

      const response = await apiClient.post<{
        payment: PaymentCollectionResult['payment'];
        person: { id: string; advanceBalanceMinor: string };
      }>(`/tenants/${tenantId}/payments/advance`, body);
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setCollectError(err.message || 'Failed to collect advance payment');
      } else {
        setCollectError('Failed to collect advance payment');
      }
      throw err;
    } finally {
      setIsCollecting(false);
    }
  }, [tenantId]);

  const applyAdvance = useCallback(async (data: {
    dueId: string;
    personId: string;
    amountMinor?: string;
    idempotencyKey?: string;
  }): Promise<{
    allocation: {
      id: string;
      dueId: string;
      allocatedPrincipalMinor: string;
      allocatedLateFeeMinor: string;
      totalAllocatedMinor: string;
      refundedAmountMinor: string;
    };
    due: {
      id: string;
      netAmountMinor: string;
      lateFeeAmountMinor: string;
      balanceRemainingMinor: string;
    };
    person: {
      id: string;
      advanceBalanceMinor: string;
    };
  }> => {
    setIsCollecting(true);
    setCollectError(null);
    try {
      const body: Record<string, unknown> = {
        dueId: data.dueId,
        personId: data.personId,
      };
      if (data.amountMinor) body.amountMinor = data.amountMinor;
      if (data.idempotencyKey) body.idempotencyKey = data.idempotencyKey;

      const response = await apiClient.post<{
        allocation: {
          id: string;
          dueId: string;
          allocatedPrincipalMinor: string;
          allocatedLateFeeMinor: string;
          totalAllocatedMinor: string;
          refundedAmountMinor: string;
        };
        due: {
          id: string;
          netAmountMinor: string;
          lateFeeAmountMinor: string;
          balanceRemainingMinor: string;
        };
        person: {
          id: string;
          advanceBalanceMinor: string;
        };
      }>(`/tenants/${tenantId}/payments/apply-advance`, body);
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setCollectError(err.message || 'Failed to apply advance');
      } else {
        setCollectError('Failed to apply advance');
      }
      throw err;
    } finally {
      setIsCollecting(false);
    }
  }, [tenantId]);

  return {
    isCollecting,
    collectError,
    collectPayment,
    collectMultiDuePayment,
    collectAdvancePayment,
    applyAdvance,
  };
}
