# FeeCore Universal — Master Architectural Implementation Plan

**Document Version:** 2.0.0  
**Status:** Approved Master Implementation Plan (Post Architecture Review)  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` & Architecture Review Directives  
**Roles:** Senior Software Architect, Product Engineer, QA Lead, Security Engineer, Technical PM  

---

## Executive Summary

**FeeCore Universal** is a configurable, multi-tenant SaaS platform engineered to manage the complete lifecycle of charges, dues, collections, receipts, and outstanding balances. It abstracts industry-specific vertical terms (e.g., Student/Tuition, Patient/Consultation, Resident/Maintenance, Member/Subscription) into **six universal business primitives**:
1. **Person**: The individual or account from whom money is collected.
2. **Charge**: The business obligation assessed against a Person.
3. **Due**: The scheduled, payable instance of a Charge with due date and balance.
4. **Payment**: Legal tender collected via recognized payment modes.
5. **Receipt**: The legally binding, auditable proof of transaction.
6. **Transaction History**: The immutable append-only ledger tracking all mutations.

This plan details the end-to-end technical implementation plan covering Sections A through V, incorporating all architectural review directives.

---

## A. Product Architecture

### A.1 High-Level Conceptual Architecture
The platform operates on a three-tier modular architecture:
```
+----------------------------------------------------------------------------------------------------+
|                                    PRESENTATION LAYER                                              |
|  [ Modern Responsive Web SPA (React + TypeScript + Vite + Vanilla CSS) ]                           |
|  * Dynamic Terminology Injection Context ('useTerminology()')                                      |
|  * Frictionless 4-Click Cashier Payment Flow                                                       |
|  * Dynamic Schema Form Renderer for Custom Fields                                                  |
|  * Deterministic Frozen Receipt Viewer & Printable PDF Renderer                                    |
+----------------------------------------------------------------------------------------------------+
                                                │ HTTPS / REST JSON API
                                                ▼ (Strings for all Minor-Unit Monetary Amounts)
+----------------------------------------------------------------------------------------------------+
|                                    APPLICATION & DOMAIN LAYER                                      |
|  [ NestJS with Fastify HTTP Adapter ]                                                              |
|  * Tenant Context & PostgreSQL RLS Session Interceptor                                             |
|  * RBAC Security Guards (Admin, Collector, Viewer)                                                 |
|  * Universal Domain Aggregates: Person, Charge, Due, Payment, Receipt, Transaction Log             |
|  * Financial State Machine & Invariant Enforcement Layer (Principal-First Late Fee Priority)       |
|  * Background Dues Generation Engine with Deterministic Cycle Keys                                 |
|  * Internal Notification Domain Event Bus & Outbox Interface                                       |
+----------------------------------------------------------------------------------------------------+
                                                │ PostgreSQL Wire Protocol (Prisma ORM)
                                                ▼
