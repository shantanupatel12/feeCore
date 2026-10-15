import React, { useState } from 'react';
import { PersonDto } from '@feecore/shared-types';
import { CloseIcon } from '../common/Icons.js';

interface AdvanceRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    personId: string;
    refundAmountMinor: string;
    refundMode: string;
    refundReason: string;
    referenceNumber?: string;
  }) => Promise<void>;
  person: PersonDto | null;
  isSubmitting?: boolean;
  saveError?: string | null;
}

export const AdvanceRefundModal: React.FC<AdvanceRefundModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  person,
  isSubmitting,
  saveError,
}) => {
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMode, setRefundMode] = useState('CASH');
  const [refundReason, setRefundReason] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen || !person) return null;

  const advanceBalance = parseInt(person.advanceBalanceMinor, 10) || 0;
  const advanceMajor = (advanceBalance / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person || !refundAmount || !refundReason) return;

    const parsed = parseFloat(refundAmount);
    if (isNaN(parsed) || parsed <= 0) return;

    const amountMinor = Math.round(parsed * 100).toString();
    if (BigInt(amountMinor) > BigInt(person.advanceBalanceMinor)) return;

    if (confirmText !== 'REFUND') return;

    await onSubmit({
      personId: person.id,
      refundAmountMinor: amountMinor,
      refundMode,
      refundReason,
      referenceNumber: referenceNumber || undefined,
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
              Advance Wallet Refund
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Disburse credit balance to payer</p>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>
            <CloseIcon size={16} />
          </button>
        </div>

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
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{person.fullName}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', paddingTop: '0.25rem', borderTop: '1px solid var(--border-subtle)', fontWeight: 700 }}>
            <span style={{ color: 'var(--text-primary)' }}>Advance Wallet Balance:</span>
            <span style={{ color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>₹{advanceMajor}</span>
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
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Refund Amount (₹) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(advanceBalance / 100).toFixed(2)}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder={`Max: ₹${advanceMajor}`}
              disabled={isSubmitting}
              required
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Disbursement Mode</label>
            <select
              value={refundMode}
              onChange={(e) => setRefundMode(e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            >
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CHEQUE">Cheque</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Reason *</label>
            <input
              type="text"
              placeholder="e.g. Account closure or refund requested"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              disabled={isSubmitting}
              required
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Payout Reference</label>
            <input
              type="text"
              placeholder="e.g. UTR / Receipt / Cheque #"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ background: 'var(--status-overdue-bg)', border: '1px solid var(--status-overdue-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', fontSize: '0.8125rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--status-overdue)', fontWeight: 600 }}>
              Confirmation: Type "REFUND" to authorize
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="REFUND"
              disabled={isSubmitting}
              style={{ width: '100%', borderColor: 'var(--status-overdue-border)' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || confirmText !== 'REFUND'}
              className="btn btn-danger"
              style={{ opacity: confirmText !== 'REFUND' ? 0.5 : 1 }}
            >
              {isSubmitting ? 'Processing…' : 'Execute Advance Refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
