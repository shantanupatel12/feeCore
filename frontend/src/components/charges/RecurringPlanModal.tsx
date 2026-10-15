import React, { useState } from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { RecurringFrequency } from '@feecore/shared-types';
import { CloseIcon } from '../common/Icons.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    personId: string;
    category: string;
    baseAmountMinor: string;
    frequency: RecurringFrequency;
    anchorDay: number;
    startDate: string;
  }) => Promise<void>;
  people: Array<{ id: string; fullName: string; primaryPhone: string }>;
  isSubmitting?: boolean;
  saveError?: string | null;
}

export const RecurringPlanModal: React.FC<Props> = ({ isOpen, onClose, onSubmit, people, isSubmitting, saveError }) => {
  const { cSingular, pSingular } = useTerminology();
  const [personId, setPersonId] = useState('');
  const [category, setCategory] = useState('Maintenance');
  const [baseAmount, setBaseAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [anchorDay, setAnchorDay] = useState('1');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId || !baseAmount) return;

    const baseMinor = Math.round(parseFloat(baseAmount) * 100).toString();

    await onSubmit({
      personId,
      category,
      baseAmountMinor: baseMinor,
      frequency,
      anchorDay: parseInt(anchorDay, 10) || 1,
      startDate,
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
              Create Recurring Schedule
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Automated fee execution anchor</p>
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
              <option value="Maintenance">Maintenance</option>
              <option value="Tuition">Tuition / Course Fee</option>
              <option value="Hostel">Hostel / Rent</option>
              <option value="Membership">Membership</option>
              <option value="Transport">Transport / Facility</option>
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
                placeholder="2500.00"
                disabled={isSubmitting}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Frequency *</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                disabled={isSubmitting}
                style={{ width: '100%' }}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Anchor Day of Month *</label>
              <input
                type="number"
                min="1"
                max="31"
                required
                value={anchorDay}
                onChange={(e) => setAnchorDay(e.target.value)}
                disabled={isSubmitting}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Schedule Start Date *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isSubmitting}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? 'Creating…' : 'Activate Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