+----------------------------------------------------------------------------------------------------+
|                                     PERSISTENCE & STORAGE LAYER                                    |
|  [ PostgreSQL 16+ Relational Database ]                                                            |
|  * Row-Level Security (RLS) Tenant Isolation                                                       |
|  * BIGINT Minor-Unit Financial Storage (Paise / Cents)                                             |
|  * JSONB Document Engine for Dynamic Custom Fields & Frozen Receipt Snapshots                      |
|  * Transaction-Safe Atomic Tenant Sequences (Rollback-Safe Receipt Numbering)                      |
|  * Immutable Financial Transaction Ledger (Append-Only History, No Corporate GL)                   |
|  * High-Performance Indexed Aggregate Projections for Dashboard                                    |
+----------------------------------------------------------------------------------------------------+
```

### A.2 Architectural Invariants
* **Universal Domain Core:** Core database schemas and APIs are 100% agnostic of vertical terms. Terminology customizations are dynamic dictionary mappings applied at runtime.
* **Exact Financial Precision:** All monetary values are represented as `BIGINT` in the database, `bigint` in TypeScript, and **Strings** in JSON APIs. Floating-point types are prohibited.
* **Zero Hard Deletions:** Hard deletion of operational and financial records is physically disabled. Soft deactivations preserve full referential integrity.
* **Non-GL Financial Traceability:** The MVP maintains an Immutable Financial Transaction Ledger for auditability and reconciliation without introducing general corporate accounting or chart of accounts.

---

## B. Application Architecture

We adopt **Clean / Hexagonal Architecture (Ports & Adapters)** within a **Modular Monolith**:
```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                           Presentation Layer                           │
  │     Controllers, REST API Handlers, Zod Validation Pipes, DTOs         │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
  ┌───────────────────────────────────▼────────────────────────────────────┐
  │                           Application Layer                            │
  │     Use Cases, Command/Query Handlers, Transaction Boundaries, RBAC    │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
  ┌───────────────────────────────────▼────────────────────────────────────┐
  │                             Domain Layer                               │
  │     Entities, Value Objects, Domain Events, Financial FSM, Invariants  │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
  ┌───────────────────────────────────▼────────────────────────────────────┐
  │                        Infrastructure Layer                            │
  │     PostgreSQL / Prisma Client, RLS Hooks, Outbox Worker, PDF Engine   │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## C. Definitive Technology Stack

All framework alternatives are resolved:

| Layer | Chosen Technology | Justification |
| :--- | :--- | :--- |
| **Frontend Framework** | **React 18+ with TypeScript & Vite** | High-performance SPA, sub-second HMR, optimal component composition for dynamic terminology injection. |
| **Frontend Styling** | **Vanilla CSS (Design Tokens)** | Ultrafast CSS Custom Properties, zero-dependency, dark/light theming, total control without Tailwind version locks. |
| **Backend Framework** | **NestJS with TypeScript** | Enterprise modular architecture, strong dependency injection, built-in validation pipes, clean module boundaries. |
| **HTTP Adapter** | **Fastify (`@nestjs/platform-fastify`)** | High execution throughput (2x faster than Express), low memory overhead, native JSON schema support. |
| **Database** | **PostgreSQL 16+** | Full ACID transactions, native Row-Level Security (RLS), JSONB with GIN indexing, transaction-safe sequences. |
| **ORM / Data Access** | **Prisma ORM** | Type-safe query generation, migration engine, raw SQL escape hatches for session-level RLS context. |
| **Validation Engine** | **Zod** | Unified runtime schema validation for API request payloads and dynamic JSONB custom field validation. |
| **Receipt Rendering** | **HTML/CSS Print + PDFKit / Headless Chrome** | High-fidelity deterministic rendering from frozen JSON snapshots. |
| **Testing** | **Vitest, Supertest, Testcontainers** | Fast unit and integration tests with real PostgreSQL Docker containers matching production. |

---

## D. Repository Structure

A clean Monorepo layout:

