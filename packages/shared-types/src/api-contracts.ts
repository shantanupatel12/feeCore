import { CustomFieldDataType, DueStatus, PaymentMode, PaymentStatus, PersonStatus, RecurringFrequency, RecurringPlanStatus, UserRole } from './domain.js';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: {
    code: string;
    details?: unknown;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Auth
export interface LoginRequest {
  email: string;
  password: string;
  tenantId?: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    tenantId: string;
  };
  tenant?: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
  };
}

// Custom Fields
export interface CreateCustomFieldRequest {
  fieldKey: string;
  fieldLabel: string;
  dataType: CustomFieldDataType;
  isRequired?: boolean;
  options?: string[];
  displayOrder?: number;
}

export interface CustomFieldDefinitionDto {
  id: string;
  tenantId: string;
  fieldKey: string;
  fieldLabel: string;
  dataType: CustomFieldDataType;
  isRequired: boolean;
  options: string[] | null;
  displayOrder: number;
  createdAt: string;
}

export interface UpdateCustomFieldRequest {
  fieldLabel?: string;
  dataType?: CustomFieldDataType;
  isRequired?: boolean;
  options?: string[];
  displayOrder?: number;
}

// Settings
export interface UpdateOrganizationProfileRequest {
  name: string;
  address?: string;
  taxId?: string;
  logoUrl?: string;
  currency?: string;
  timezone?: string;
}

export interface UpdateReceiptConfigRequest {
  receiptPrefix?: string;
  receiptFooterText?: string;
  logoUrl?: string;
}

export interface UpdateTerminologyRequest {
  personLabelSingular?: string;
  personLabelPlural?: string;
  chargeLabelSingular?: string;
  chargeLabelPlural?: string;
}

// People
export interface CreatePersonRequest {
  fullName: string;
  primaryPhone: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  customData?: Record<string, unknown>;
}

export interface UpdatePersonRequest {
  fullName?: string;
  primaryPhone?: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  customData?: Record<string, unknown>;
  status?: PersonStatus;
}

export interface PersonDto {
  id: string;
  tenantId: string;
  fullName: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  address: string | null;
  advanceBalanceMinor: string;
  customData: Record<string, unknown>;
  status: PersonStatus;
  createdAt: string;
  updatedAt: string;
}

// Charges & Dues
export interface CreateChargeRequest {
  personId: string;
  category: string;
  description?: string;
  baseAmountMinor: string;
  discountAmountMinor?: string;
  dueDate: string; // ISO date 'YYYY-MM-DD'
}

