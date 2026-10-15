# FeeCore Universal — Architecture Review & Decision Record

**Document Version:** 1.0.0  
**Status:** Approved Architectural Baseline  
**Date:** 24 September 2026  
**Roles:** Senior Software Architect, Product Engineer, QA Lead, Security Engineer, Technical PM  

---

## 1. Executive Summary

This Architecture Review document formalizes the final architectural decisions, modifications, and structural boundaries agreed upon prior to Phase 0 implementation. It serves as the authoritative governing baseline for FeeCore Universal, aligning technical design with product vision and business-level software requirements (`docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx`).

---

## 2. Decisions Accepted

The following fundamental architectural patterns were reviewed and accepted without modification:

1. **Universal Business Concepts:** The universal core model strictly uses **Person**, **Charge**, **Due**, **Payment**, **Receipt**, and **Transaction History**. Industry-specific concepts (Student/Fee, Patient/Consultation, Resident/Maintenance) are handled exclusively via runtime dynamic presentation-layer terminology dictionaries ([ADR-008](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/technical-decisions.md)) and never modify database schemas.
2. **Modular Monolith Topology:** Clean Hexagonal / Ports-and-Adapters boundaries within a single deployable service ([ADR-001](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/technical-decisions.md)), providing ACID transaction guarantees for multi-due settlements without distributed consensus overhead.
3. **PostgreSQL Multi-Tenancy with Row-Level Security (RLS):** Shared database and shared schema with mandatory non-nullable `tenant_id` columns, enforced at the database engine level via PostgreSQL RLS policies ([ADR-004](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/technical-decisions.md)).
4. **Pessimistic Concurrency Control:** Row-level locks (`SELECT ... FOR UPDATE`) and unique idempotency keys ([ADR-006](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/technical-decisions.md)) to prevent race conditions during payment collections, allocations, and wallet settlements.
5. **Schema-Validated Custom Fields:** JSONB document storage on `people` validated dynamically by tenant-specific schemas stored in `custom_field_definitions` ([ADR-007](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/technical-decisions.md)).
6. **Zero Hard Deletions:** Operational and financial records are permanently preserved. Soft deactivation preserves full historical reporting and statement views ([BR-PER-001](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/docs/business-rules.md)).

---

## 3. Decisions Changed / Revised

Based on the mandatory architecture review directives, the following decisions were modified or clarified:

| Area | Initial Proposal | Approved Decision (Revised) | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Financial Ledger** | Double-Entry Corporate Accounting Ledger (Debits/Credits to Asset/Liability accounts) | **Immutable Financial Transaction Ledger** (`financial_transaction_logs`) | General Ledger (GL), Chart of Accounts, and trial balances are explicitly outside MVP scope (SRS §21). The ledger provides append-only history, traceability, auditability, and reconciliation without full corporate accounting complexity. |
| **Receipt Numbering** | Database sequence counter (`nextval`) | **In-Transaction Atomic Counter on `receipt_sequences`** | Standard Postgres sequences do not rollback when a transaction aborts. Incrementing a tenant counter inside the payment transaction guarantees gapless, strictly monotonic sequence numbering that automatically rolls back on payment failure. |
| **Receipt Immutability** | Re-rendering receipt from stored references and current template | **Frozen Snapshot (`snapshot_data JSONB`) & Deterministic Rendering** | Historical receipts must never change even if tenant profiles, tax IDs, or person details change in the future. Receipts capture frozen snapshots at issuance; reprint renders deterministically from the snapshot. |
| **Money Representation** | BigInt minor units in DB/Backend; unspecified in JSON | **Three-Tier Representation: Strings in JSON API** | To prevent JavaScript 64-bit IEEE-754 floating-point truncation during JSON serialization/deserialization, minor units are transmitted as Strings in APIs (`"150050"`), mapped to `bigint` in TypeScript, and stored as `BIGINT` in PostgreSQL. |
| **Technology Choices** | Alternatives presented (NestJS vs FastAPI; Prisma vs Drizzle) | **Definitive Single Stack:** NestJS + Fastify + PostgreSQL + Prisma + React + Vite + Zod | Removes architectural indecision and standardizes the toolchain across the entire development team. |
| **Advance Payment** | Auto-apply advance vs manual workflow | **Advance Auto-Application = DISABLED BY DEFAULT** | Funds received without due selection remain in the advance wallet until a collector explicitly reviews the account and applies advance credit to selected dues. |
| **Late Fee Priority** | Priority configurable (Principal first vs Late fee first) | **Late Fee Priority = PRINCIPAL FIRST** | Partial payments apply to unpaid principal before late fee penalties. Explicitly itemized on allocations and receipts. |
| **Refunds** | Unified refund endpoint | **Segregated Flows:** Flow A (Due Allocation Refund) vs Flow B (Advance Wallet Refund) | Flow A reverses receivable allocations and re-opens Dues to `OVERDUE` or `PARTIALLY_PAID`. Flow B decrements credit wallet balances without touching any Due records. |
| **Notifications** | Integration with external messaging services | **Internal Domain Events & Outbox Interface Only** | Third-party providers (WhatsApp, SMS, Email) are deferred to Phase 1.5. MVP business logic remains strictly provider-agnostic. |
| **Dashboard** | Generic aggregation service | **PostgreSQL-Backed Indexed Aggregates** | Eliminates premature introduction of Kafka, Redis streams, or separate OLAP databases. PostgreSQL indexed queries handle dashboard metrics in $< 50\text{ ms}$. |

---

## 4. Remaining Open Questions