```
feecore-universal/
├── apps/
│   ├── api/                           # NestJS + Fastify Backend
│   │   ├── src/
│   │   │   ├── core/                  # Infrastructure & Cross-Cutting
│   │   │   │   ├── database/          # Prisma client, RLS session hook, migrations
│   │   │   │   ├── security/          # Auth, JWT, RBAC guards, Tenant context
│   │   │   │   ├── audit/             # Centralized audit interceptor
│   │   │   │   └── errors/            # Standardized domain error handlers
│   │   │   ├── modules/               # Domain Modules
│   │   │   │   ├── tenant/            # Tenant settings, terminology dictionary
│   │   │   │   ├── people/            # Person CRUD, soft-deactivation, statements
│   │   │   │   ├── custom-fields/     # Dynamic field schemas & Zod validation
│   │   │   │   ├── charges/           # One-time charges, discounts, late fee rules
│   │   │   │   ├── recurring-plans/   # Recurring schedules & automated cron worker
│   │   │   │   ├── dues/              # Due tracking, status FSM, delinquency
│   │   │   │   ├── payments/          # Cashier intake, multi-due split, advance wallet
│   │   │   │   ├── receipts/          # Transaction-safe numbering & frozen snapshots
│   │   │   │   ├── refunds/           # Segregated Flow A (Due) & Flow B (Advance)
│   │   │   │   ├── dashboard/         # PostgreSQL indexed aggregate KPI queries
│   │   │   │   ├── reports/           # Collection, due, overdue, and payment reports
│   │   │   │   ├── search/            # Indexed global search across entities
│   │   │   │   └── import-export/     # Streaming CSV import/export pipeline
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/                      # E2E & Concurrency Test Suites
│   └── web/                           # React + Vite Frontend
│       ├── src/
│       │   ├── components/            # Reusable UI Design System (Vanilla CSS)
│       │   ├── contexts/              # TerminologyContext, AuthContext
│       │   ├── hooks/                 # useTerminology, useDues, useCashier
│       │   ├── views/                 # Top-level Page Views
│       │   │   ├── dashboard/         # Indexed KPI overview
│       │   │   ├── people/            # Directory & Statement views
│       │   │   ├── dues/              # Outstanding & Overdue management
│       │   │   ├── payments/          # 4-Click Cashier Workflow
│       │   │   ├── receipts/          # Deterministic Snapshot Viewer
│       │   │   ├── reports/           # Financial reporting & CSV exports
│       │   │   └── settings/          # Terminology & custom fields
│       │   ├── styles/                # CSS Custom Properties (Theme tokens)
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── vite.config.ts
├── packages/
│   └── shared-types/                  # Shared TypeScript DTOs & Contracts
├── docs/                              # Architecture & Project Specifications
└── docker-compose.yml                 # Local dev orchestration (API, Web, Postgres)
```

---

## E. Module Boundaries & Scope Classification

Every module is strictly classified:

| Module Name | Scope | Operational Responsibilities |
| :--- | :---: | :--- |
| **Tenant & Settings** | **MUST HAVE MVP** | Organization profile, terminology dictionary, receipt formatting preferences. |
| **Custom Fields** | **MUST HAVE MVP** | Dynamic field schema builder (Text, Number, Date, Select, Boolean) with Zod validation. |
| **People Management** | **MUST HAVE MVP** | Person CRUD, contact info, JSONB custom data, soft-deactivation, financial statement. |
| **Charges & Dues** | **MUST HAVE MVP** | One-time charges, recurring schedules, dues engine, Principal-First late fee priority. |
| **Payment & Allocation** | **MUST HAVE MVP** | Cashier intake (Cash, UPI, Card, etc.), multi-due split, manual advance wallet workflow. |
| **Receipts** | **MUST HAVE MVP** | In-transaction rollback-safe sequential numbering, frozen JSON snapshots, deterministic rendering. |
| **Refunds** | **MUST HAVE MVP** | Segregated Flow A (Due allocation refund) and Flow B (Advance wallet refund) with mandatory reasons. |
| **Transaction Ledger** | **MUST HAVE MVP** | Append-only immutable financial event log (`financial_transaction_logs`) for non-repudiation. |
| **Dashboard** | **MUST HAVE MVP** | Real-time KPI cards powered by PostgreSQL-backed indexed aggregate queries. |
| **Reports & CSV** | **MUST HAVE MVP** | Filterable Collection, Due, and Payment reports; streaming CSV import and export. |
| **Audit Logging** | **MUST HAVE MVP** | Centralized interceptor capturing user, IP, timestamp, and before/after diffs for all mutations. |
| **External Reminders** | **PHASE 1.5** | WhatsApp automated messaging, SMS gateway integration, automated outbound email dispatch. |
| **Online Payment Gateway**| **PHASE 1.5** | Razorpay / Stripe integration, hosted payment links, customer payment portal. |
| **General Ledger / ERP** | **OUT OF SCOPE** | Full accounting, double-entry GL, chart of accounts, trial balances, payroll, inventory. |

---

## F. Domain Model (Domain-Driven Design)

