import { UserRole } from './domain.js';

export const PERMISSIONS = {
  // Org
  ORG_PROFILE_VIEW: 'org:profile:view',
  ORG_PROFILE_UPDATE: 'org:profile:update',
  ORG_SETTINGS_UPDATE: 'org:settings:update',
  ORG_TERMINOLOGY_UPDATE: 'org:terminology:update',
  ORG_USERS_MANAGE: 'org:users:manage',

  // Custom Fields
  CUSTOM_FIELDS_VIEW: 'custom_fields:schema:view',
  CUSTOM_FIELDS_MANAGE: 'custom_fields:schema:manage',

  // People
  PEOPLE_VIEW: 'people:view',
  PEOPLE_CREATE: 'people:create',
  PEOPLE_UPDATE: 'people:update',
  PEOPLE_DEACTIVATE: 'people:deactivate',
  PEOPLE_REACTIVATE: 'people:reactivate',
  PEOPLE_STATEMENT_VIEW: 'people:statement:view',

  // Charges & Plans
  CHARGES_CREATE: 'charges:create',
  CHARGES_VIEW: 'charges:view',
  CHARGES_VOID: 'charges:void',
  RECURRING_PLAN_CREATE: 'recurring:plan:create',
  RECURRING_PLAN_VIEW: 'recurring:plan:view',
  RECURRING_PLAN_MANAGE: 'recurring:plan:manage',

  // Dues
  DUES_VIEW: 'dues:view',
  DUES_LATE_FEE_WAIVE: 'dues:late_fee:waive',
  DUES_RECALCULATE: 'dues:recalculate',

  // Payments
  PAYMENTS_COLLECT_FULL: 'payments:collect:full',
  PAYMENTS_COLLECT_PARTIAL: 'payments:collect:partial',
  PAYMENTS_COLLECT_MULTI: 'payments:collect:multi',
  PAYMENTS_COLLECT_ADVANCE: 'payments:collect:advance',
  PAYMENTS_APPLY_ADVANCE: 'payments:apply:advance',
  PAYMENTS_VIEW: 'payments:view',

  // Receipts
  RECEIPTS_VIEW: 'receipts:view',
  RECEIPTS_DOWNLOAD: 'receipts:download',
  RECEIPTS_REGENERATE: 'receipts:regenerate',

  // Refunds
  REFUNDS_VIEW: 'refunds:view',
  REFUNDS_REQUEST: 'refunds:request',
  REFUNDS_PROCESS: 'refunds:process',

  // Reports
  DASHBOARD_VIEW: 'dashboard:view',
  REPORTS_COLLECTION_VIEW: 'reports:collection:view',
  REPORTS_DUES_VIEW: 'reports:dues:view',
  REPORTS_EXPORT: 'reports:export',

  // Import / Export
  IMPORT_PEOPLE_EXECUTE: 'import:people:execute',
  EXPORT_TENANT_DATA: 'export:tenant_data',

  // Audit
  AUDIT_LOGS_VIEW: 'audit:logs:view'
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<UserRole, readonly PermissionKey[]> = {
  ROLE_ADMIN: Object.values(PERMISSIONS),
  ROLE_COLLECTOR: [
    PERMISSIONS.ORG_PROFILE_VIEW,
    PERMISSIONS.CUSTOM_FIELDS_VIEW,
    PERMISSIONS.PEOPLE_VIEW,
    PERMISSIONS.PEOPLE_CREATE,
    PERMISSIONS.PEOPLE_UPDATE,
    PERMISSIONS.PEOPLE_STATEMENT_VIEW,
    PERMISSIONS.CHARGES_CREATE,
    PERMISSIONS.CHARGES_VIEW,
    PERMISSIONS.RECURRING_PLAN_CREATE,
    PERMISSIONS.RECURRING_PLAN_VIEW,
    PERMISSIONS.DUES_VIEW,
    PERMISSIONS.PAYMENTS_COLLECT_FULL,
    PERMISSIONS.PAYMENTS_COLLECT_PARTIAL,
    PERMISSIONS.PAYMENTS_COLLECT_MULTI,
    PERMISSIONS.PAYMENTS_COLLECT_ADVANCE,
    PERMISSIONS.PAYMENTS_APPLY_ADVANCE,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.RECEIPTS_VIEW,
    PERMISSIONS.RECEIPTS_DOWNLOAD,
    PERMISSIONS.REFUNDS_VIEW,
    PERMISSIONS.REFUNDS_REQUEST,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_COLLECTION_VIEW,
    PERMISSIONS.REPORTS_DUES_VIEW
  ],
  ROLE_VIEWER: [
    PERMISSIONS.ORG_PROFILE_VIEW,
    PERMISSIONS.CUSTOM_FIELDS_VIEW,
    PERMISSIONS.PEOPLE_VIEW,
    PERMISSIONS.PEOPLE_STATEMENT_VIEW,
    PERMISSIONS.CHARGES_VIEW,
    PERMISSIONS.RECURRING_PLAN_VIEW,
    PERMISSIONS.DUES_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.RECEIPTS_VIEW,
    PERMISSIONS.RECEIPTS_DOWNLOAD,
    PERMISSIONS.REFUNDS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_COLLECTION_VIEW,
    PERMISSIONS.REPORTS_DUES_VIEW
  ]
};
