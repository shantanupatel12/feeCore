# FeeCore Universal — Requirements Traceability Matrix (RTM)

**Document Version:** 2.0.0  
**Status:** Approved Requirements Baseline (Post Architecture Review)  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` & Architecture Review Directives  
**Author:** Senior Software Architect & Technical PM  

---

## 1. Executive Summary & Purpose

This document provides end-to-end forward and backward traceability for **FeeCore Universal**. It maps every business requirement, functional requirement, non-functional requirement, and acceptance criterion defined in the authoritative SRS to domain models, proposed API boundaries, database entities, UI views, and verification test cases.

The system is constructed strictly around **six universal business primitives**:
1. **Person**: The individual or account from whom money is collected.
2. **Charge**: The business obligation created for a Person.
3. **Due**: The scheduled, payable instance of a Charge with due date and balance.
4. **Payment**: Legal tender collected via recognized payment modes.
5. **Receipt**: The legally binding, auditable proof of received payment.
6. **Transaction History**: The immutable append-only ledger of charges, payments, allocations, and refunds.

---

## 2. Definitive Scope Boundary Matrix

Every functional area is classified into one of three strict boundaries:
* **MUST HAVE MVP**: Core platform required for MVP acceptance.
* **PHASE 1.5**: Post-core enhancements scheduled after MVP sign-off.
* **OUT OF SCOPE**: Explicitly excluded features; must never be implemented.

```
+----------------------------------------------------------------------------------------------------+
|                                    DEFINITIVE SCOPE BOUNDARY MATRIX                                |
+------------------------------------+--------------------------------+------------------------------+
| MUST HAVE MVP                      | PHASE 1.5                      | EXPLICITLY OUT OF SCOPE      |
+------------------------------------+--------------------------------+------------------------------+
| * Multi-Tenant Org Setup & Branding| * WhatsApp automated reminders | * Full ERP / General Ledger  |
| * Dynamic Terminology Dictionary   | * SMS gateway integration      | * Double-entry corporate GL  |
| * RBAC (Admin, Collector, Viewer)  | * Outbound email automation    | * Chart of accounts / trial  |
| * People CRUD & Soft Deactivation  | * Online payment links (web)   | * Payroll & HR management    |
| * Schema-validated Custom Fields   | * Payment gateway integrations | * Inventory & Warehousing    |
| * One-Time Charges & Due Tracking  |   (Razorpay / Stripe)          | * CRM / Sales Pipeline       |
| * Recurring Charge Schedule Engine | * Multi-branch / Multi-campus  | * School ERP (Exams, Library)|
| * Full, Partial & Multi-Due Payment| * Customer/Payer Self-Service  | * Clinical EMR / Medical Rx  |
| * Principal-First Late Fee Priority|   Portal                       | * Biometrics & Facial Recog  |
| * Advance Payment Wallet (Manual)  | * Dynamic QR code collection   | * Advanced GST tax filing    |
| * Transaction-Safe Receipt Sequence|                                | * AI Copilots & Assistants   |
| * Frozen Receipt Snapshot & PDF    |                                | * Native iOS/Android Apps    |
| * Segregated Refunds (Due/Advance) |                                | * Bank Feeds Reconciliation  |
| * Immutable Transaction Ledger     |                                | * Event-streaming / Kafka    |
| * PostgreSQL-Backed Dashboard KPIs |                                |                              |
| * Collection, Due, Overdue Reports |                                |                              |
| * CSV Import (People) & CSV Export |                                |                              |
| * Responsive Web UI (Desktop/Mobile|                                |                              |
+------------------------------------+--------------------------------+------------------------------+
```

---

## 3. Functional Requirements Decomposition (FRD)

Monetary values in all REST JSON payloads are serialized as **Strings** representing minor currency units (paise/cents).

### 3.1 Organization, Configuration & Terminology (MUST HAVE MVP)

| ID | SRS Source | Description | Domain Entity | API Endpoint | Scope | Test ID | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-ORG-01** | §11.1, §24 | Business can configure organization profile (Name, Address, Tax ID, Currency, Timezone). | `Tenant` | `PUT /api/v1/tenant/profile` | MUST HAVE MVP | `TC-ORG-001` | BR-01 |
| **FR-ORG-02** | §8, §11.1, §24 | Business can customize terminology aliases (`person_label`, `charge_label`) without altering DB schema. | `TenantSettings` | `PUT /api/v1/tenant/terminology` | MUST HAVE MVP | `TC-ORG-002` | BR-01 |
| **FR-ORG-03** | §11.1, §11.14 | Business can configure receipt prefix, footer, logo, and receipt numbering sequence. | `ReceiptConfig` | `PUT /api/v1/tenant/receipt-config` | MUST HAVE MVP | `TC-ORG-003` | BR-08 |

### 3.2 People & Custom Fields Management (MUST HAVE MVP)

| ID | SRS Source | Description | Domain Entity | API Endpoint | Scope | Test ID | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-PER-01** | §11.2, §24 | Create, Read, Update Person with name, primary phone, secondary phone, email, address. | `Person` | `POST /api/v1/people`, `GET /api/v1/people/{id}` | MUST HAVE MVP | `TC-PER-001` | BR-02 |
| **FR-PER-02** | §11.2, §12 | Search people rapidly by name, phone, email, identifier. | `Person` | `GET /api/v1/people?query=` | MUST HAVE MVP | `TC-PER-002` | BR-02 |
| **FR-PER-03** | §11.2, §12 | Soft deactivation of Person: blocks new charge creation and due generation while preserving complete history. | `Person` | `POST /api/v1/people/{id}/deactivate` | MUST HAVE MVP | `TC-PER-003` | BR-02, BR-13 |
| **FR-PER-04** | §11.2, §11.15 | View single unified financial ledger for a Person: all dues, payments, advances, refunds. | `Person`, `FinancialTransactionLog` | `GET /api/v1/people/{id}/statement` | MUST HAVE MVP | `TC-PER-004` | BR-02, BR-13 |
| **FR-CFD-01** | §11.3, §24 | Admin can define tenant-specific custom field schemas (Text, Number, Date, Select, Boolean). | `CustomFieldDef` | `POST /api/v1/custom-fields` | MUST HAVE MVP | `TC-CFD-001` | BR-12 |
| **FR-CFD-02** | §11.3, §24 | Person entity stores custom field values validated against tenant schema in JSONB. | `Person` (`custom_data`) | `POST /api/v1/people`, `PUT /api/v1/people/{id}` | MUST HAVE MVP | `TC-CFD-002` | BR-12 |

### 3.3 Charges & Due Engine (MUST HAVE MVP)

| ID | SRS Source | Description | Domain Entity | API Endpoint | Scope | Test ID | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-CHG-01** | §11.4, §24 | Create one-time Charge for a Person with Category, Base Amount Minor string, Due Date. | `Charge`, `Due` | `POST /api/v1/charges` | MUST HAVE MVP | `TC-CHG-001` | BR-03 |
| **FR-CHG-02** | §11.4, §11.11 | Apply fixed or percentage discount to Charge, recalculating net payable amount. | `Charge` | `POST /api/v1/charges` | MUST HAVE MVP | `TC-CHG-002` | BR-03 |
| **FR-CHG-03** | §11.4, §11.12 | Configure late fee rules (Fixed or Daily penalty) evaluated when due date lapses. | `LateFeeRule` | `POST /api/v1/late-fee-rules` | MUST HAVE MVP | `TC-CHG-003` | BR-03, BR-10 |
| **FR-REC-01** | §11.5, §24 | Create Recurring Charge Plan (Frequency: Daily, Weekly, Monthly, Quarterly, Yearly; Anchor Day). | `RecurringPlan` | `POST /api/v1/recurring-plans` | MUST HAVE MVP | `TC-REC-001` | BR-04 |
| **FR-REC-02** | §11.5, §12 | Background worker generates Dues for each recurring cycle idempotently via cycle period key. | `Due` | `POST /api/v1/jobs/generate-dues` | MUST HAVE MVP | `TC-REC-002` | BR-04 |
| **FR-DUE-01** | §11.6, §24 | List all dues with real-time status (`PENDING`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`) and filtering. | `Due` | `GET /api/v1/dues` | MUST HAVE MVP | `TC-DUE-001` | BR-10 |
| **FR-DUE-02** | §11.6, §12 | Automatically classify Due as `OVERDUE` when current date > `due_date` and `balance_remaining` > 0. | `Due` | `GET /api/v1/dues/overdue` | MUST HAVE MVP | `TC-DUE-002` | BR-10 |

