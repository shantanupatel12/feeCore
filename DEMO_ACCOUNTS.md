# FeeCore Universal — Demo Accounts Guide

This document details the development and demonstration accounts configured for FeeCore Universal. All accounts belong to the primary development tenant: **`FeeCore Dev`**.

---

## Primary Tenant Information

| Parameter | Value | Notes |
|---|---|---|
| **Tenant ID** | `a0000000-0000-0000-0000-000000000001` | Pre-configured in UI |
| **Tenant Name** | FeeCore Dev | Active Development Tenant |
| **Default Currency** | `INR` (₹) | Configured in tenant settings |
| **Timezone** | `Asia/Kolkata` | Standard operating timezone |

---

## Demo Accounts Credentials & Role Matrix

### 1. System Administrator (`ROLE_ADMIN`)

- **Email**: `admin@feecore.dev`
- **Password**: `Password@123`
- **Role**: `ROLE_ADMIN`
- **Full Name**: Admin User
- **Status**: `ACTIVE`

#### Permissions & Capabilities:
Full administrative and organizational control across all 35 platform permissions:
- **Tenant Administration**: Update organization profile, billing details, terminology overrides, and receipt templates.
- **User Management**: Invite, assign, and manage system operators and cashier roles.
- **Custom Field Engine**: Create and manage custom schema fields across domain entities.
- **Immutable Audit Trail**: Full read access to system-wide audit logs (`GET /api/v1/audit-logs`).
- **Financial Authority**: Waive late fees, void charges, approve refunds, configure recurring billing plans, and trigger bulk due generation.
- **Operations & Reporting**: Execute exports, run collection reports, and access real-time financial dashboards.

---

### 2. Operational Cashier / Collector (`ROLE_COLLECTOR`)

- **Email**: `demo.collector@feecore.dev`
- **Password**: `CollectorDemo@2026!`
- **Role**: `ROLE_COLLECTOR`
- **Full Name**: Demo Collector
- **Status**: `ACTIVE`

#### Permissions & Capabilities:
Operational day-to-day cashiering, person intake, and payment reconciliation:
- **Payment Operations**: Collect payments across all payment modes (Cash, UPI, Card, Bank Transfer, Cheque).
- **Payment Flexibility**: Collect full payments, partial allocations, multi-due settlements, and advance wallet deposits.
- **Receipts**: Issue, view, and download deterministic frozen PDF receipts.
- **Entity Intake**: Create and update people, enroll members, create ad-hoc charges, and assign recurring plans.
- **Reports**: View collections reports, dues status, and operational dashboards.

#### Restricted Access (Blocked with HTTP 403 Forbidden):
- ❌ Cannot access system audit logs (`GET /api/v1/audit-logs`).
- ❌ Cannot modify organization profiles, custom field schemas, or tenant terminology.
- ❌ Cannot manage other users or alter tenant settings.

---

### 3. Read-Only Viewer / Auditor (`ROLE_VIEWER`)

- **Email**: `demo.user@feecore.dev`
- **Password**: `UserDemo@2026!`
- **Role**: `ROLE_VIEWER`
- **Full Name**: Demo User
- **Status**: `ACTIVE`

#### Permissions & Capabilities:
Non-mutating visibility for auditors, management, and compliance reviewers:
- **Read-Only Visibility**: View dashboard KPIs, collections reports, overdue schedules, and outstanding balances.
- **Entity Statements**: View people profiles, statements of account, and transaction histories.
- **Receipt Inspection**: View receipt records and download/print verified PDF receipts.

#### Restricted Access (Blocked with HTTP 403 Forbidden):
- ❌ Cannot collect payments or modify financial ledgers.
- ❌ Cannot create or edit people (e.g. `POST /api/v1/tenants/:tenantId/people` returns 403).
- ❌ Cannot create charges, assign recurring plans, or waive penalties.
- ❌ Cannot request or process refunds.
- ❌ Cannot access administrative audit logs.

---

## Login Instructions

### Option A: Web Application UI

1. Open your browser to the FeeCore frontend:
   👉 **`http://localhost:5180`**
2. On the login screen:
   - **Tenant ID**: `a0000000-0000-0000-0000-000000000001`
   - **Email**: Enter one of the demo emails above (e.g., `admin@feecore.dev`).
   - **Password**: Enter the corresponding password.
   *(Tip: Click the **"Fill Demo Credentials"** button on the login screen to instantly pre-fill the Admin credentials).*
3. Click **"Sign In"**. You will be authenticated and redirected to the dashboard according to your role permissions.

---

### Option B: REST API (Curl / Postman / PowerShell)

Authenticate via the public authentication endpoint:

```bash
curl -X POST "http://localhost:4000/api/v1/tenants/a0000000-0000-0000-0000-000000000001/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@feecore.dev", "password": "Password@123"}'
```

#### Successful Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "a0003175-b2df-48b4-b811-b9f6bb25fcfe",
    "email": "admin@feecore.dev",
    "fullName": "Admin User",
    "role": "ROLE_ADMIN",
    "tenantId": "a0000000-0000-0000-0000-000000000001"
  }
}
```

Use the returned `accessToken` as a Bearer token in subsequent requests:
```bash
curl -H "Authorization: Bearer <accessToken>" \
  "http://localhost:4000/api/v1/tenants/a0000000-0000-0000-0000-000000000001/dashboard/metrics"
```

---

## Re-Seeding & Maintenance

The seeding process is completely idempotent, safe, and zero-loss. It updates or creates missing demo accounts without deleting existing operational records or resetting the database.

To re-seed or verify demo accounts at any time, run:

```bash
# From repository root:
npm run seed:demo

# Or from backend/ directory:
npm run seed:demo
```
