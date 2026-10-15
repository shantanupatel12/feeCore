# FeeCore Universal — Business Rules & Financial Invariants

**Document Version:** 2.0.0  
**Status:** Approved Business Rules Baseline (Post Architecture Review)  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` (Section 11, 12, 13, 24) & Architecture Review Directives  
**Author:** Senior Software Architect & Financial Systems Lead  

---

## 1. Fundamental Principles & Currency Representation

### Rule BR-CORE-001: Three-Tier Integer Minor-Unit Representation
* **Statement:** Monetary values throughout the system (Base Amount, Discount, Late Fee, Net Amount, Paid Amount, Balance Remaining, Advance Balance, Refund Amount) are represented with exact precision across three tiers:
  1. **Database Layer:** `BIGINT` storing minor currency units (e.g., paise for INR, cents for USD).
  2. **Backend Application Layer:** JavaScript / TypeScript native `bigint` primitives for exact arithmetic.
  3. **REST JSON API Layer:** Serialized strictly as **Strings** to prevent JavaScript 64-bit float precision loss during JSON serialization and client parsing.
* **API Specification Example:**
  ```json
  {
    "baseAmountMinor": "500000",
    "discountAmountMinor": "50000",
    "netAmountMinor": "450000",
    "balanceRemainingMinor": "450000"
  }
  ```
* **Conversion Formula:**
  $$\text{MinorUnits} = \text{round}(\text{MajorUnits} \times 10^{\text{DecimalDigits}})$$

### Rule BR-CORE-002: Multi-Tenancy & Referential Integrity
* Every domain entity belongs to exactly one `Tenant` via a foreign key `tenant_id`.
* **Zero Hard Deletions:** Operational and financial records (Charges, Dues, Payments, Receipts, Allocations, Refunds, Financial Transaction Logs) are permanently immutable. Hard deletion (`DELETE FROM`) is physically disabled at the database level.
* Soft deactivations preserve full referential integrity and historical reporting.

### Rule BR-CORE-003: Immutable Financial Transaction Ledger
* The MVP **does NOT implement a General Ledger (GL)** or double-entry corporate accounting chart of accounts (Assets, Liabilities, Equity), as full accounting is explicitly outside the MVP scope (SRS §21).
* Instead, the system maintains an **Immutable Financial Transaction Ledger** (`financial_transaction_logs`):
  * Append-only financial event history.
  * Complete transaction traceability linking charges, dues, payments, allocations, advance credits, and refunds.
  * Non-repudiation with authenticated user attribution and UTC timestamps.
  * System-wide reconciliation invariants ensuring zero financial drift.

---

## 2. Charge & Due Lifecycle Rules

### Rule BR-CHG-001: Charge Creation Invariants
* A `Charge` represents an economic obligation assessed against a `Person`.
* Required attributes: `base_amount > 0`, non-empty `category`, and valid ISO-8601 `due_date`.
* Creating a Charge immediately generates a corresponding `Due` record representing the payable state.

### Rule BR-CHG-002: Discount Application Invariants
* A `Discount` reduces the gross obligation of a Charge before late fees.
* Discounts can be specified as:
  1. **Fixed Amount:** $\text{DiscountAmount} = D_{\text{fixed}}$
  2. **Percentage:** $\text{DiscountAmount} = \text{floor}\left(\frac{\text{BaseAmount} \times P_{\text{percent}}}{100}\right)$
* **Boundary Invariants:**
  $$0 \le \text{DiscountAmount} \le \text{BaseAmount}$$
  $$\text{NetDueAmount} = \text{BaseAmount} - \text{DiscountAmount} \ge 0$$
* A discount cannot be increased retroactively if the new discount would cause `NetDueAmount` to fall below the amount already collected on the Due.

### Rule BR-CHG-003: Late Fee Computation & Separation
* A `LateFee` is assessed when payment is delinquent:
  $$\text{CurrentDate} > \text{DueDate} \quad \text{AND} \quad \text{BalanceRemaining} > 0$$
* Supported Calculation Types: Fixed penalty, Per-Period penalty, or Daily penalty.
* **Separation Invariant:** Late fee amounts must be recorded in an isolated column/field from the base charge. They must never be merged indistinguishably into the principal charge amount.
* **Waiver Rule:** Only an `Owner / Admin` may waive or adjust a late fee, requiring an explicit audit log entry with justification.

### Rule BR-DUE-001: Net Due & Balance Remaining Formulas
* The net payable amount for a Due is defined as:
  $$\text{NetDueAmount} = \text{BaseAmount} - \text{DiscountAmount} + \text{LateFeeAmount}$$
* The active balance remaining for a Due is defined as:
  $$\text{BalanceRemaining} = \text{NetDueAmount} - \sum \text{AllocatedPayments} + \sum \text{AllocatedRefunds}$$
* **Invariant:**
  $$0 \le \text{BalanceRemaining} \le \text{NetDueAmount}$$

### Rule BR-DUE-002: Due Status State Transition Rules
The status of a Due is strictly governed by its financial balance and calendar due date:

$$\text{DueStatus} = \begin{cases}
\text{VOIDED}, & \text{if explicitly cancelled by Admin with zero payments} \\
\text{PAID}, & \text{if } \text{BalanceRemaining} = 0 \text{ and } \text{AllocatedPayments} > 0 \\
\text{OVERDUE}, & \text{if } \text{BalanceRemaining} > 0 \text{ and } \text{CurrentDate} > \text{DueDate} \\
\text{PARTIALLY\_PAID}, & \text{if } 0 < \text{BalanceRemaining} < \text{NetDueAmount} \text{ and } \text{CurrentDate} \le \text{DueDate} \\
\text{PENDING}, & \text{if } \text{BalanceRemaining} = \text{NetDueAmount} \text{ and } \text{CurrentDate} \le \text{DueDate}
\end{cases}$$

---

## 3. Recurring Charges & Dues Generation Engine

### Rule BR-REC-001: Supported Frequencies
* Recurring schedules support: `DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY`.

### Rule BR-REC-002: Month-End Anchor Date Preservation
* Monthly plans store an `anchor_day` (1–31).
* When generating dues for shorter months (e.g., February with 28/29 days, April with 30 days), the generation engine clamps the due date to the last valid day of that month without mutating the persistent `anchor_day` on the plan.
* Example: A plan anchored on day 31 generates on Jan 31, Feb 28 (or Feb 29 in leap year), Mar 31, and Apr 30.

### Rule BR-REC-003: Due Generation Idempotency & Duplicate Prevention
* Every generated Due has a deterministic **Cycle Period Key**:
  * Monthly: `YYYY-MM` (e.g., `2026-10`)
  * Weekly: `YYYY-Www` (e.g., `2026-W42`)
  * Yearly: `YYYY` (e.g., `2026`)
* **Database Constraint:** A unique compound index on `(tenant_id, recurring_plan_id, cycle_period_key)` physically prevents duplicate dues even in high-concurrency worker executions.

### Rule BR-REC-004: Recurring Plans for Deactivated People
* If a Person is deactivated (`status = INACTIVE`), all active recurring plans associated with that Person are automatically suspended (`status = PAUSED`).
* The dues generation scheduler automatically excludes inactive people from billing cycles.

---

## 4. Payment Collection, Allocations & Late Fee Priority

### Rule BR-PAY-001: Payment Allocation Atomicity
* A `Payment` represents legal tender received from a Person via a recognized payment mode (`CASH`, `UPI`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER`).
* Every payment transaction must be allocated completely:
  $$\text{PaymentAmount} = \sum_{i=1}^{n} \text{AllocationAmount}_i + \text{CreditedToAdvance}$$
