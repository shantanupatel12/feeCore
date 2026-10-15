import React, { useState, useEffect, useCallback } from 'react';
import { useActivity, ActivityFilters } from '../../features/activity/useActivity.js';
import { UserRole } from '@feecore/shared-types';

interface Props {
  tenantId: string;
  userRole?: UserRole;
}

export const ActivityLog: React.FC<Props> = ({ tenantId }) => {
  const {
    logs,
    isLoading,
    error,
    pagination,
    filters,
    eventTypeOptions,
    fetchLogs,
    setFilters,
    loadMore,
    refresh,
  } = useActivity(tenantId);

  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = useCallback((updates: Partial<ActivityFilters>) => {
    setFilters(updates);
    fetchLogs();
  }, [setFilters, fetchLogs]);

  return (
    <div>
      {/* Action / Filter Toggle Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn btn-secondary btn-sm"
        >
          <span>{showFilters ? 'Hide Filters ▲' : 'Filter Activity ▼'}</span>
        </button>

        <button
          onClick={refresh}
          disabled={isLoading}
          className="btn btn-secondary btn-sm"
        >
          Refresh Ledger
        </button>
      </div>

      {/* Filter Row */}
      {showFilters && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Event Type</label>
            <select
              value={filters.eventType ?? ''}
              onChange={(e) => handleFilterChange({ eventType: e.target.value || undefined })}
              style={{ width: '100%' }}
            >
              <option value="">All Events</option>
              {eventTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>From Date</label>
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => handleFilterChange({ from: e.target.value || undefined })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>To Date</label>
            <input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => handleFilterChange({ to: e.target.value || undefined })}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--status-overdue-bg)', border: '1px solid var(--status-overdue-border)', color: 'var(--status-overdue)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {isLoading && logs.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Loading audit activity ledger…
        </div>
      ) : logs.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No recorded activity logs found.
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action / Event</th>
                <th>Actor / User</th>
                <th>Entity Reference</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isDelete = log.eventType.toLowerCase().includes('delete');
                const isCreate = log.eventType.toLowerCase().includes('create');
                const badgeClass = isDelete ? 'badge badge-overdue' : isCreate ? 'badge badge-paid' : 'badge badge-pending';

                return (
                  <tr key={log.id}>
                    <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td>
                      <span className={badgeClass} style={{ fontSize: '0.6875rem' }}>
                        {log.eventType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontSize: '0.8125rem' }}>
                      {log.performedByUserId ?? 'System Automation'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.referenceEntityType}</span>{' '}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        #{log.referenceEntityId ? log.referenceEntityId.slice(0, 10) : log.id.slice(0, 8)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.page < pagination.totalPages && (
        <div style={{ padding: '1.25rem', textAlign: 'center' }}>
          <button
            onClick={loadMore}
            disabled={isLoading}
            className="btn btn-secondary btn-sm"
          >
            {isLoading ? 'Loading…' : 'Load More Activity'}
          </button>
        </div>
      )}
    </div>
  );
};