1. **Tenant (Aggregate Root):** Encapsulates organization metadata, currency, timezone, and dynamic terminology mappings.
2. **Person (Aggregate Root):** Payer identity. Holds contact fields, soft-deactivation status, cached `advance_balance`, and validated JSONB `custom_data`.
3. **Charge (Entity):** The base obligation. Holds category, base amount minor, discount amount minor, and due date.
4. **Due (Aggregate Root):** The payable instance. Holds net amount, late fee amount, allocated principal, allocated late fee, `balance_remaining`, and `DueStatus`.
5. **RecurringPlan (Aggregate Root):** Defines recurring schedule rules (frequency, anchor day of month, start/end dates).
6. **Payment (Aggregate Root):** Confirmed collected funds. Holds mode, reference, cashier user ID, total amount minor, and child allocations.
7. **PaymentAllocation (Entity):** Associative record linking Payment to Due with itemized `allocated_principal` and `allocated_late_fee`.
8. **Receipt (Entity):** Immutable proof. Holds unique sequence number and frozen `snapshot_data JSONB`.
9. **Refund (Entity):** Monetary reversal record. Segregated into Flow A (Due allocation) and Flow B (Advance wallet).
10. **FinancialTransactionLog (Entity):** Immutable append-only transaction entry tracking all financial events.

---

## G. Database Entity Proposal (PostgreSQL DDL)

