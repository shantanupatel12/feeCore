# FeeCore Universal — Role-Based Access Control (RBAC) & Permission Matrix

**Document Version:** 1.0.0  
**Status:** Approved for Architecture & Implementation  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` (Section 9, 11.1, 11.21, 24)  
**Author:** Senior Security Engineer & Systems Architect  

---

## 1. Security Principles & Architecture

FeeCore Universal enforces a **Zero-Trust Multi-Tenant RBAC** model with the following guarantees:
1. **Tenant-Strict Isolation:** Every permission check is evaluated strictly within the context of the user's active `tenant_id`. No cross-tenant privilege escalation or visibility is structurally possible.
2. **Principle of Least Privilege (PoLP):** Users are granted only the minimum permissions necessary to perform their operational duties.
3. **Segregation of Duties (SoD):** High-risk financial operations (such as issuing refunds, waiving late fees, and voiding charges) require elevated authority (`Owner / Admin`) and cannot be executed by frontline `Collector` roles without explicit authorization.
4. **Non-Repudiation:** Every action is attributed to an authenticated `user_id` and recorded in an immutable append-only audit trail.

---

## 2. Standard System Roles

| Role Key | Role Title | Scope & Business Responsibility |
| :--- | :--- | :--- |
| `ROLE_ADMIN` | **Owner / Admin** | Manages the business account, user provisioning, role assignments, terminology configuration, custom fields, financial overrides (discounts, late fee waivers), refunds, and all reporting. Full tenant-level authority. |
| `ROLE_COLLECTOR` | **Collector** | Handles routine front-desk and field operations: creating/updating people, reviewing dues, collecting single/multi/partial/advance payments, applying existing advance credit, and generating/printing receipts. Restricted from destructive alterations, refunds, and system configuration. |
| `ROLE_VIEWER` | **Viewer** | Read-only operational and reporting access. Can view people, charges, dues, collection statuses, and reports without the ability to mutate financial records, collect funds, or alter settings. |

---

## 3. Granular Permission Matrix

The table below maps granular permissions to system roles:
* **ALLOW**: Permitted unconditionally within the active tenant.
* **DENY**: Forbidden; system returns `HTTP 403 Forbidden`.
* **APPROVAL_REQ**: Requires multi-person approval or Owner escalation.

| Resource Domain | Granular Permission Key | Description | Owner / Admin | Collector | Viewer |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Organization & Config** | `org:profile:view` | View organization profile and contact information | ALLOW | ALLOW | ALLOW |
| | `org:profile:update` | Edit business profile, branding, and contact details | ALLOW | DENY | DENY |
| | `org:settings:update` | Update currency, timezone, tax, and receipt settings | ALLOW | DENY | DENY |
| | `org:terminology:update` | Modify Person and Charge terminology aliases | ALLOW | DENY | DENY |
| | `org:users:manage` | Invite, edit, assign roles, or deactivate tenant users | ALLOW | DENY | DENY |
| **Custom Fields** | `custom_fields:schema:view` | View custom field definitions | ALLOW | ALLOW | ALLOW |
| | `custom_fields:schema:manage`| Create, update, or archive custom field schemas | ALLOW | DENY | DENY |
| **People Management** | `people:view` | Search, view people lists, and inspect person profiles | ALLOW | ALLOW | ALLOW |
| | `people:create` | Add a new Person to the tenant directory | ALLOW | ALLOW | DENY |
| | `people:update` | Edit person contact details and custom field data | ALLOW | ALLOW | DENY |
| | `people:deactivate` | Soft-deactivate a Person (suspends recurring plans) | ALLOW | DENY | DENY |
| | `people:reactivate` | Restore an inactive Person to active status | ALLOW | DENY | DENY |
| | `people:statement:view` | View unified financial ledger statement for a person | ALLOW | ALLOW | ALLOW |
| **Charges & Plans** | `charges:create` | Create one-time charges against people | ALLOW | ALLOW | DENY |
| | `charges:view` | View charge definitions, categories, and audit logs | ALLOW | ALLOW | ALLOW |
| | `charges:void` | Void an unpaid charge (zero payments received) | ALLOW | DENY | DENY |
| | `recurring:plan:create` | Configure new recurring billing plans | ALLOW | ALLOW | DENY |
| | `recurring:plan:view` | View active and archived recurring plans | ALLOW | ALLOW | ALLOW |
| | `recurring:plan:manage` | Pause, resume, or terminate recurring plans | ALLOW | DENY | DENY |
| **Dues & Late Fees** | `dues:view` | View pending, partial, paid, and overdue dues | ALLOW | ALLOW | ALLOW |
| | `dues:late_fee:waive` | Waive or discount an assessed late fee | ALLOW | DENY | DENY |
| | `dues:recalculate` | Trigger on-demand late fee or due recomputation | ALLOW | DENY | DENY |
| **Payment Collection** | `payments:collect:full` | Record full payment against a due | ALLOW | ALLOW | DENY |
| | `payments:collect:partial` | Record partial payment against a due | ALLOW | ALLOW | DENY |
| | `payments:collect:multi` | Record single payment settling multiple dues | ALLOW | ALLOW | DENY |
| | `payments:collect:advance`| Record unallocated advance payment to wallet | ALLOW | ALLOW | DENY |
| | `payments:apply:advance` | Apply existing advance credit balance to a due | ALLOW | ALLOW | DENY |
| | `payments:view` | View payment lists, payment details, and breakdown | ALLOW | ALLOW | ALLOW |
| **Receipts** | `receipts:view` | View receipt details and history | ALLOW | ALLOW | ALLOW |
| | `receipts:download` | Download PDF or print receipt | ALLOW | ALLOW | ALLOW |
| | `receipts:regenerate` | Regenerate receipt rendering/template view | ALLOW | DENY | DENY |
| **Refunds** | `refunds:view` | View refund history and audit records | ALLOW | ALLOW | ALLOW |
| | `refunds:request` | Submit a formal refund request with reason | ALLOW | ALLOW | DENY |
| | `refunds:process` | Authorize and execute a monetary refund | ALLOW | DENY | DENY |
| **Reports & Dashboard** | `dashboard:view` | View real-time KPI cards and summary trends | ALLOW | ALLOW | ALLOW |
| | `reports:collection:view` | View collection reports with filters | ALLOW | ALLOW | ALLOW |
| | `reports:dues:view` | View due and overdue delinquency reports | ALLOW | ALLOW | ALLOW |
| | `reports:export` | Export reports to CSV/Excel | ALLOW | DENY | DENY |
| **Data Import/Export** | `import:people:execute` | Bulk upload and import people records via CSV | ALLOW | DENY | DENY |
| | `export:tenant_data` | Perform full export of tenant database records | ALLOW | DENY | DENY |
| **Audit & Governance** | `audit:logs:view` | View immutable system activity logs | ALLOW | DENY | DENY |

---

## 4. Multi-Tenant Enforcement Mechanism

To guarantee that permissions are strictly enforced within tenant boundaries:

### 4.1 JWT Claims Schema
Every authenticated request transmits a cryptographically signed JWT bearing tenant and role claims:
```json
{
  "sub": "usr_9b8f2c34-8451-419b-8fce-1b32d0119e71",
  "tenant_id": "ten_c10a47d2-38b8-4c17-9109-8d77d7f76901",
  "email": "sarah.admin@sunriseacademy.edu",
  "role": "ROLE_ADMIN",
  "permissions": [
    "org:profile:update",
    "people:create",
    "payments:collect:full",
    "refunds:process"
  ],
  "iss": "feecore-auth-service",
  "exp": 1790089200
}
```

### 4.2 Database Row-Level Security (PostgreSQL RLS)
At the database layer, every tenant-scoped table enforces Row-Level Security:
```sql
ALTER TABLE people ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON people
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
Application connection pools set the session variable `app.current_tenant_id` upon acquiring a connection from the pool. Even if application code contains a bug omitting `WHERE tenant_id = ...`, PostgreSQL physically blocks cross-tenant leakage at the storage engine level.
