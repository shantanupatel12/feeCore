# FeeCore Universal — Edge Cases & Financial Handling Specifications

**Document Version:** 2.0.0  
**Status:** Approved Edge Cases Baseline (Post Architecture Review)  
**Source Baseline:** `docs/FeeCore_Universal_Business_Requirements_SRS_v2.docx` & Architecture Review Directives  
**Author:** Senior Software Architect & Lead QA Engineer  

---

## 1. Overview & Risk Mitigation Philosophy

Financial platforms frequently fail at the boundary conditions: partial allocations, concurrent transactions, race conditions on settlement, rounding residuals, and state reversals. This document specifies the exhaustive handling mechanisms for the **twelve critical edge cases** in FeeCore Universal, establishing non-negotiable operational algorithms and database-level protections.

---

## 2. Deep-Dive Edge Cases Analysis & Resolutions

### Edge Case 1: Full Payment Edge Cases
* **Scenarios & Boundary Conditions:**
  1. *Exact Match:* Customer pays exact `balance_remaining` on Due.
  2. *Concurrent Double Full Payment:* Payer initiates payment via two channels simultaneously (e.g., UPI and Cashier desk) for the same Due.
* **Failure Modes & Risks:**
  * Double payment creating negative balance remaining on Due.
  * Inconsistent receipt generation.
* **Algorithmic Resolution:**
  * The payment transaction executes under PostgreSQL pessimistic locking:
    ```sql
    SELECT id, balance_remaining, status 
    FROM dues 
    WHERE id = :due_id AND tenant_id = :tenant_id 
    FOR UPDATE;
    ```
  * In transaction 2, when the lock is released, the engine checks:
    ```typescript
    if (due.balanceRemaining === 0n) {
      // Due is already settled!
      // Spill unallocatable payment into Person's advance wallet
      person.advanceBalance += paymentAmount;
    }
    ```
  * If an overpayment or redundant payment is confirmed, the unallocatable remainder is automatically credited to the Person's `advance_balance` with an explicit audit note, guaranteeing zero money leakage.
* **State Transition:** `PENDING` or `PARTIALLY_PAID` $\rightarrow$ `PAID`.
* **Test Case:** `TC-EDGE-001` (Concurrent double full payment test with asynchronous parallel workers).

---

### Edge Case 2: Partial Payment Edge Cases & String Minor Units
* **Scenarios & Boundary Conditions:**
  1. *Micro-Payments:* Payer makes multiple minuscule partial payments (e.g., ₹10 on a ₹10,000 due).
  2. *Near-Zero Residuals:* Payer pays ₹999.99 on a ₹1,000 due, leaving ₹0.01 balance.
  3. *Payment Exceeding Due:* Payer pays ₹6,000 on a ₹5,000 due during a single-due collection workflow.
* **Failure Modes & Risks:**
  * Accumulation of rounding errors across multiple partial payments.
  * Status stuck in `PARTIALLY_PAID` indefinitely.
  * JavaScript number deserialization precision loss.
* **Algorithmic Resolution:**
  * Monetary units are transmitted as strings in JSON APIs (`amountMinor: "100000"`), mapped to `bigint` in TypeScript, and stored as `BIGINT` in PostgreSQL. No fractional currency units exist.
  * When payment amount $P > \text{BalanceRemaining}$, the engine automatically caps the allocation at $\text{BalanceRemaining}$ and transfers the delta $(P - \text{BalanceRemaining})$ directly into the Person's `advance_balance`.
  * Status updates:
    ```typescript
    const allocated = paymentAmount < due.balanceRemaining ? paymentAmount : due.balanceRemaining;
    due.balanceRemaining -= allocated;
    const excess = paymentAmount - allocated;
    if (excess > 0n) {
      person.advanceBalance += excess;
    }
    due.status = due.balanceRemaining === 0n ? DueStatus.PAID : DueStatus.PARTIALLY_PAID;
    ```
* **Test Case:** `TC-EDGE-002` (Over-allocation spillover to advance credit).

---

### Edge Case 3: Multiple-Charge Payment Edge Cases
* **Scenarios & Boundary Conditions:**
  1. *Lump-Sum Underpayment:* Payer owes Due A (₹3,000) and Due B (₹5,000), total ₹8,000, but pays a lump sum of ₹5,000.
  2. *Mixed Categories:* Multiple dues across different charge categories settled in one receipt.
