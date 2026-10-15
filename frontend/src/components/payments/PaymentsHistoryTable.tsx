import React, { useState } from 'react';
import { ReceiptDto } from '@feecore/shared-types';
import { StatusBadge } from '../common/StatusBadge.js';
import { SearchIcon, ReceiptsIcon } from '../common/Icons.js';

interface PaymentsHistoryTableProps {
  receipts: ReceiptDto[];
  isLoading?: boolean;
  error?: string | null;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onViewReceipt: (receipt: ReceiptDto) => void;
}

export const PaymentsHistoryTable: React.FC<PaymentsHistoryTableProps> = ({
  receipts,
  isLoading,
  error,
  pagination,
  onPageChange,
  onViewReceipt,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  const filteredReceipts = receipts.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const payer = r.snapshot?.payer?.fullName?.toLowerCase() || '';
    const num = r.receiptNumber?.toLowerCase() || '';
    const ref = r.snapshot?.payment?.referenceNumber?.toLowerCase() || '';
    return payer.includes(term) || num.includes(term) || ref.includes(term);
  });

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
            Payment Transactions & Collections Ledger
          </h2>
          <p className="page-subtitle">
            Audited transaction ledger of completed collections, payment modes, and allocated receipts.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '1.25rem', maxWidth: '380px', position: 'relative' }}>
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
          placeholder="Filter by person, receipt #, reference..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={isLoading}
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

      {error && (
        <div className="error-state">
          {error}
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Loading payment history…
        </div>
      )}

      {!isLoading && filteredReceipts.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No payment records found</div>
          <div className="empty-state-desc">
            Recorded collections, payment references, and receipts will appear here.
          </div>
        </div>
      )}

      {!isLoading && filteredReceipts.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Payer Profile</th>
                <th>Settled Amount</th>
                <th>Payment Mode</th>
                <th>Collection Date</th>
                <th>Reference ID</th>
                <th>Receipt #</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.map((r) => {
                const snap = r.snapshot;
                const payerName = snap?.payer?.fullName || 'Unknown';
                const initial = payerName.charAt(0).toUpperCase();

                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="avatar-initial">{initial}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payerName}</div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            {snap?.payer?.primaryPhone || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--status-paid)' }}>
                      {formatCurrency(snap?.payment?.totalAmountMinor || '0')}
                    </td>
                    <td>
                      <span
                        className="badge badge-pending"
                        style={{ fontSize: '0.6875rem' }}
                      >
                        {snap?.payment?.paymentMode || '—'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      {new Date(r.issuedAt).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {snap?.payment?.referenceNumber || '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => onViewReceipt(r)}
                        className="btn btn-secondary btn-xs"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        #{r.receiptNumber}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={(r as any).status || 'PAID'} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => onViewReceipt(r)}
                        className="btn btn-secondary btn-xs"
                      >
                        View Voucher
                      </button>
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
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} payments
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
