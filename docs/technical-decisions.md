# FeeCore Universal — Technical Architecture Decisions (ADR)

**Document Version:** 2.0.0  
**Status:** Approved Architecture Baseline (Post Architecture Review)  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` & Architecture Review Directives  
**Author:** Senior Software Architect & Security Lead  

---

## 1. Architectural Decision Records (ADR) Index

| ADR ID | Decision Title | Status | Primary Impact |
| :--- | :--- | :--- | :--- |
| **ADR-001** | System Topology: Modular Monolith Architecture | ACCEPTED | Scalability, operational simplicity, development velocity |
| **ADR-002** | Technology Stack: NestJS + Fastify + PostgreSQL + Prisma + React + Vite | ACCEPTED | Final unified technology stack across all tiers |
| **ADR-003** | Currency & Financial Arithmetic: Minor Units (String in API, BigInt in DB & Backend) | REVISED | Complete elimination of floating-point inaccuracies and JSON serialization precision loss |
| **ADR-004** | Multi-Tenancy Model: Row-Level Security (RLS) Discriminator | ACCEPTED | Strict tenant isolation at database engine level |
| **ADR-005** | Financial History: Immutable Financial Transaction Ledger | REVISED | Append-only financial traceability without general accounting/GL complexity |
| **ADR-006** | Concurrency Control: Pessimistic Row Locking & Idempotency Keys | ACCEPTED | Prevents race conditions, double payments, duplicate dues |
| **ADR-007** | Custom Fields Architecture: Schema-Validated JSONB with GIN Indexes | ACCEPTED | Dynamic schemas without schema migration overhead |
| **ADR-008** | Terminology Customization: Client/Server Dictionary Abstraction | ACCEPTED | Industry-neutral core without schema churn |
| **ADR-009** | Receipt Numbering: In-Transaction Atomic Sequences with Rollback Safety | REVISED | Gapless, collision-free numbering safe against rollbacks |
| **ADR-010** | Receipt Immutability: Frozen Snapshot with Deterministic Rendering | REVISED | 100% reproducible historical receipts independent of template changes |
| **ADR-011** | Advance Payment: Manual Application Workflow by Default | REVISED | Advance funds held in wallet until explicit collector action |
| **ADR-012** | Late Fee Settlement Priority: Principal First | REVISED | Partial payments apply to principal obligation before late fees |
| **ADR-013** | Refund Segmentation: Distinct Due Allocation vs. Advance Wallet Flows | REVISED | Explicit segregation of receivable adjustments vs. credit returns |
| **ADR-014** | Notification Architecture: Internal Domain Events & Outbox Interface Only | REVISED | Zero third-party notification dependencies in MVP |
| **ADR-015** | Dashboard Analytics: PostgreSQL-Backed Indexed Aggregations | REVISED | High-performance SQL aggregates without streaming/OLAP overhead |

---

## 2. Detailed Architectural Decisions

### ADR-001: System Topology — Modular Monolith Architecture
* **Context:** The product requires strict transactional integrity across payments, allocations, receipts, and dues. Microservices introduce distributed transaction overhead (Sagas/2PC) and eventual consistency risks that are dangerous for financial collection.
* **Decision:** We adopt a **Modular Monolith** architecture with clean domain boundaries.
* **Justification:**
  * Allows ACID transactions across dues, allocations, and receipts within PostgreSQL.
  * Modules communicate via well-defined domain service interfaces and in-memory events.
  * Single deployable unit eliminates distributed networking failures while remaining structured for extraction into services post-MVP if needed.

---

### ADR-002: Definitive Technology Stack
* **Context:** A definitive, unified technology stack must be selected without leaving unresolved framework alternatives.
* **Decision:**
  * **Frontend:** React 18+ with TypeScript and Vite.
  * **Backend Framework:** NestJS with TypeScript.
  * **HTTP Adapter:** Fastify (`@nestjs/platform-fastify`).
  * **Database:** PostgreSQL 16+.
  * **ORM / Data Access:** Prisma ORM.
  * **Validation Engine:** Zod.
* **Justification:**
  * **NestJS + Fastify:** Combines enterprise modular architecture and dependency injection with Fastify's high throughput (2x faster than Express) and low overhead.
  * **PostgreSQL + Prisma:** Full ACID support, relational integrity, native JSONB support, and strongly typed schema models via Prisma with raw SQL escape hatches for Row-Level Security session context.
  * **React + Vite:** Instant HMR, lightweight SPA bundle, optimal composition for dynamic terminology injection and form rendering.
  * **Zod:** Unified schema validation across API request validation pipes and runtime JSON data checks.

---

### ADR-003: Currency & Financial Arithmetic — Three-Tier Representation
* **Context:** Standard JavaScript `Number` is an IEEE-754 double-precision float. Storing or transmitting floats causes rounding errors. Furthermore, parsing 64-bit integers in JSON via standard `JSON.parse()` causes precision loss for values exceeding $2^{53} - 1$ (9,007,199,254,740,991).
* **Decision:**
  1. **Database:** `BIGINT` representing minor currency units (paise/cents).
  2. **Backend Application:** JavaScript/TypeScript native `bigint`.
  3. **JSON REST API:** Monetary minor units are **serialized and transmitted strictly as Strings** (e.g., `{"amountMinor": "150050"}`).
* **Justification:** Eliminates all floating-point rounding issues and prevents client-side JSON deserializer truncation.
* **Formatting Rule:** Human-friendly display formatting (`₹1,500.50`) is exclusively a UI presentation concern using tenant currency and locale tokens.

---

### ADR-004: Multi-Tenancy Architecture — PostgreSQL Row-Level Security (RLS)
* **Context:** Multi-tenant SaaS requires complete data isolation. One tenant's data must never leak to another (SRS §24 BR-15).
* **Decision:** Shared Database, Shared Schema with non-nullable `tenant_id UUID` on all domain tables, enforced by **PostgreSQL Row-Level Security (RLS)**.
* **Implementation:**
  * Every tenant request runs inside a Prisma/PostgreSQL interactive transaction where the connection session is initialized:
    ```sql
    SET LOCAL app.current_tenant_id = 'tenant-uuid-here';
    ```
  * RLS policies reject any query accessing rows outside `app.current_tenant_id`.
  * Application-layer queries also mandate `where: { tenantId }` as defense-in-depth.

---

### ADR-005: Financial Integrity — Immutable Financial Transaction Ledger
* **Context:** SRS §11.21 mandates traceability without deleted or overwritten records. However, building a general accounting / General Ledger (GL) product with charts of accounts, double-entry ledgers, and trial balances is explicitly outside the MVP scope.
* **Decision:** Implement an **Immutable Financial Transaction Ledger** (`financial_transaction_logs`).
* **Capabilities:**
  * Append-only financial history.
  * Complete transaction traceability (links to due, payment, allocation, refund, collector).
  * Comprehensive payment/allocation/refund history.
  * Non-repudiation and auditability.
  * Reconciliation invariants verifying that charges - discounts + late fees - net collections = outstanding dues - advance balances.
* **Exclusion:** No General Ledger, no journal entries, no debits/credits to corporate asset/equity accounts.

---

### ADR-006: Concurrency Control — Pessimistic Row Locking
* **Context:** Simultaneous payments against the same due or race conditions during multi-due allocation can cause over-allocation.
* **Decision:** Use **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)** inside Prisma interactive transactions when updating Dues, People advance balances, and Receipt sequences.
* **Idempotency:** All payment and refund endpoints require an `X-Idempotency-Key` header stored in `payments.idempotency_key` with a unique constraint.

---

### ADR-007: Custom Fields Architecture — Schema-Validated JSONB
* **Context:** Businesses require dynamic attributes (Class, Section, Flat Number, Patient ID) without altering SQL tables.
* **Decision:** Store custom field definitions in `custom_field_definitions` and store validated entity values in a `custom_data JSONB` column on `people`, backed by PostgreSQL GIN indexes.

---

### ADR-008: Terminology Customization Engine
* **Context:** Universal concepts (Person, Charge, Due, Payment, Receipt) must display industry-native terms (Student/Fee, Patient/Consultation) without modifying database schemas.
* **Decision:** A dynamic terminology dictionary loaded into the React SPA via `TerminologyContext`. The backend maintains universal terms in all code, tables, and APIs, while returning tenant terminology settings for the UI to render.

---

### ADR-009: Transaction-Safe Receipt Numbering with Rollback Safety
* **Context:** Receipt numbers must be sequential, tenant-scoped, and gapless. If a payment transaction fails or aborts, the sequence number must NOT be consumed or lost.
* **Decision:** Atomic in-transaction sequence increment on a tenant counter table (`receipt_sequences`) executed **within the same database transaction** that creates the payment and receipt:
  ```sql
  -- Executed inside BEGIN ... COMMIT of payment collection
  UPDATE receipt_sequences
  SET current_sequence = current_sequence + 1
  WHERE tenant_id = :tenant_id AND fiscal_year = :fiscal_year
  RETURNING current_sequence;
  ```
* **Rollback Safety:** Because sequence increments happen inside the active transaction (unlike PostgreSQL `nextval('seq')` which does not rollback), an aborted payment rolls back the counter increment atomically. Zero gaps are created on failures.

---

### ADR-010: Receipt Immutability via Frozen Snapshot
* **Context:** Historical receipts must never change if tenant settings, business names, addresses, or person details change in the future. Relying on re-rendering from updated templates breaks legal non-repudiation.
* **Decision:** At receipt creation time, generate a **Frozen Receipt Snapshot** stored as immutable `snapshot_data JSONB` containing:
  * Payer snapshot (name, phone, email, custom fields).
  * Payment snapshot (amount minor, mode, reference, payment date, collector).
  * Allocation line items (charge name, category, allocated principal, allocated late fee).
  * Organization identity snapshot (legal name, address, tax ID, currency, logo URL, receipt prefix).
  * Receipt template version (e.g., `v1.0`).
* **Artifact Strategy:** PDF and print representations are rendered deterministically from this frozen JSON snapshot. The snapshot is immutable.

---

### ADR-011: Advance Payment — Manual Application Workflow
* **Context:** When a person has advance funds, should incoming dues be settled automatically or manually?
* **Decision:** For the MVP, **ADVANCE AUTO-APPLICATION = DISABLED BY DEFAULT**.
* **Workflow:**
  1. Payment received without due selection $\rightarrow$ Credited to Person's `advance_balance`.
  2. Dues generated independently via one-time charge or recurring engine.
  3. Front-desk staff/Collector explicitly reviews the account and clicks **"Apply Advance"**.
  4. System allocates advance balance to selected Due(s) and records an immutable allocation entry.

---

### ADR-012: Late Fee Settlement Priority — Principal First
* **Context:** When a due has accrued a late fee and receives a partial payment, how are funds applied?
* **Decision:** For the MVP, **LATE FEE PRIORITY = PRINCIPAL FIRST**.
* **Rule & Example:**
  * Principal: ₹5,000 | Late Fee: ₹500 | Payment: ₹3,000.
  * Allocation: ₹3,000 applied to Principal.
  * Remaining: Principal ₹2,000 | Late Fee ₹500.
  * Both principal and late fee allocation portions are stored explicitly in `payment_allocations`.

---

### ADR-013: Refund Architecture — Distinct Due vs. Advance Flows
* **Context:** Reversing a collected payment against a Due has different financial and operational implications than refunding an unallocated advance credit balance.
* **Decision:** Explicitly separate two distinct refund flows:
  * **Flow A: Due Allocation Refund:** Reverses allocations applied to specific Dues. Reduces collected revenue, restores `due.balance_remaining`, and re-opens the Due to `OVERDUE` or `PARTIALLY_PAID`.
  * **Flow B: Advance Wallet Refund:** Directly decrements `person.advance_balance` and records an advance return without touching any Due records.

---

### ADR-014: Notification Architecture — Internal Events & Outbox Only
* **Context:** External notification channels (WhatsApp, SMS, Email) introduce vendor dependencies, API costs, and network failure modes outside MVP scope.
* **Decision:** Define an internal domain event bus and a `notification_outbox` table. External provider integrations (Twilio, SendGrid, Meta WhatsApp) are strictly deferred to Phase 1.5. In MVP, outbox records are logged internally without outbound HTTP calls.

---

### ADR-015: Dashboard Architecture — PostgreSQL Indexed Aggregates
* **Context:** Real-time KPI cards (Today's Collection, Today's Due, Total Outstanding, Overdue Amount) do not require Kafka, Redis streams, or separate OLAP databases at MVP scale.
* **Decision:** Dashboard queries execute directly against PostgreSQL utilizing targeted indexes on `(tenant_id, payment_date)`, `(tenant_id, status, due_date)`, and `(tenant_id, balance_remaining)`.