* **Failure Modes & Risks:**
  * Ambiguity in how funds are distributed between Due A and Due B.
  * Partial settlement applied haphazardly without operator consent.
* **Algorithmic Resolution:**
  * **Explicit Line-Item Allocation:** The UI and API require an explicit breakdown of allocations:
    ```json
    {
      "personId": "per_123",
      "paymentMode": "UPI",
      "totalAmountMinor": "500000",
      "allocations": [
        {"dueId": "due_A", "amountMinor": "300000"},
        {"dueId": "due_B", "amountMinor": "200000"}
      ]
    }
    ```
  * **FIFO Auto-Fill Helper:** If the operator chooses "Auto-Allocate", the UI calculates allocations by **oldest due date first (FIFO)**. The operator reviews and confirms the split before submission.
  * **Atomic Validation:**
    $$\sum \text{allocations.amountMinor} + \text{creditedToAdvanceMinor} == \text{totalAmountMinor}$$
* **Test Case:** `TC-EDGE-003` (Multi-due allocation atomicity and receipt generation).

---

### Edge Case 4: Payment Allocation Invariants & Race Conditions
* **Scenarios & Boundary Conditions:**
  1. Two staff members attempt to allocate different payments to the same Due at the exact same millisecond.
  2. A payment is allocated to a Due while a late fee is being dynamically applied to that Due.
* **Failure Modes & Risks:**
  * Race condition causing allocated payments to exceed the net due.
* **Algorithmic Resolution:**
  * All allocation updates enforce strict database row locking on the `dues` table:
    ```sql
    BEGIN;
    SELECT balance_remaining FROM dues WHERE id = $1 AND tenant_id = $2 FOR UPDATE;
    -- Verify balance_remaining >= requested_allocation
    UPDATE dues SET balance_remaining = balance_remaining - $3 WHERE id = $1;
    INSERT INTO payment_allocations (payment_id, due_id, allocated_principal, allocated_late_fee, total_allocated) 
    VALUES ($4, $1, $5, $6, $3);
    COMMIT;
    ```
  * Check constraint on `dues`:
    ```sql
    ALTER TABLE dues ADD CONSTRAINT chk_dues_balance_non_negative 
    CHECK (balance_remaining >= 0);
    ```
* **Test Case:** `TC-EDGE-004` (Concurrent allocation collision and constraint enforcement).

---

### Edge Case 5: Advance Payment & Manual Wallet Workflow
* **Scenarios & Boundary Conditions:**
  1. *Collection with No Dues:* A person joins today and deposits ₹10,000 in advance before any charge is generated.
  2. *Subsequent Due Matching:* A recurring charge generates a ₹3,000 due next week.
  3. *Refunding Advance:* Payer asks for remaining unallocated advance of ₹7,000 to be returned in cash.
* **Failure Modes & Risks:**
  * Advance balance becomes disconnected from payment records.
  * Advance funds accidentally auto-applied without customer or operator confirmation.
* **Algorithmic Resolution:**
  * **MVP Rule:** `ADVANCE AUTO-APPLICATION = DISABLED BY DEFAULT`.
  * Advance is held in the Person's wallet (`person.advance_balance`) and logged in `financial_transaction_logs`.
  * Subsequent dues remain `PENDING` until a cashier explicitly opens the person's profile, clicks **"Apply Advance"**, and confirms the allocation.
  * **Advance Refund (Flow B):** Decrements `person.advance_balance` directly without touching any Due records:
    ```sql
    UPDATE people 
    SET advance_balance = advance_balance - :refund_amount 
    WHERE id = :person_id AND advance_balance >= :refund_amount;
    ```
* **Test Case:** `TC-EDGE-005` (Advance wallet deposit, manual application, and remaining credit refund).

---

### Edge Case 6: Discounts & Retroactive Adjustments
* **Scenarios & Boundary Conditions:**
  1. *Post-Payment Discount Request:* A Due for ₹5,000 had ₹3,000 paid. The customer requests a 20% discount (₹1,000).
  2. *Discount Greater Than Unpaid Balance:* Customer had ₹4,500 paid on ₹5,000 due. A ₹1,000 discount is attempted.
