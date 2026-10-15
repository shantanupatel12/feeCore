import React, { useState } from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { RecurringPlanDto, UserRole } from '@feecore/shared-types';
import { StatusBadge } from '../common/StatusBadge.js';
import { PlusIcon } from '../common/Icons.js';

interface ChargesPageProps {
  plans: RecurringPlanDto[];
  charges: any[];
  onOpenChargeModal: () => void;
  onOpenPlanModal: () => void;
  onTogglePlanStatus: (planId: string, currentStatus: string) => void;
  isLoadingPlans?: boolean;
  isLoadingCharges?: boolean;
  userRole?: UserRole;
}

export const ChargesPage: React.FC<ChargesPageProps> = ({
  plans,
  charges,
  onOpenChargeModal,
  onOpenPlanModal,
  onTogglePlanStatus,
  isLoadingPlans,
  isLoadingCharges,
  userRole,
}) => {
  const { cSingular, cPlural } = useTerminology();
  const [activeTab, setActiveTab] = useState<'plans' | 'charges'>('plans');
  const canManageCharges = userRole === 'ROLE_ADMIN' || userRole === 'ROLE_COLLECTOR';

  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="card" style={{ padding: '1.75rem' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h2 className="section-title" style={{ fontSize: '1.375rem' }}>
            {cPlural} & Billing Schedules
          </h2>
          <p className="page-subtitle">
            Configure automated recurring billing schedules and assess one-time institutional fees.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {canManageCharges && (
            <button
              onClick={onOpenChargeModal}
              className="btn btn-secondary"
            >
              <PlusIcon size={14} color="var(--brand-primary)" />
              <span>Assess One-Time {cSingular}</span>
            </button>
          )}

          {canManageCharges && (
            <button
              onClick={onOpenPlanModal}
              className="btn btn-primary"
            >
              <PlusIcon size={14} color="#FFFFFF" />
              <span>New Recurring Plan</span>
            </button>
          )}
        </div>
      </div>

      {/* Segmented View Switcher (Pill styling matching Blockera tabs) */}
      <div
        style={{
          display: 'inline-flex',
          gap: '4px',
          padding: '4px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
      >
        <button
          onClick={() => setActiveTab('plans')}
          className={`timeframe-pill ${activeTab === 'plans' ? 'active' : ''}`}
          style={{ padding: '6px 14px', fontSize: '0.78125rem' }}
        >
          Recurring Plans ({plans.length})
        </button>

        <button
          onClick={() => setActiveTab('charges')}
          className={`timeframe-pill ${activeTab === 'charges' ? 'active' : ''}`}
          style={{ padding: '6px 14px', fontSize: '0.78125rem' }}
        >
          One-Time Charges ({charges.length})
        </button>
      </div>

      {/* Plans View */}
      {activeTab === 'plans' && (
        <>
          {isLoadingPlans && plans.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading recurring plans…
            </div>
          ) : plans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No recurring plans active</div>
              <div className="empty-state-desc">
                Automate fee assessments by scheduling monthly, quarterly, or annual plans.
              </div>
              {canManageCharges && (
                <button
                  onClick={onOpenPlanModal}
                  className="btn btn-primary"
                  style={{ marginTop: '1rem' }}
                >
                  <PlusIcon size={14} color="#FFFFFF" />
                  <span>Create Recurring Schedule</span>
                </button>
              )}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Billing Frequency</th>
                    <th>Assessment Amount</th>
                    <th>Anchor Day</th>
                    <th>Next Execution</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{plan.category}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Automated Plan</div>
                      </td>
                      <td>
                        <span className="badge badge-pending" style={{ fontSize: '0.6875rem' }}>
                          {plan.frequency}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatCurrency(plan.baseAmountMinor)}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        Day {plan.anchorDay} of month
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {new Date(plan.nextExecutionDate).toISOString().split('T')[0]}
                      </td>
                      <td>
                        <StatusBadge status={plan.status} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canManageCharges && (
                          <button
                            onClick={() => onTogglePlanStatus(plan.id, plan.status)}
                            className="btn btn-secondary btn-xs"
                            style={{
                              color: plan.status === 'ACTIVE' ? 'var(--status-partial)' : 'var(--status-paid)',
                            }}
                          >
                            {plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Charges View */}
      {activeTab === 'charges' && (
        <>
          {isLoadingCharges && charges.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading assessed charges…
            </div>
          ) : charges.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No one-time charges assessed</div>
              <div className="empty-state-desc">
                Issue one-time assessments for specific events, enrollment fees, or penalties.
              </div>
              {canManageCharges && (
                <button
                  onClick={onOpenChargeModal}
                  className="btn btn-secondary"
                  style={{ marginTop: '1rem' }}
                >
                  <PlusIcon size={14} color="var(--brand-primary)" />
                  <span>Assess One-Time {cSingular}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Base Amount</th>
                    <th>Due Date</th>
                    <th>Assessed Date</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((chg) => (
                    <tr key={chg.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{chg.category || cSingular}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Ad-Hoc Charge</div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {chg.description || '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatCurrency(chg.baseAmountMinor)}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {chg.dueDate ? new Date(chg.dueDate).toISOString().split('T')[0] : '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                        {chg.createdAt ? new Date(chg.createdAt).toLocaleDateString('en-IN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};