### 3.4 Payments, Allocations & Advance Management (MUST HAVE MVP)

| ID | SRS Source | Description | Domain Entity | API Endpoint | Scope | Test ID | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-PAY-01** | §11.7, §24 | Collect payment against selected Due(s); enforce Principal-First late fee priority. | `Payment`, `PaymentAllocation` | `POST /api/v1/payments` | MUST HAVE MVP | `TC-PAY-001` | BR-05, BR-07 |
| **FR-PAY-02** | §11.8, §24 | Partial payment support: balance updates immediately; status becomes `PARTIALLY_PAID`. | `Payment`, `Due` | `POST /api/v1/payments` | MUST HAVE MVP | `TC-PAY-002` | BR-05 |
| **FR-PAY-03** | §11.9, §24 | Multiple-charge payment: allocate single payment across multiple dues atomically. | `Payment`, `PaymentAllocation` | `POST /api/v1/payments/multi-due` | MUST HAVE MVP | `TC-PAY-003` | BR-07 |
| **FR-ADV-01** | §11.10, §24 | Collect advance payment with no selected dues; credit to Person's `advance_balance`. | `Payment`, `Person` | `POST /api/v1/payments/advance` | MUST HAVE MVP | `TC-ADV-001` | BR-06 |
| **FR-ADV-02** | §11.10, §24 | Apply available advance credit to outstanding dues explicitly (Manual Application). | `PaymentAllocation` | `POST /api/v1/dues/{id}/apply-advance` | MUST HAVE MVP | `TC-ADV-002` | BR-06 |
| **FR-REF-01** | §11.13, §24 | Process Flow A: Due Allocation Refund (re-opens due, reduces collected revenue). | `Refund`, `PaymentAllocation`, `Due` | `POST /api/v1/refunds/due-allocation` | MUST HAVE MVP | `TC-REF-001` | BR-09 |
| **FR-REF-02** | §11.13, §24 | Process Flow B: Advance Wallet Refund (decrements wallet; zero due mutation). | `Refund`, `Person` | `POST /api/v1/refunds/advance-wallet` | MUST HAVE MVP | `TC-REF-002` | BR-09 |
| **FR-RCP-01** | §11.14, §24 | Generate immutable Receipt inside payment transaction with frozen JSON snapshot. | `Receipt` | `GET /api/v1/receipts/{id}`, `GET /api/v1/receipts/{id}/pdf` | MUST HAVE MVP | `TC-RCP-001` | BR-08 |