* **Failure Modes & Risks:**
  * Net due becomes less than already collected payments, causing negative balance remaining.
* **Algorithmic Resolution:**
  * Invariant: A discount amendment can NEVER reduce `net_due_amount` below the sum of already allocated payments:
    $$\text{MaxPermissibleDiscount} = \text{BaseAmount} - \sum \text{AllocatedPayments}$$
  * If the organization wishes to return money already paid, it must be executed as a **Refund (Flow A)**, not as a discount!
* **Test Case:** `TC-EDGE-006` (Discount boundary validation against collected payments).

---

### Edge Case 7: Late Fee Assessment & Principal-First Priority
* **Scenarios & Boundary Conditions:**
  1. *Payment Received on Grace Period Deadline:* Payment made at 23:59:59 on the due date in tenant timezone.
  2. *Principal-First Partial Allocation:* Customer owes ₹5,000 principal + ₹500 late fee. Customer pays ₹3,000.
  3. *Admin Late Fee Waiver:* Admin waives the ₹500 late fee after it has been assessed.
* **Failure Modes & Risks:**
  * Timezone skew causing late fees to be applied prematurely.
  * Ledger confusion between penalty income and base charge income.
* **Algorithmic Resolution:**
  * **Timezone Normalization:** All due dates evaluate against the Tenant's configured timezone (`tenant.timezone`, e.g., `Asia/Kolkata`), not the UTC server time.
  * **Principal-First Rule (MVP Rule):**
    ```typescript
    const unpaidPrincipal = due.netAmount - due.allocatedPrincipal;
    const allocToPrincipal = paymentAmount < unpaidPrincipal ? paymentAmount : unpaidPrincipal;
    const remainingForLateFee = paymentAmount - allocToPrincipal;
    const unpaidLateFee = due.lateFeeAmount - due.allocatedLateFee;
    const allocToLateFee = remainingForLateFee < unpaidLateFee ? remainingForLateFee : unpaidLateFee;
    ```
    * For ₹5,000 principal + ₹500 late fee with ₹3,000 payment:
      * `allocToPrincipal` = ₹3,000
      * `allocToLateFee` = ₹0
      * Remaining Principal = ₹2,000, Remaining Late Fee = ₹500.
  * **Waiver Accounting:** Waiving a late fee creates an explicit `LATE_FEE_WAIVED` entry in `financial_transaction_logs`, reducing `late_fee_amount` and logging the Admin's ID and mandatory waiver reason.
* **Test Case:** `TC-EDGE-007` (Late fee assessment, Principal-First partial allocation, and waiver audit).

---

### Edge Case 8: Refunds & Segregated Due vs. Advance Flows
* **Scenarios & Boundary Conditions:**
  1. *Refund of Multi-Due Payment:* A ₹10,000 payment was allocated ₹4,000 to Due 1 and ₹6,000 to Due 2. A partial refund of ₹5,000 is requested.
  2. *Refund of Advance Balance:* Customer deposited ₹10,000; requests ₹4,000 back.
* **Failure Modes & Risks:**
  * Re-opening arbitrary dues without specifying which charge was cancelled or reversed.
  * Confusing credit wallet withdrawals with receivable reversals.
* **Algorithmic Resolution:**
  * **Segregated Flow A (Due Allocation Refund):** The refund targets specific `payment_allocation` records:
    * Increments `payment_allocation.refunded_amount`.
    * Restores `due.balance_remaining += refund_amount`.
    * Status transitions: If `current_date > due_date` $\rightarrow$ `OVERDUE`; else $\rightarrow$ `PARTIALLY_PAID`.
    * Writes `DUE_ALLOCATION_REFUND` to `financial_transaction_logs`.
  * **Segregated Flow B (Advance Wallet Refund):** Targets unallocated wallet balance:
    * Decrements `person.advance_balance -= refund_amount`.
    * **Zero Dues modified.**
    * Writes `ADVANCE_WALLET_REFUND` to `financial_transaction_logs`.
* **Test Case:** `TC-EDGE-008` (Multi-due allocation refund vs advance wallet refund segregation).

---

### Edge Case 9: Recurring Charges & Calendar Anomalies
* **Scenarios & Boundary Conditions:**
  1. *Month-End Drift:* Monthly plan starting Jan 31. Next months have 28/29, 30, 31 days.
  2. *Leap Years:* Annual plan on Feb 29.