* An allocation to a Due cannot exceed the remaining balance of that Due:
  $$\forall i: 0 < \text{AllocationAmount}_i \le \text{BalanceRemaining}(\text{Due}_i)$$

### Rule BR-PAY-002: Late Fee Settlement Priority — Principal First
* When collecting payment against a delinquent Due that has accrued a late fee penalty:
  * **Rule:** **LATE FEE PRIORITY = PRINCIPAL FIRST**.
  * Funds are allocated to the unpaid principal balance first. Only after the principal balance is completely settled do remaining payment funds apply toward the late fee penalty.
* **Concrete Example:**
  * Base Principal: ₹5,000
  * Late Fee Penalty: ₹500
  * Total Payable: ₹5,500
  * Payment Collected: ₹3,000
  * **Allocation Applied:**
    * Principal Allocation: ₹3,000
    * Late Fee Allocation: ₹0
  * **Remaining State:**
    * Unpaid Principal Balance: ₹2,000
    * Unpaid Late Fee Balance: ₹500
    * Total Balance Remaining: ₹2,500
    * Status: `OVERDUE` (due date has elapsed)
* Both `allocated_principal` and `allocated_late_fee` are stored explicitly in `payment_allocations` and displayed itemized on the receipt and transaction history.

### Rule BR-PAY-003: Multiple-Charge Payment Settlement
* A single Payment may settle multiple Dues for the same Person.
* Each settled Due receives an individual `PaymentAllocation` record linking the `Payment` to the `Due`.
* The operation is wrapped in an atomic database transaction with pessimistic row-locking (`SELECT ... FOR UPDATE`) on target dues.