### 3.5 Reporting, Dashboard & Governance (MUST HAVE MVP)

| ID | SRS Source | Description | Domain Entity | API Endpoint | Scope | Test ID | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-DSH-01** | §11.17, §14 | Real-time Dashboard KPIs via PostgreSQL indexed queries: Today's Collection, Today's Due, Total Outstanding, Overdue. | Projection Query | `GET /api/v1/dashboard/metrics` | MUST HAVE MVP | `TC-DSH-001` | BR-10 |
| **FR-REP-01** | §11.18, §15 | Generate Collection Report filtered by date range, payment mode, collector, person. | `Payment`, `Receipt` | `GET /api/v1/reports/collections` | MUST HAVE MVP | `TC-REP-001` | BR-11 |
| **FR-REP-02** | §11.18, §15 | Generate Dues & Overdue Reports filtered by age bucket, category, person. | `Due` | `GET /api/v1/reports/dues` | MUST HAVE MVP | `TC-REP-002` | BR-10, BR-11 |
| **FR-SRH-01** | §11.19 | Global search bar resolving Person Name, Phone, Email, Receipt Number. | Indexed search | `GET /api/v1/search?q=` | MUST HAVE MVP | `TC-SRH-001` | BR-02, BR-08 |
| **FR-IMP-01** | §11.20 | Bulk import of People records from CSV with row-level validation. | `Person`, `ImportJob` | `POST /api/v1/imports/people` | MUST HAVE MVP | `TC-IMP-001` | BR-02 |
| **FR-EXP-01** | §11.20 | Stream CSV export for People, Dues, Payments, and Reports. | Stream Pipeline | `GET /api/v1/exports/{entity}` | MUST HAVE MVP | `TC-EXP-001` | BR-11 |
| **FR-AUD-01** | §11.21, §12 | Immutable Financial Transaction Ledger recording user, timestamp, before/after values for all financial changes. | `FinancialTransactionLog` | `GET /api/v1/audit-logs` | MUST HAVE MVP | `TC-AUD-001` | BR-13 |