```sql
-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tenants Table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'Other',
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tenant Settings & Terminology Dictionary
CREATE TABLE tenant_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    person_label_singular VARCHAR(100) NOT NULL DEFAULT 'Person',
    person_label_plural VARCHAR(100) NOT NULL DEFAULT 'People',
    charge_label_singular VARCHAR(100) NOT NULL DEFAULT 'Charge',
    charge_label_plural VARCHAR(100) NOT NULL DEFAULT 'Charges',
    receipt_prefix VARCHAR(20) NOT NULL DEFAULT 'REC',
    receipt_footer_text TEXT,
    auto_apply_advance BOOLEAN NOT NULL DEFAULT FALSE, -- MVP: Disabled by default
    late_fee_priority VARCHAR(30) NOT NULL DEFAULT 'PRINCIPAL_FIRST', -- MVP: Principal first
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Users Table (RBAC)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- 'ROLE_ADMIN', 'ROLE_COLLECTOR', 'ROLE_VIEWER'
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

-- 5. Custom Field Definitions
CREATE TABLE custom_field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    field_key VARCHAR(100) NOT NULL,
    field_label VARCHAR(100) NOT NULL,
    data_type VARCHAR(50) NOT NULL, -- 'TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    options JSONB,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_field_key UNIQUE (tenant_id, field_key)
);

-- 6. People Table
CREATE TABLE people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    full_name VARCHAR(255) NOT NULL,
    primary_phone VARCHAR(50) NOT NULL,
    secondary_phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    advance_balance BIGINT NOT NULL DEFAULT 0, -- Minor currency units (paise/cents)
    custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_people_advance_non_negative CHECK (advance_balance >= 0)
);
CREATE INDEX idx_people_search ON people (tenant_id, full_name, primary_phone);
CREATE INDEX idx_people_custom_data ON people USING gin (custom_data);

-- 7. Recurring Plans
CREATE TABLE recurring_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    category VARCHAR(100) NOT NULL,
    base_amount BIGINT NOT NULL,
    frequency VARCHAR(50) NOT NULL, -- 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'
    anchor_day INT NOT NULL DEFAULT 1,
    start_date DATE NOT NULL,
    end_date DATE,
    next_execution_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recurring_amount_positive CHECK (base_amount > 0)
);

-- 8. Charges
CREATE TABLE charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    recurring_plan_id UUID REFERENCES recurring_plans(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    base_amount BIGINT NOT NULL,
    discount_amount BIGINT NOT NULL DEFAULT 0,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_charge_base_positive CHECK (base_amount > 0),
    CONSTRAINT chk_charge_discount_valid CHECK (discount_amount >= 0 AND discount_amount <= base_amount)
);

-- 9. Dues Table
CREATE TABLE dues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    charge_id UUID NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,
    recurring_plan_id UUID REFERENCES recurring_plans(id) ON DELETE SET NULL,
    cycle_period_key VARCHAR(100), -- Deterministic key e.g. '2026-10'
    due_date DATE NOT NULL,
    net_amount BIGINT NOT NULL,
    late_fee_amount BIGINT NOT NULL DEFAULT 0,
    balance_remaining BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_dues_balance_non_negative CHECK (balance_remaining >= 0)
);
CREATE UNIQUE INDEX uq_recurring_due_idempotency 
    ON dues (tenant_id, recurring_plan_id, cycle_period_key) 
    WHERE recurring_plan_id IS NOT NULL;
CREATE INDEX idx_dues_dashboard ON dues (tenant_id, status, due_date, balance_remaining);
CREATE INDEX idx_dues_person ON dues (tenant_id, person_id, balance_remaining);

-- 10. Payments Table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    collector_user_id UUID NOT NULL REFERENCES users(id),
    payment_mode VARCHAR(50) NOT NULL, -- 'CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'
    total_amount BIGINT NOT NULL,
    allocated_to_dues BIGINT NOT NULL DEFAULT 0,
    credited_to_advance BIGINT NOT NULL DEFAULT 0,
    reference_number VARCHAR(100),
    notes TEXT,
    idempotency_key VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESSFUL', -- 'SUCCESSFUL', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'FAILED'
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payment_positive CHECK (total_amount > 0),
    CONSTRAINT chk_payment_sum_match CHECK (total_amount = allocated_to_dues + credited_to_advance),
    CONSTRAINT uq_payment_idempotency UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_payments_dashboard ON payments (tenant_id, payment_date, total_amount);

-- 11. Payment Allocations (Itemized Principal & Late Fee)
CREATE TABLE payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    due_id UUID NOT NULL REFERENCES dues(id) ON DELETE RESTRICT,
    allocated_principal BIGINT NOT NULL DEFAULT 0,
    allocated_late_fee BIGINT NOT NULL DEFAULT 0,
    total_allocated BIGINT NOT NULL,
    refunded_amount BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_allocation_sum CHECK (total_allocated = allocated_principal + allocated_late_fee),
    CONSTRAINT chk_allocation_refund_limit CHECK (refunded_amount <= total_allocated)
);

-- 12. Transaction-Safe Receipt Sequences Table
CREATE TABLE receipt_sequences (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fiscal_year VARCHAR(10) NOT NULL,
    current_sequence INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, fiscal_year)
);

-- 13. Receipts Table (Frozen Snapshots)
CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    receipt_number VARCHAR(100) NOT NULL,
    snapshot_data JSONB NOT NULL, -- Frozen payer, allocations, org profile, template_version
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_receipt_number UNIQUE (tenant_id, receipt_number)
);

-- 14. Refunds Table (Segregated Flow A & Flow B)
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    refund_type VARCHAR(50) NOT NULL, -- 'DUE_ALLOCATION' (Flow A) or 'ADVANCE_WALLET' (Flow B)
    payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT, -- For Flow A
    payment_allocation_id UUID REFERENCES payment_allocations(id) ON DELETE RESTRICT, -- For Flow A
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    processed_by_user_id UUID NOT NULL REFERENCES users(id),
    refund_amount BIGINT NOT NULL,
    refund_reason TEXT NOT NULL,
    refund_mode VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_refund_positive CHECK (refund_amount > 0)
);

-- 15. Immutable Financial Transaction Ledger (Non-GL Traceability)
CREATE TABLE financial_transaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    event_type VARCHAR(50) NOT NULL, -- 'CHARGE_CREATED', 'PAYMENT_RECEIVED', 'ADVANCE_CREDITED', 'ADVANCE_APPLIED', 'REFUND_PROCESSED', 'LATE_FEE_WAIVED'
    reference_entity_type VARCHAR(50) NOT NULL, -- 'DUE', 'PAYMENT', 'REFUND'
    reference_entity_id UUID NOT NULL,
    amount BIGINT NOT NULL,
    balance_snapshot BIGINT NOT NULL,
    metadata JSONB,
    performed_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_financial_ledger_person ON financial_transaction_logs (tenant_id, person_id, created_at);

-- 16. Audit Logs Table (Tamper-Evident User Actions)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    before_state JSONB,
    after_state JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## H. Authentication Architecture

1. **Password Hashing:** Passwords hashed with **Argon2id** (memory: 64 MB, iterations: 3, parallelism: 4).
2. **Stateless JWTs:** Access tokens (15-min lifespan) contain `user_id`, `tenant_id`, and `role`.
3. **Rotating Refresh Tokens:** 7-day lifespan stored in secure, HTTP-only SameSite cookies with family revocation.
4. **Tenant Context Assertion:** `tenant_id` is extracted strictly from the cryptographically verified JWT.

---

## I. Authorization & RBAC Architecture

Enforces the three canonical roles from SRS §9:
* **Admin / Owner:** Unconditional operational, financial, and configuration authority within the tenant.
* **Collector:** Operational access: People management, reviewing dues, collecting payments, applying advance credit, generating receipts. Blocked from system settings, refunds, and voiding charges.
* **Viewer:** Read-only access to people, dues, receipts, and reports. All mutating endpoints return `403 Forbidden`.

---

## J. Financial Transaction Architecture

### J.1 Transaction Ordering & Locking Behavior
To guarantee transaction safety, prevent double-spending, and ensure gapless receipt numbers:

```
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;

