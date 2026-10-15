export type UserRole = 'ROLE_ADMIN' | 'ROLE_COLLECTOR' | 'ROLE_VIEWER';

export const UserRoleValues = {
  ROLE_ADMIN: 'ROLE_ADMIN' as UserRole,
  ROLE_COLLECTOR: 'ROLE_COLLECTOR' as UserRole,
  ROLE_VIEWER: 'ROLE_VIEWER' as UserRole,
} as const;

export type DueStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOIDED';

export type PaymentStatus = 'SUCCESSFUL' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'FAILED';

export type PaymentMode = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'OTHER';

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export type RecurringPlanStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export type PersonStatus = 'ACTIVE' | 'INACTIVE';

export type CustomFieldDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';

export type RefundType = 'DUE_ALLOCATION' | 'ADVANCE_WALLET';

export type FinancialEventType = 
  | 'CHARGE_CREATED'
  | 'PAYMENT_RECEIVED'
  | 'ADVANCE_CREDITED'
  | 'ADVANCE_APPLIED'
  | 'DUE_ALLOCATION_REFUND'
  | 'ADVANCE_WALLET_REFUND'
  | 'LATE_FEE_WAIVED';

export interface TenantTerminology {
  personLabelSingular: string;
  personLabelPlural: string;
  chargeLabelSingular: string;
  chargeLabelPlural: string;
}
