import React, { useState, useEffect } from 'react';
import { ReportsFilters } from '../../features/reports/useReports.js';
import {
  CollectionReportResponse,
  DuesReportResponse,
  PaymentMode,
} from '@feecore/shared-types';

export const CollectionReportControls: React.FC<{
  filters: ReportsFilters;
  onChange: (filters: ReportsFilters) => void;
  paymentModes: PaymentMode[];
  isDisabled?: boolean;
}> = ({ filters, onChange, paymentModes, isDisabled }) => {
  const [localFilters, setLocalFilters] = useState(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleChange = (key: keyof ReportsFilters, value: any) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onChange(newFilters);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '1.25rem',
        padding: '1.25rem',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>From Date</label>
        <input
          type="date"
          value={localFilters.from ?? ''}
          onChange={(e) => handleChange('from', e.target.value || undefined)}
          disabled={isDisabled}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>To Date</label>
        <input
          type="date"
          value={localFilters.to ?? ''}
          onChange={(e) => handleChange('to', e.target.value || undefined)}
          disabled={isDisabled}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Payment Mode</label>
        <select
          value={localFilters.paymentMode ?? ''}
          onChange={(e) => handleChange('paymentMode', e.target.value || undefined)}
          disabled={isDisabled}
          style={{ width: '100%' }}
        >
          <option value="">All Payment Modes</option>
          {paymentModes.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

const formatCurrency = (minor: string) => {
  const amt = (parseInt(minor || '0', 10) || 0) / 100;
  return `₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

interface CollectionReportProps {
  data: CollectionReportResponse | null;
  isLoading: boolean;
}

export const CollectionReport: React.FC<CollectionReportProps> = ({ data, isLoading }) => {
  if (isLoading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Generating collection report…</div>;
  }

  if (!data) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No report data loaded. Set filters and click Generate.</div>;
  }

  const { totals, byPaymentMode, byCollector } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Metric Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Net Collected</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--status-paid)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.netCollectedMinor)}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Payments</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {totals.paymentCount}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Gross Collected</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.grossCollectedMinor)}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Refunded</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.refundedMinor)}
          </div>
        </div>
      </div>

      {/* Breakdowns Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>By Payment Mode</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Mode</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {byPaymentMode.map((entry) => (
                  <tr key={entry.paymentMode}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.paymentMode}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(entry.totalMinor)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.paymentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>By Collector</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Collector</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {byCollector.map((entry) => (
                  <tr key={entry.collectorUserId}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.collectorName ?? entry.collectorUserId.slice(0, 8)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(entry.totalMinor)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.paymentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Itemized Transactions */}
      {data.items.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Recent Payment Transactions</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Mode</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      {new Date(item.paymentDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.personName}</td>
                    <td>
                      <span className="badge badge-pending" style={{ fontSize: '0.625rem' }}>{item.paymentMode}</span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--status-paid)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(item.totalAmountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface DuesReportProps {
  data: DuesReportResponse | null;
  isLoading: boolean;
}

export const DuesReport: React.FC<DuesReportProps> = ({ data, isLoading }) => {
  if (isLoading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Generating dues report…</div>;
  }

  if (!data) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No report data loaded. Set filters and click Generate.</div>;
  }

  const { totals, byStatus, byCategory } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Metric Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Outstanding</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.totalOutstandingMinor)}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Open Obligations</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {totals.openDueCount}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Overdue Amount</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--status-overdue)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.totalOverdueMinor)}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{totals.overdueDueCount} overdue dues</div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Assessed Late Fees</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
            {formatCurrency(totals.outstandingLateFeeMinor)}
          </div>
        </div>
      </div>

      {/* Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>By Status</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {byStatus.map((entry) => (
                  <tr key={entry.status}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.status}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.dueCount}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(entry.balanceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>By Category</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((entry) => (
                  <tr key={entry.category}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.category}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.dueCount}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(entry.balanceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Itemized Dues List */}
      {data.items.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Individual Dues Obligations</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Category</th>
                  <th>Due Date</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th style={{ textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.personName}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{item.category}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{item.dueDate ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: item.status === 'OVERDUE' ? 'var(--status-overdue)' : 'var(--text-primary)' }}>
                      {formatCurrency(item.balanceRemainingMinor)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`badge ${item.status === 'PAID' ? 'badge-paid' : item.status === 'OVERDUE' ? 'badge-overdue' : 'badge-pending'}`} style={{ fontSize: '0.625rem' }}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