1. Check Idempotency Key in payments table -> Return cached response if exists.
2. SELECT * FROM dues WHERE id IN (:due_ids) AND tenant_id = :tenant_id FOR UPDATE;
3. Calculate Principal-First Allocations:
   - Apply payment to unpaid principal first.
   - Apply remainder to late fee.
   - Decrement due balance_remaining.
4. If payment exceeds selected dues:
   - UPDATE people SET advance_balance = advance_balance + :excess WHERE id = :person_id;
5. In-Transaction Receipt Sequence Reservation:
   - UPDATE receipt_sequences 
     SET current_sequence = current_sequence + 1
     WHERE tenant_id = :tenant_id AND fiscal_year = :fiscal_year
     RETURNING current_sequence;
6. Build Frozen Receipt Snapshot:
   - Capture payer, payment, allocations, org profile, and template_version ('v1.0').
7. INSERT INTO payments (...);
8. INSERT INTO payment_allocations (...);
9. INSERT INTO receipts (..., snapshot_data);
10. INSERT INTO financial_transaction_logs (...);

COMMIT TRANSACTION;
```
* **Rollback Safety Guarantee:** If any error occurs between steps 1 and 10, the transaction aborts and `receipt_sequences` rolls back automatically. A failed payment never consumes or leaks a receipt number.

---

## K. Recurring-Charge Architecture

1. **Cycle Period Normalization:** Standardizes recurring cycle keys:
   * Monthly: `YYYY-MM` (e.g., `2026-10`)
   * Weekly: `YYYY-Www` (e.g., `2026-W42`)
   * Yearly: `YYYY` (e.g., `2026`)
2. **Anchor-Day Month-End Preservation:**
   ```typescript
   function computeNextDueDate(anchorDay: number, year: number, month: number): string {
     const maxDays = new Date(year, month, 0).getDate();
     const day = Math.min(anchorDay, maxDays);
     return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
   }
   ```
3. **Concurrency Protection:** PostgreSQL unique index `(tenant_id, recurring_plan_id, cycle_period_key)` ensures that concurrent scheduler workers execute `ON CONFLICT DO NOTHING`, preventing duplicate dues.

---

## L. Notification Architecture (MVP Scope)

* **Internal Event Bus:** NestJS `EventEmitter2` dispatches domain events (`DueCreatedEvent`, `PaymentCollectedEvent`, `DueOverdueEvent`).
* **Outbox Interface:** Emitted events persist to a `notification_outbox` table.
* **MVP Decoupling:** In MVP, an internal worker logs notification payloads to the console/test logger. No external WhatsApp, SMS, or email vendor integrations are invoked in MVP.

---

## M. Audit-Log & History Architecture

* **Coverage:** Centralized NestJS interceptor logs all mutating operations (`POST`, `PUT`, `DELETE`).
* **Payload:** Captures `user_id`, `ip_address`, `timestamp`, `action`, `entity_type`, `entity_id`, and full before/after JSON diffs.
* **Immutability:** Applications connect with a role that has no `UPDATE` or `DELETE` grants on `audit_logs` or `financial_transaction_logs`.

---

## N. Import & Export Architecture

1. **Bulk CSV Import (People):** Streams incoming CSV files using `csv-parser` with $< 50\text{ MB}$ memory footprint. Each row is validated against standard contact fields and tenant custom field schemas via Zod. Returns structured row-level diagnostics.
2. **Stream CSV Export:** Streams database cursor queries directly into CSV HTTP responses for People, Dues, Payments, and Reports.

---

## O. Reporting Architecture (PostgreSQL-Backed)

All reports and dashboard KPI metrics run directly against PostgreSQL indexed tables:
1. **Today's Collection:** `SELECT SUM(total_amount) FROM payments WHERE tenant_id = $1 AND payment_date >= CURRENT_DATE;`
2. **Today's Due:** `SELECT SUM(net_amount) FROM dues WHERE tenant_id = $1 AND due_date = CURRENT_DATE;`
3. **Total Outstanding:** `SELECT SUM(balance_remaining) FROM dues WHERE tenant_id = $1 AND status != 'PAID';`
4. **Overdue Amount:** `SELECT SUM(balance_remaining) FROM dues WHERE tenant_id = $1 AND due_date < CURRENT_DATE AND balance_remaining > 0;`

---

## P. API Boundary Proposal (REST v1)

All monetary amounts in request and response JSON payloads are **Strings representing minor units** (e.g., `"amountMinor": "150050"`).

### Authentication & Settings
* `POST /api/v1/auth/login` — Login and receive JWT.
* `GET  /api/v1/tenant/profile` — Fetch tenant settings & terminology dictionary.
* `PUT  /api/v1/tenant/profile` — Update organization profile & receipt settings.
* `PUT  /api/v1/tenant/terminology` — Update terminology aliases.
* `GET  /api/v1/custom-fields` — List tenant custom field definitions.
* `POST /api/v1/custom-fields` — Create custom field definition.

### People Management
* `GET  /api/v1/people` — Filterable people directory.
* `POST /api/v1/people` — Register a Person (with custom fields).
* `GET  /api/v1/people/{id}` — Get person profile, advance balance, and active dues.
* `PUT  /api/v1/people/{id}` — Update person profile and custom data.
* `POST /api/v1/people/{id}/deactivate` — Soft-deactivate person.
* `GET  /api/v1/people/{id}/statement` — Unified financial ledger statement.

### Charges & Dues
* `POST /api/v1/charges` — Create one-time charge (generates Due).
* `POST /api/v1/recurring-plans` — Create recurring charge plan.
* `GET  /api/v1/dues` — Query dues (filters: `status`, `personId`, `overdueOnly`).
* `POST /api/v1/dues/{id}/waive-late-fee` — Admin waiver of assessed late fee.

### Payments, Advance & Receipts
* `POST /api/v1/payments` — Collect payment against selected dues (Principal-First).
* `POST /api/v1/payments/advance` — Collect unallocated advance to wallet.
* `POST /api/v1/dues/{id}/apply-advance` — Manually apply advance credit to due.
* `GET  /api/v1/receipts/{id}` — Retrieve receipt record with frozen snapshot.
* `GET  /api/v1/receipts/{id}/pdf` — Download deterministic receipt PDF.

### Segregated Refunds
* `POST /api/v1/refunds/due-allocation` — Flow A: Refund due allocation (re-opens Due).
* `POST /api/v1/refunds/advance-wallet` — Flow B: Refund unallocated advance wallet balance.
* `GET  /api/v1/refunds` — List audit history of all refunds.

### Reports & Dashboard
* `GET  /api/v1/dashboard/metrics` — Aggregate KPI cards.
* `GET  /api/v1/reports/collections` — Filterable collection report.
* `GET  /api/v1/reports/dues` — Outstanding and overdue aging report.
* `POST /api/v1/imports/people` — Bulk upload people CSV.
* `GET  /api/v1/exports/{entity}` — Stream CSV export.

---

## Q. Frontend Architecture

1. **Design System:** Pure Vanilla CSS using custom properties for theme tokens (colors, typography, glassmorphism, spacing, borders).
2. **Dynamic Terminology:** `useTerminology()` React Hook injects tenant aliases dynamically into headers, forms, tables, and receipts.
3. **Cashier Workflow (4-Click):**
   * Step 1: Global keyboard search (`Cmd+K` / `Ctrl+K`) locates Person in $< 100\text{ ms}$.
   * Step 2: Outstanding dues table displays pre-checked balances.
   * Step 3: Cashier enters amount and selects mode (Cash, UPI, Card).
   * Step 4: Instant confirmation with deterministic frozen receipt view and one-click print/PDF download.

---

## R. Testing Strategy

1. **Unit Tests (Vitest):** Minor unit arithmetic, Principal-First late fee ordering, anchor-day month clamping.
2. **Integration Tests (Supertest + Testcontainers):**
   * Multi-due atomic payment settlement and advance wallet workflows.
   * Database RLS enforcement: verifying cross-tenant queries return zero rows.
   * Rollback safety: verifying receipt sequences roll back when a payment fails.
3. **Concurrency Stress Tests:** Parallel execution of simultaneous payments against the same due to verify locking.
4. **Acceptance Test Suite:** Automated verification of SRS Acceptance Criteria BR-01 through BR-15.

---

## S. Security Strategy

* **Tenant Isolation:** Enforced at storage layer by PostgreSQL Row-Level Security (RLS) policies.
* **SQL Injection Prevention:** 100% parameterized queries via Prisma ORM.
* **XSS & Output Encoding:** HTML auto-escaping in React and strict sanitization in receipt PDF templates.
* **CSRF & Tokens:** SameSite=Strict HTTP-only cookies for refresh tokens; Bearer Authorization header for access tokens.
* **Tamper-Evident History:** Immutable append-only audit trail and financial transaction logs.

---

## T. Deployment Architecture

* **Containerization:** Multi-stage `Dockerfile` producing lightweight $< 150\text{ MB}$ Alpine images for NestJS and static Nginx containers for React SPA.
* **Database Migrations:** Prisma migration step executed prior to application boot in container startup scripts.
* **Local Development:** `docker-compose up` orchestrating PostgreSQL 16, NestJS API, and React Vite dev server.

---

## U. Development Phases

* **Phase 0:** Architecture, Repository Scaffolding, RLS & Testing Harness.
* **Phase 1:** Identity, Multi-Tenancy, Dynamic Terminology & People Registry.
* **Phase 2:** Charges, Recurring Plans, Background Dues Engine & Principal-First Late Fees.
* **Phase 3:** Cashier Intake, Multi-Due Allocation, Advance Wallet, Rollback-Safe Receipts & Frozen Snapshots.
* **Phase 4:** Segregated Refunds (Flow A / Flow B), Statements, Dashboard & Reports.
* **Phase 5:** Security Hardening, Audit Trail, Concurrency Tests & QA Certification.

---

## V. Definition of Done (DoD) Summary

A phase is considered **DONE** only when:
1. All functional requirements for that phase are implemented according to SRS specifications.
2. 100% of unit and integration tests pass with $\ge 90\%$ code coverage on domain services.
3. Zero cross-tenant data leakage under automated security tests.
4. Master Reconciliation Invariant passes under property-based testing.
5. All TypeScript code compiles in strict mode with zero ESLint warnings.
6. Documentation in `docs/` is updated and verified.