All primary architectural and financial ambiguities have been formally resolved. The following minor operational parameters will be finalized during Phase 1 Tenant Configuration:

1. **Receipt Sequence Reset Policy:** Should receipt sequences reset annually at the start of the calendar year (Jan 1) or the local fiscal year (e.g., April 1 for India)? *(Handled via tenant-configurable fiscal year token `YYYY` or `YYYY-YY`).*
2. **Cheque Clearance Lifecycle:** In MVP, payments recorded with mode `CHEQUE` are immediately confirmed as `SUCCESSFUL` by cashier assertion. If an organization requires a multi-step `CLEARING` state, this can be introduced as a tenant workflow setting post-MVP.

---

## 5. Explicit MVP Boundary

To maintain tight project governance, every proposed capability is assigned to a strict boundary:

### 5.1 MUST HAVE MVP (Core Release)
* Tenant profile setup, branding, and dynamic terminology customization engine.
* Role-Based Access Control: Admin, Collector, Viewer.
* People directory with fast indexed search and soft-deactivation.
* Dynamic custom fields (Text, Number, Date, Select, Boolean) with Zod validation.
* One-time charge creation and due generation.
* Recurring charge schedules with anchor-day month-end preservation and idempotent cycle keys.
* Real-time due tracking (`PENDING`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`).
* Payment collection supporting Cash, UPI, Bank Transfer, Card, Cheque, Other.
* Atomic multi-due payment settlement with Principal-First late fee allocation.
* Advance payment wallet with manual application workflow.
* Transaction-safe receipt numbering with gapless rollback guarantees.
* Frozen receipt snapshots with deterministic HTML/PDF rendering.
* Segregated refunds (Flow A: Due allocation reversal; Flow B: Advance wallet return).
* Immutable Financial Transaction Ledger (`financial_transaction_logs`).
* Real-time Dashboard KPIs powered by PostgreSQL indexed queries.
* Operational reports (Collections, Dues, Overdue, Payments) and CSV streaming import/export.
* Non-repudiation audit logging for all mutating operations.
* Responsive modern web UI (Desktop & Mobile browsers) built with Vanilla CSS design tokens.

### 5.2 PHASE 1.5 (Post-Core Enhancements)
* WhatsApp reminder dispatching (Twilio / Meta API).
* SMS reminder gateway integration.
* Automated outbound email notifications.
* Hosted online payment links.
* Payment gateway integrations (Razorpay, Stripe).
* Customer / Payer self-service payment portal.
* Dynamic QR code generation for counter collections.
* Multi-branch / multi-campus organizational hierarchy.

### 5.3 EXPLICITLY OUT OF SCOPE (Do Not Implement)
* Full accounting / General Ledger (GL) / Chart of Accounts / Trial Balances.
* Payroll and staff HR management.
* Inventory, assets, and warehousing.
* CRM / Lead pipeline management.
* School ERP features (Exams, Grading, Attendance, Library, Timetables).
* Healthcare / Clinical features (EMR, Electronic Prescriptions, Lab orders).
* Biometric scanners and facial recognition hardware integrations.
* Advanced automated GST filing / tax engine integrations.
* AI chatbots, copilots, or automated decisioning agents.
* Native mobile applications (iOS / Android binaries).
* Direct bank feed transaction auto-reconciliation.

---

## 6. Final Technology Stack

```
Frontend:
  - Framework: React 18+
  - Language: TypeScript 5.x
  - Bundler: Vite
  - Styling: Modern Vanilla CSS (CSS Custom Properties, Zero CSS-in-JS overhead)
  - HTTP Client: Native Fetch / Axios

Backend:
  - Framework: NestJS 10+
  - Language: TypeScript 5.x
  - HTTP Adapter: Fastify (@nestjs/platform-fastify)
  - Database: PostgreSQL 16+
  - ORM: Prisma ORM
  - Validation: Zod schemas
  - Hashing: Argon2id
  - Tokens: JSON Web Tokens (stateless access tokens + rotating refresh tokens)

Testing:
  - Unit: Vitest
  - Integration: Supertest + Testcontainers (real Dockerized PostgreSQL)
```

---

## 7. Final Financial Integrity Rules

1. **Exact Minor-Unit Arithmetic:** All monetary fields stored as `BIGINT` minor currency units in PostgreSQL, manipulated as `bigint` in TypeScript, and transmitted as `string` in JSON REST APIs (`amountMinor: "150050"`).
2. **Net Due Formula:**
   $$\text{NetDueAmount} = \text{BaseAmount} - \text{DiscountAmount} + \text{LateFeeAmount}$$
3. **Balance Remaining Formula:**
   $$\text{BalanceRemaining} = \text{NetDueAmount} - \sum \text{AllocatedPrincipal} - \sum \text{AllocatedLateFee} + \sum \text{AllocatedRefunds}$$
4. **Principal-First Late Fee Priority:**
   Partial payments settle unpaid principal before late fee penalties.
5. **Advance Balance Invariant:**
   $$\text{AdvanceBalance} = \sum \text{AdvanceReceived} - \sum \text{AdvanceAppliedToDues} - \sum \text{AdvanceRefunded} \ge 0$$
6. **Master Reconciliation Equation:**
   $$\sum \text{Base} - \sum \text{Discounts} + \sum \text{LateFees} - \left(\sum \text{Payments} - \sum \text{Refunds}\right) = \text{TotalOutstandingDues} - \text{TotalAdvanceBalances}$$
   Enforced across all test suites; any variance indicates database corruption and fails CI/CD gates.
