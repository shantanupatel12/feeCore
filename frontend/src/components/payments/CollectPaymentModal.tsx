import React, { useState } from 'react';
import { DueDto, PaymentMode } from '@feecore/shared-types';
import { CloseIcon } from '../common/Icons.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    dueId: string;
    paymentMode: PaymentMode;
    amountMinor?: string;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
  }) => Promise<void>;
  due: DueDto | null;
  isSubmitting?: boolean;
  saveError?: string | null;
}

export const CollectPaymentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSubmit,
  due,
  isSubmitting,
  saveError,
}) => {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [amount, setAmount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (due) {
      const balance = (parseInt(due.balanceRemainingMinor, 10) || 0) / 100;
      setAmount(balance.toFixed(2));
      setReferenceNumber('');
      setNotes('');
    }
  }, [due]);

  if (!isOpen || !due) return null;

  const balanceRemaining = parseInt(due.balanceRemainingMinor, 10) || 0;
  const balanceMajor = (balanceRemaining / 100).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = parseFloat(amount);
    if (!entered || isNaN(entered) || entered <= 0) return;

    const minor = Math.round(entered * 100).toString();
    const idempotencyKey = `pay-${due.id}-${Date.now()}`;

    await onSubmit({
      dueId: due.id,
      paymentMode,
      amountMinor: minor,
      referenceNumber: referenceNumber || undefined,
      notes: notes || undefined,
      idempotencyKey,
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(37, 34, 31, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '480px',
          padding: '2rem',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Record Payment
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Settle open obligation against due ledger</p>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Due Context Strip */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem',
            marginBottom: '1.25rem',
            fontSize: '0.8125rem',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.375rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Payer:</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{due.person?.fullName || 'Unknown'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Category:</span>
            <span style={{ color: 'var(--text-primary)' }}>{due.charge?.category || 'General'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Net Due Obligation:</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>₹{((parseInt(due.netAmountMinor, 10) || 0) / 100).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.375rem', borderTop: '1px solid var(--border-subtle)', fontWeight: 700 }}>
            <span style={{ color: 'var(--text-primary)' }}>Balance Remaining:</span>
            <span style={{ color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)' }}>₹{balanceMajor}</span>
          </div>
        </div>

        {saveError && (
          <div
            style={{
              background: 'var(--status-overdue-bg)',
              border: '1px solid var(--status-overdue-border)',
              color: 'var(--status-overdue)',
              padding: '0.625rem 1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
            }}
          >
            {saveError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Payment Mode *</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            >
              <option value="UPI">UPI</option>
              <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
              <option value="CARD">Credit / Debit Card</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="OTHER">Other Mode</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Amount to Collect (₹) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(balanceRemaining / 100).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting}
              required
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Full settlement: ₹{balanceMajor}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Transaction Reference Number</label>
            <input
              type="text"
              placeholder="e.g. UPI Ref / UTR / Cheque #"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Notes</label>
            <textarea
              placeholder="Optional collection notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              rows={2}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? 'Recording…' : 'Record & Generate Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
