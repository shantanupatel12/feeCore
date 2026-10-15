import React, { useState } from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { CloseIcon } from '../common/Icons.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    personId: string;
    category: string;
    description: string;
    baseAmountMinor: string;
    discountAmountMinor: string;
    dueDate: string;
  }) => Promise<void>;
  people: Array<{ id: string; fullName: string; primaryPhone: string }>;
  isSubmitting?: boolean;
  saveError?: string | null;
}

export const OneTimeChargeModal: React.FC<Props> = ({ isOpen, onClose, onSubmit, people, isSubmitting, saveError }) => {
  const { cSingular, pSingular } = useTerminology();
  const [personId, setPersonId] = useState('');
  const [category, setCategory] = useState('Tuition');
  const [description, setDescription] = useState('');
  const [baseAmount, setBaseAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId || !baseAmount) return;

    const baseMinor = Math.round(parseFloat(baseAmount) * 100).toString();
    const discountMinor = Math.round((parseFloat(discountAmount) || 0) * 100).toString();

    await onSubmit({
      personId,
      category,
      description,
      baseAmountMinor: baseMinor,
      discountAmountMinor: discountMinor,
      dueDate,
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
          maxWidth: '520px',
          padding: '2rem',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Assess One-Time {cSingular}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Generate immediate ad-hoc fee obligation</p>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>
            <CloseIcon size={16} />
          </button>
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
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Select {pSingular} *</label>
            <select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              required
              disabled={isSubmitting}
              style={{ width: '100%' }}
            >
              <option value="">Choose a {pSingular.toLowerCase()}...</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName} ({p.primaryPhone})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            >
              <option value="Tuition">Tuition / Fee</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Membership">Membership</option>
              <option value="Hostel">Hostel / Rent</option>
              <option value="Other">Other Assessment</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Base Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={baseAmount}
                onChange={(e) => setBaseAmount(e.target.value)}
                placeholder="5000.00"
                disabled={isSubmitting}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Discount (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0.00"
                disabled={isSubmitting}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Due Date *</label>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Description / Remarks</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Assessment for current cycle"
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
              {isSubmitting ? 'Assessing…' : `Assess ${cSingular}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