---

## 5. Advance Payment Wallet & Manual Workflow

### Rule BR-ADV-001: Advance Payment Collection
* When funds are collected from a Person without selecting specific Dues, or when the payment amount exceeds the total selected dues:
  1. The unallocated portion is credited directly to the Person's `advance_balance`.
  2. A `financial_transaction_logs` entry of type `ADVANCE_RECEIVED` is committed.
* **Advance Balance Invariant:**
  $$\text{AdvanceBalance} = \sum \text{AdvanceReceived} - \sum \text{AdvanceAppliedToDues} - \sum \text{AdvanceRefunded} \ge 0$$

### Rule BR-ADV-002: Manual Advance Application Workflow (MVP Rule)
* For the MVP, **ADVANCE AUTO-APPLICATION = DISABLED BY DEFAULT**.
* Dues generated by one-time charges or recurring schedules do NOT automatically consume advance funds.
* **Operational Flow:**
  $$\text{Payment Received without Due} \longrightarrow \text{Advance Wallet}$$
  $$\text{Dues Generated independently} \longrightarrow \text{Due marked PENDING / OVERDUE}$$
  $$\text{Collector explicitly reviews account and clicks "Apply Advance"} \longrightarrow \text{Due Settlement}$$
* Upon manual application:
  1. An allocation record of type `ADVANCE_ALLOCATION` is generated.
  2. `person.advance_balance` is debited by $\text{AllocationAmount}$.
  3. `due.balance_remaining` is debited by $\text{AllocationAmount}$.
  4. An entry of type `ADVANCE_APPLIED` is recorded in the transaction ledger.

---

## 6. Refunds Architecture — Segregated Flows

Refunds in FeeCore Universal are strictly divided into two distinct financial operations:

### Flow A: Refund of Payment Allocation Against a Due
* **Purpose:** Returning funds collected for a specific business obligation (e.g., student dropped a course, patient cancelled a procedure).
* **Eligibility & Ceilings:**
  * Must reference an existing `payment_allocation_id`.
  * Cannot exceed the previously allocated amount minus prior refunds on that allocation:
    $$\text{RefundAmount} \le \text{payment\_allocation.total\_allocated} - \text{payment\_allocation.refunded\_amount}$$
* **Operational Flow:**
  1. Cashier/Admin submits refund request with mandatory `refund_reason` and mode.
  2. The target `payment_allocations.refunded_amount` is incremented.
  3. The associated Due's `balance_remaining` is restored:
     $$\text{BalanceRemaining}_{\text{new}} = \text{BalanceRemaining}_{\text{old}} + \text{RefundAmount}$$
  4. Due status regresses:
     * If $\text{CurrentDate} > \text{DueDate}$: transitions to `OVERDUE`.
     * If $\text{CurrentDate} \le \text{DueDate}$: transitions to `PARTIALLY_PAID` or `PENDING`.
  5. An entry of type `DUE_ALLOCATION_REFUND` is written to `financial_transaction_logs`.