export interface ChargeDto {
  id: string;
  tenantId: string;
  personId: string;
  recurringPlanId: string | null;
  category: string;
  description: string | null;
  baseAmountMinor: string;
  discountAmountMinor: string;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateRecurringPlanRequest {
  personId: string;
  category: string;
  baseAmountMinor: string;
  frequency: RecurringFrequency;
  anchorDay?: number;
  startDate: string; // ISO date 'YYYY-MM-DD'
  endDate?: string;  // ISO date 'YYYY-MM-DD'
}

export interface UpdateRecurringPlanRequest {
  status?: RecurringPlanStatus;
  baseAmountMinor?: string;
  endDate?: string;
}

export interface RecurringPlanDto {
  id: string;
  tenantId: string;
  personId: string;
  category: string;
  baseAmountMinor: string;
  frequency: RecurringFrequency;
  anchorDay: number;
  startDate: string;
  endDate: string | null;
  nextExecutionDate: string;
  status: RecurringPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DueDto {
  id: string;
  tenantId: string;
  personId: string;
  chargeId: string;
  recurringPlanId: string | null;
  cyclePeriodKey: string | null;
  dueDate: string;
  netAmountMinor: string;
  lateFeeAmountMinor: string;
  balanceRemainingMinor: string;
  status: DueStatus;
  createdAt: string;
  updatedAt: string;
  person?: {
    id: string;
    fullName: string;
    primaryPhone: string;
  };
  charge?: {
    category: string;
    description: string | null;
  };
}

export interface GenerateDuesRequest {
  targetDate?: string; // ISO date 'YYYY-MM-DD'
  recurringPlanId?: string;
}

export interface GenerateDuesResponse {
  generatedCount: number;
  skippedCount: number;
  generatedDues: DueDto[];
}

// Payment Collection
export interface CollectPaymentRequest {
  personId: string;
  paymentMode: PaymentMode;
  totalAmountMinor: string;
  referenceNumber?: string;
  notes?: string;
  allocations?: Array<{
    dueId: string;
    amountMinor: string;
  }>;
}

export interface CollectAdvancePaymentRequest {
  personId: string;
  paymentMode: PaymentMode;
  amountMinor: string;
  referenceNumber?: string;
  notes?: string;
}

export interface ApplyAdvanceRequest {
  allocations: Array<{
    dueId: string;
    amountMinor: string;
  }>;
}

export interface PaymentDto {
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
  status: PaymentStatus;
  paymentDate: string;
  receiptId?: string;
}

// Receipts
export interface ReceiptOrganization {
  name: string | null;
  category: string | null;
  address: string | null;
  taxId: string | null;
  logoUrl: string | null;
  currency: string | null;
  timezone: string | null;
  receiptPrefix: string;
  receiptFooterText: string | null;
  terminology: {
    personLabelSingular: string;
    personLabelPlural: string;
    chargeLabelSingular: string;
    chargeLabelPlural: string;
  };
}

export interface ReceiptPayer {
  personId: string;
  fullName: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  email: string | null;
  address: string | null;
  customData: Record<string, unknown>;
}

export interface ReceiptPayment {
  paymentId: string;
  totalAmountMinor: string;
  allocatedToDuesMinor: string;
  creditedToAdvanceMinor: string;
  paymentMode: string;
  referenceNumber: string | null;
  collectorUserId: string;
  collectorName: string | null;
  paymentDate: string;
}

export interface ReceiptAllocation {
  dueId: string;
  dueDate: string | null;
  chargeId: string | null;
  category: string | null;
  description: string | null;
  allocatedPrincipalMinor: string;
  allocatedLateFeeMinor: string;
  totalAllocatedMinor: string;
}

export interface ReceiptTotals {
  allocatedPrincipalMinor: string;
  allocatedLateFeeMinor: string;
  creditedToAdvanceMinor: string;
  grandTotalMinor: string;
}

export interface ReceiptSnapshot {
  templateVersion: string;
  receiptNumber: string;
  organization: ReceiptOrganization;
  payer: ReceiptPayer;
  payment: ReceiptPayment;
  allocations: ReceiptAllocation[];
  totals: ReceiptTotals;
}

export interface ReceiptDto {
  id: string;
  receiptNumber: string;
  paymentId: string;
  issuedAt: string;
  snapshot: ReceiptSnapshot;
}

export interface ReceiptListItemDto {
  id: string;
  receiptNumber: string;
  paymentId: string;
  issuedAt: string;
}

// Refunds
export interface CreateAllocationRefundRequest {
  paymentAllocationId: string;
  refundAmountMinor: string;
  refundMode: string;
  refundReason: string;
  referenceNumber?: string;
}

export interface CreateAdvanceRefundRequest {
  personId: string;
  refundAmountMinor: string;
  refundMode: string;
  refundReason: string;
  referenceNumber?: string;
}

export interface RefundDto {
  id: string;
  refundType: 'DUE_ALLOCATION' | 'ADVANCE_WALLET';
  paymentId: string | null;
  paymentAllocationId: string | null;
  personId: string;
  processedByUserId: string;
  refundAmountMinor: string;
  refundReason: string;
  refundMode: string;
  referenceNumber: string | null;
  createdAt: string;
}

export interface PaymentCollectResponse {
  payment: PaymentDto;
  allocation?: Record<string, unknown>;
  allocations?: Array<Record<string, unknown>>;
  due?: Record<string, unknown>;
  dues?: Array<Record<string, unknown>>;
  receipt?: {
    id: string;
    receiptNumber: string;
  };
  advanceCreditMinor?: string;
}

export interface RefundResponse {
  refund: {
    id: string;
    refundAmountMinor: string;
  };
  allocation?: {
    id: string;
    totalAllocatedMinor: string;
    refundedAmountMinor: string;
  };
  paymentStatus: string;
  due?: {
    id: string;
    netAmountMinor: string;
    balanceRemainingMinor: string;
  };
  person?: {
    id: string;
    advanceBalanceMinor: string;
  };
}

// Reports
export interface CollectionReportTotals {
  paymentCount: number;
  grossCollectedMinor: string;
  allocatedToDuesMinor: string;
  creditedToAdvanceMinor: string;
  refundedMinor: string;
  netCollectedMinor: string;
}

export interface CollectionReportByPaymentMode {
  paymentMode: string;
  paymentCount: number;
  totalMinor: string;
}

export interface CollectionReportByCollector {
  collectorUserId: string;
  collectorName: string | null;
  paymentCount: number;
  totalMinor: string;
}

export interface CollectionReportItem {
  id: string;
  paymentDate: string;
  paymentMode: string;
  status: string;
  personId: string;
  personName: string;
  personPrimaryPhone: string;
  collectorUserId: string;
  collectorName: string;
  referenceNumber: string | null;
  totalAmountMinor: string;
  allocatedToDuesMinor: string;
  creditedToAdvanceMinor: string;
  receiptNumbers: string[];
}

export interface CollectionReportResponse {
  period: { from: string | null; to: string | null };
  totals: CollectionReportTotals;
  byPaymentMode: CollectionReportByPaymentMode[];
  byCollector: CollectionReportByCollector[];
  items: CollectionReportItem[];
  page: number;
  limit: number;
  totalPages: number;
}

export interface DuesReportTotals {
  openDueCount: number;
  totalOutstandingMinor: string;
  outstandingLateFeeMinor: string;
  overdueDueCount: number;
  totalOverdueMinor: string;
}

export interface DuesReportByStatus {
  status: string;
  dueCount: number;
  balanceMinor: string;
}

export interface DuesReportByCategory {
  category: string;
  dueCount: number;
  balanceMinor: string;
}

export interface DuesReportAgingBucket {
  bucket: string;
  dueCount: number;
  amountMinor: string;
}

export interface DuesReportItem {
  id: string;
  dueDate: string;
  status: string;
  personId: string;
  personName: string;
  personPrimaryPhone: string;
  category: string;
  description: string | null;
  netAmountMinor: string;
  lateFeeAmountMinor: string;
  balanceRemainingMinor: string;
  daysOverdue: number;
}

export interface DuesReportResponse {
  period: { from: string | null; to: string | null };
  asOf: string;
  totals: DuesReportTotals;
  byStatus: DuesReportByStatus[];
  byCategory: DuesReportByCategory[];
  overdueAging: DuesReportAgingBucket[];
  items: DuesReportItem[];
  page: number;
  limit: number;
  totalPages: number;
}

// Settings
export interface OrganizationProfileDto {
  id: string;
  name: string;
  category: string;
  address: string | null;
  taxId: string | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptConfigDto {
  receiptPrefix: string;
  receiptFooterText: string | null;
  logoUrl: string | null;
  sequences: Array<{ fiscalYear: string; currentSequence: number }>;
}

export interface TerminologyDto {
  personLabelSingular: string;
  personLabelPlural: string;
  chargeLabelSingular: string;
  chargeLabelPlural: string;
  updatedAt: string;
}

// Search
export interface SearchPersonResult {
  id: string;
  fullName: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  status: string;
  customData: Record<string, unknown>;
}

export interface SearchReceiptResult {
  id: string;
  receiptNumber: string;
  paymentId: string;
  issuedAt: string;
}

export interface SearchResponse {
  q: string;
  people: SearchPersonResult[];
  receipts: SearchReceiptResult[];
  total: number;
  limit: number;
}

// Import/Export
export interface ImportError {
  row: number;
  message: string;
}

export interface ImportResultDto {
  jobId: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  errors: ImportError[];
}

// Audit
export interface AuditLogDto {
  id: string;
  personId: string;
  eventType: string;
  referenceEntityType: string;
  referenceEntityId: string;
  amountMinor: string;
  balanceSnapshotMinor: string;
  metadata: Record<string, unknown>;
  performedByUserId: string;
  createdAt: string;
}

export const EXPORTABLE_ENTITIES = ['people', 'dues', 'payments', 'reports'] as const;
export type ExportableEntity = (typeof EXPORTABLE_ENTITIES)[number];
export interface DashboardMetricsDto {
  asOf: string;
  currentPeriod: {
    from: string;
    to: string;
  };
  collection: {
    todayCollectedMinor: string;
    todayPaymentsCount: number;
    todayAllocatedToDuesMinor: string;
    todayCreditedToAdvanceMinor: string;
    periodCollectedMinor: string;
    periodPaymentsCount: number;
    allTimeCollectedMinor: string;
    allTimeRefundsMinor: string;
    allTimeNetCollectedMinor: string;
  };
  dues: {
    dueRaisedTodayMinor: string;
    dueRaisedTodayCount: number;
    totalOutstandingMinor: string;
    openDueCount: number;
    paidDueCount: number;
    outstandingLateFeeMinor: string;
  };
  overdue: {
    totalOverdueMinor: string;
    overdueDueCount: number;
    paymentsTodayCount: number;
  };
  people: {
    total: number;
    active: number;
  };
  advance: {
    totalHeldMinor: string;
  };
}
