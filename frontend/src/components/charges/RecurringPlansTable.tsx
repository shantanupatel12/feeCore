import React from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { RecurringPlanDto } from '@feecore/shared-types';

interface Props {
  plans: RecurringPlanDto[];
  onNewPlan: () => void;
  onToggleStatus: (planId: string, currentStatus: string) => void;
  isLoading?: boolean;
}

export const RecurringPlansTable: React.FC<Props> = ({ plans, onNewPlan, onToggleStatus, isLoading }) => {
  const { cSingular, pSingular } = useTerminology();

  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Recurring {cSingular} Plans
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Automated fee schedules with start dates, execution anchors, and frequencies.
          </p>
        </div>

        <button
          onClick={onNewPlan}
          style={{
            padding: '0.625rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--brand-gradient)',
            color: '#fff',
            fontWeight: 600,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          + New Recurring Plan
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Category</th>
              <th style={{ padding: '0.75rem 1rem' }}>Frequency</th>
              <th style={{ padding: '0.75rem 1rem' }}>Amount</th>
              <th style={{ padding: '0.75rem 1rem' }}>Anchor Day</th>
              <th style={{ padding: '0.75rem 1rem' }}>Next Execution</th>
              <th style={{ padding: '0.75rem 1rem' }}>Status</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
           <tbody>
            {isLoading && plans.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Loading recurring plans…
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No recurring plans created yet.
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {plan.category}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                    <span className="badge badge-pending">{plan.frequency}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {formatCurrency(plan.baseAmountMinor)}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                    Day {plan.anchorDay}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                    {new Date(plan.nextExecutionDate).toISOString().split('T')[0]}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`badge ${plan.status === 'ACTIVE' ? 'badge-paid' : 'badge-overdue'}`}>
                      {plan.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button
                      onClick={() => onToggleStatus(plan.id, plan.status)}
                      style={{
                        padding: '0.375rem 0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        color: plan.status === 'ACTIVE' ? 'var(--status-partial)' : 'var(--status-paid)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