* **Failure Modes & Risks:**
  * Feb 28 becoming permanently locked as the billing date for subsequent months (March 28, April 28 instead of March 31, April 30).
* **Algorithmic Resolution:**
  * Store the immutable **Anchor Day of Month** (`anchor_day: int = 31`) on `recurring_plans`.
  * In any given month $M$ of year $Y$:
    $$\text{TargetDay} = \min(\text{anchor\_day}, \text{days\_in\_month}(Y, M))$$
  * For Jan 31 $\rightarrow$ Feb 28 (non-leap) $\rightarrow$ Mar 31 $\rightarrow$ Apr 30 $\rightarrow$ May 31.
* **Test Case:** `TC-EDGE-009` (Recurring month-end date calculation across 12 consecutive months).

---

### Edge Case 10: Duplicate Recurring Dues & Concurrency
* **Scenarios & Boundary Conditions:**
  1. The cron job server crashes midway through generating dues and restarts.
  2. Multiple worker processes execute the recurring due generation job simultaneously.
* **Failure Modes & Risks:**
  * Double billing for the same billing period.
* **Algorithmic Resolution:**
  * **Deterministic Cycle Period Key:** For each plan, compute a discrete period key (e.g., `2026-10` for monthly, `2026-W39` for weekly).
  * **PostgreSQL Unique Index:**
    ```sql
    CREATE UNIQUE INDEX uq_recurring_due_cycle 
    ON dues (tenant_id, recurring_plan_id, cycle_period_key) 
    WHERE recurring_plan_id IS NOT NULL;
    ```
  * Insertion uses `ON CONFLICT (tenant_id, recurring_plan_id, cycle_period_key) DO NOTHING`. Zero chance of duplicate due generation.
* **Test Case:** `TC-EDGE-010` (Concurrent worker due generation idempotency test).

---

### Edge Case 11: Deactivated People & Operations
* **Scenarios & Boundary Conditions:**
  1. A person is deactivated while having ₹5,000 in outstanding dues.
  2. An operator tries to collect payment on an inactive person's outstanding due.
  3. An operator tries to add a new charge to an inactive person.
* **Failure Modes & Risks:**
  * Outstanding money becomes uncollectable because the system rejects all actions on inactive accounts.
  * Inactive person charged for new billing cycles.
* **Algorithmic Resolution:**
  * New Charge Creation: Blocked (`HTTP 422 "Cannot create charges for an inactive person"`).
  * Recurring Due Generation: Automatically paused and excluded (`WHERE person.status = 'ACTIVE'`).
  * Payment Collection on Pre-existing Dues: **Permitted!** The cashier can select existing dues and settle them.
  * Financial history & reports: Inactive person's past receipts and statements remain fully queryable.
* **Test Case:** `TC-EDGE-011` (Settlement of pre-existing dues on soft-deactivated person).

---

### Edge Case 12: Historical Transactions, Receipt Sequences & Frozen Snapshots
* **Scenarios & Boundary Conditions:**
  1. An organization renames its legal business name, tax ID, or changes its Terminology (e.g., "Fee" to "Tuition").
  2. A user is deleted or deactivated.
  3. A payment transaction fails midway through execution.
* **Failure Modes & Risks:**
  * Historical receipts display updated names or missing user references.
  * Receipt sequence numbers have gaps due to failed transactions.
* **Algorithmic Resolution:**
  * **Rollback-Safe In-Transaction Numbering:** Receipt sequence is incremented inside the payment transaction via:
    ```sql
    UPDATE receipt_sequences
    SET current_sequence = current_sequence + 1
    WHERE tenant_id = :tenant_id AND fiscal_year = :fiscal_year
    RETURNING current_sequence;
    ```
    If the transaction aborts, the sequence increment rolls back automatically.
  * **Frozen Snapshot:** Receipts store `snapshot_data JSONB` containing payer details, payment details, itemized allocations, org profile, and template version (`"v1.0"`).
  * Future viewing or reprinting renders deterministically from this frozen snapshot without re-querying current tenant or person tables.
* **Test Case:** `TC-EDGE-012` (Receipt reprint invariance and sequence rollback test on failed transaction).