---

## 4. Acceptance Criteria Traceability (BR-01 to BR-15)

All 15 acceptance criteria from SRS Section 24 are fully mapped and covered in the MVP scope:

| AC ID | SRS Acceptance Requirement | Implementation Modules | Verification Method | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **BR-01** | Business can configure its terminology for Person and Charge. | `TenantSettingsModule`, `TerminologyContext` | E2E test changing labels from "Person/Charge" to "Patient/Consultation". | All UI views, tables, forms, and receipt line-items render configured labels with zero schema errors. |
| **BR-02** | Business can add and search people. | `PeopleModule`, `SearchService` | Create 50 people; perform exact, partial, and contact searches. | Person found in $< 100\text{ ms}$; full contact details and custom fields returned. |
| **BR-03** | Business can create a one-time charge and see it as a due. | `ChargeModule`, `DueEngine` | Create one-time charge with due date; query `/api/v1/dues`. | Charge creates matching Due with status `PENDING`, balance == net payable amount. |
| **BR-04** | Business can create recurring charges and receive the expected recurring dues. | `RecurringPlanModule`, `CronScheduler` | Setup monthly recurring plan; trigger due generation engine across 3 simulated cycle boundaries. | Exactly one Due generated per cycle; zero duplicates; unique index prevents replay. |
| **BR-05** | Business can collect full and partial payments. | `PaymentModule`, `LedgerService` | Pay ₹2,000 on ₹5,000 due $\rightarrow$ verify Partial; pay remaining ₹3,000 $\rightarrow$ verify Paid. | Due status transitions correctly; remaining balance matches exact integer arithmetic. |
| **BR-06** | Business can accept and track advance payments. | `AdvanceWalletModule`, `LedgerService` | Record ₹5,000 advance; verify wallet; manually apply ₹2,000 to due; verify remaining advance ₹3,000. | Advance balance maintained without leakage; manual application workflow functions cleanly. |
| **BR-07** | Business can apply one payment to multiple charges. | `PaymentAllocationModule` | Collect ₹2,500 against Due A (₹500) and Due B (₹2,000) in single request. | Single payment record; two allocation line items; both dues settled atomically. |
| **BR-08** | Business can issue/retrieve a receipt after payment. | `ReceiptModule`, `PDFService` | Complete payment $\rightarrow$ inspect receipt record $\rightarrow$ generate printable HTML/PDF. | Receipt has immutable unique sequential number; includes frozen snapshot of covered dues. |
| **BR-09** | Business can process an authorized refund with a reason. | `RefundModule`, `LedgerService` | Process ₹1,000 refund on Due allocation; verify Due re-opened to OVERDUE/PARTIAL. | Refund recorded with mandatory reason; net collection updated; Due balance restored. |
| **BR-10** | Business can identify outstanding and overdue amounts. | `DueTrackingModule`, `DashboardService` | Create dues with past and future dates; query dashboard metrics and reports. | Overdue amounts accurately isolate balances where `due_date < current_date`. |
| **BR-11** | Business can view collection and payment reports. | `ReportingModule` | Query collections across date ranges; filter by payment mode; export to CSV. | Aggregates match sum of payments exactly; CSV downloads match query results. |
| **BR-12** | Business can use custom fields for industry-specific information. | `CustomFieldsModule` | Configure custom field "Flat Number" (Text); populate on Person. | Custom fields persist, validate schema, render dynamically, and export cleanly. |
| **BR-13** | Financial actions remain traceable in transaction history. | `AuditModule`, `LedgerService` | Inspect person statement and system audit logs after charges, payments, refunds. | Non-repudiable log with user ID, timestamp, before/after values, and zero data deletions. |
| **BR-14** | Users only perform actions allowed by their role. | `RBACGuard`, `AuthModule` | Authenticate as Viewer, Collector, Admin; attempt unauthorized mutations. | Viewer blocked (403) from payment/refund; Collector blocked from settings/deletions. |
| **BR-15** | One organization's information cannot appear in another organization's account. | `TenantIsolationEngine`, `RLS` | Create Tenant A and Tenant B; query Tenant A data with Tenant B token. | Zero cross-tenant leakage (0 rows returned); PostgreSQL Row-Level Security rejects query. |