### Flow B: Refund of Unallocated Advance Wallet Balance
* **Purpose:** Returning deposited credit that was never allocated to any Due (e.g., customer moving away or requesting their deposit back).
* **Eligibility & Ceilings:**
  * Must reference a Person with an active `advance_balance`.
  * Cannot exceed the available advance balance:
    $$\text{RefundAmount} \le \text{person.advance\_balance}$$
* **Operational Flow:**
  1. Cashier/Admin submits advance refund request with mandatory `refund_reason` and mode.
  2. Person's `advance_balance` is directly decremented:
     $$\text{AdvanceBalance}_{\text{new}} = \text{AdvanceBalance}_{\text{old}} - \text{RefundAmount}$$
  3. **No Due records are touched or modified.**
  4. An entry of type `ADVANCE_WALLET_REFUND` is written to `financial_transaction_logs`.

---

## 7. Receipts — Transaction Safety & Immutability

### Rule BR-RCP-001: Transaction-Safe Receipt Numbering
* Receipt numbers are sequential, tenant-scoped, and gapless:
  $$\text{ReceiptNumber} = \text{Prefix} + \text{"-"} + \text{FiscalYear} + \text{"-"} + \text{LPAD}(\text{SequenceNumber}, 6, \text{'0'})$$
  Example: `REC-2026-000142`.
* **Atomic In-Transaction Allocation:**
  The sequence counter is incremented inside the **exact same database transaction** that confirms the payment and inserts the receipt:
  ```sql
  UPDATE receipt_sequences
  SET current_sequence = current_sequence + 1
  WHERE tenant_id = :tenant_id AND fiscal_year = :fiscal_year
  RETURNING current_sequence;
  ```
* **Rollback Safety Invariant:** If the payment transaction fails or aborts for any reason, the counter update is rolled back automatically with the transaction. A failed payment never consumes or wastes a receipt number.

### Rule BR-RCP-002: Frozen Receipt Snapshot & Deterministic Rendering
* A Receipt is an immutable legal document. Its contents must never change, even if the tenant's profile, name, address, tax ID, or the person's name or contact details are edited in the future.
* **Creation Invariant:** At the moment of payment confirmation, the system creates a frozen JSON snapshot (`snapshot_data JSONB`) storing:
  1. **Payer Snapshot:** Full name, phone, email, address, custom field values.
  2. **Payment Snapshot:** Total amount minor (as string), payment mode, reference number, cashier user ID, payment timestamp.
  3. **Allocation Breakdown:** Itemized list of charges covered (category, description, allocated principal, allocated late fee).
  4. **Organization Snapshot:** Tenant legal name, address, tax ID, currency, logo URL, receipt prefix and footer text.
  5. **Receipt Template Version:** Immutable schema/template version tag (e.g., `"v1.0"`).
* **Reprint Invariant:** Downloading, viewing, or printing a receipt always renders deterministically from the `snapshot_data JSONB`. Historical receipts never re-fetch live entity tables or modern templates.

---

## 8. Master Reconciliation Invariant

### Rule BR-REC-001: Global Financial Invariant
At any point in time $T$, for any Tenant, the total business charges created minus total discounts granted plus total assessed late fees minus net payments collected (payments minus refunds) must exactly equal total outstanding balances on dues plus remaining unallocated advance wallet balances:

$$\sum \text{BaseAmount} - \sum \text{DiscountAmount} + \sum \text{LateFeeAmount} - \left(\sum \text{PaymentsReceived} - \sum \text{RefundsIssued}\right) = \text{TotalOutstandingDues} - \text{TotalAdvanceBalances}$$

*This equation is enforced by automated property-based test suites. Any discrepancy indicates financial corruption and immediately fails CI/CD gates.*
