import React from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { DueDto, UserRole } from '@feecore/shared-types';
import { StatusBadge } from '../common/StatusBadge.js';
import { SearchIcon, PaymentsIcon } from '../common/Icons.js';

interface Props {
  dues: DueDto[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  onGenerateDues: () => void;
  onCollectPayment?: (due: DueDto) => void;
  isGenerating?: boolean;
  isLoading?: boolean;
  error?: string | null;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  userRole?: UserRole;
}

export const DuesTable: React.FC<Props> = ({
  dues,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusChange,
  onGenerateDues,
  onCollectPayment,
  isGenerating,
  isLoading,
  error,
  pagination,
  onPageChange,
  userRole,
}) => {
  const { pSingular, cSingular } = useTerminology();
  const canManageDues = userRole === 'ROLE_ADMIN' || userRole === 'ROLE_COLLECTOR';

  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  // Compute summary stats from dues
  const totalBalanceMinor = dues.reduce((acc, d) => acc + (parseInt(d.balanceRemainingMinor, 10) || 0), 0);
  const overdueCount = dues.filter((d) => d.status === 'OVERDUE').length;
  const partialCount = dues.filter((d) => d.status === 'PARTIALLY_PAID').length;
  const paidCount = dues.filter((d) => d.status === 'PAID').length;

  return (
    <div className="card" style={{ padding: '1.75rem' }}>
      {/* Page Header */}
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
            Dues & Receivables Directory
          </h2>
          <p className="page-subtitle">
            Track active collection obligations, aging schedules, and outstanding balances.
          </p>
        </div>

        {canManageDues && (
          <button
            onClick={onGenerateDues}
            disabled={isGenerating || isLoading}
            className="btn btn-secondary"
          >
            <PaymentsIcon size={14} color="var(--brand-primary)" />
            <span>{isGenerating ? 'Assessing Dues…' : 'Assess Scheduled Dues'}</span>
          </button>
        )}
      </div>

      {/* Summary KPI Mini-Panels (Matching reference styling) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.875rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ padding: '0.875rem 1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Outstanding Balance</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totalBalanceMinor.toString())}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>In active view</div>
        </div>

        <div style={{ padding: '0.875rem 1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Overdue Obligations</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {overdueCount}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Delinquent accounts</div>
        </div>

        <div style={{ padding: '0.875rem 1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Partially Paid</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-partial)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {partialCount}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Partial collection</div>
        </div>

        <div style={{ padding: '0.875rem 1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Paid / Settled</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-paid)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {paidCount}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Fully collected</div>
        </div>
      </div>

      {/* Search and Status Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: '0.875rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <SearchIcon size={14} />
          </span>
          <input
            type="text"
            placeholder={`Search by ${pSingular.toLowerCase()} name or phone...`}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={isLoading || isGenerating}
            style={{
              width: '100%',
              padding: '0.5rem 0.875rem 0.5rem 2.375rem',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-secondary)',
              fontSize: '0.8125rem',
            }}
          />
        </div>

        {/* Status Filter Dropdown / Select */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={isLoading || isGenerating}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
          }}
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="OVERDUE">Overdue</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
        </select>
      </div>

      {error && (
        <div className="error-state">
          {error}
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Loading dues records…
        </div>
      )}

      {!isLoading && dues.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No due records found</div>
          <div className="empty-state-desc">
            No dues match your filter criteria or no charges have been assessed yet.
          </div>
        </div>
      )}

      {!isLoading && dues.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>{pSingular}</th>
                <th>Category</th>
                <th>Due Date</th>
                <th>Total Obligation</th>
                <th>Paid</th>
                <th>Remaining Balance</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dues.map((due) => {
                const totalAmt = parseInt(due.netAmountMinor, 10) || 0;
                const balance = parseInt(due.balanceRemainingMinor, 10) || 0;
                const paidMinor = Math.max(0, totalAmt - balance);
                const personName = due.person?.fullName || 'Unknown';
                const initial = personName.charAt(0).toUpperCase();

                return (
                  <tr key={due.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="avatar-initial">{initial}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{personName}</div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            {due.person?.primaryPhone || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {due.charge?.category || cSingular}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      {new Date(due.dueDate).toISOString().split('T')[0]}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatCurrency(due.netAmountMinor)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--status-paid)' }}>
                      {formatCurrency(paidMinor.toString())}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: balance === 0 ? 'var(--status-paid)' : 'var(--status-overdue)' }}>
                      {formatCurrency(due.balanceRemainingMinor)}
                    </td>
                    <td>
                      <StatusBadge status={due.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canManageDues && due.balanceRemainingMinor !== '0' && onCollectPayment && (
                        <button
                          onClick={() => onCollectPayment(due)}
                          className="btn btn-primary btn-xs"
                        >
                          Collect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && !isLoading && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.25rem',
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} dues
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn btn-secondary btn-sm"
            >
              Previous
            </button>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', padding: '0 0.375rem' }}>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="btn btn-secondary btn-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
