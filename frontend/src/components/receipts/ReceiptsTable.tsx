import React from 'react';
import { ReceiptDto } from '@feecore/shared-types';
import { SearchIcon } from '../common/Icons.js';

interface ReceiptsTableProps {
  receipts: ReceiptDto[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onReceiptClick: (receipt: ReceiptDto) => void;
  isLoading?: boolean;
  error?: string | null;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}

export const ReceiptsTable: React.FC<ReceiptsTableProps> = ({
  receipts,
  searchTerm,
  onSearchChange,
  onReceiptClick,
  isLoading,
  error,
  pagination,
  onPageChange,
}) => {
  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
            Receipts Directory
          </h2>
          <p className="page-subtitle">
            Formal receipt ledger with itemized breakdown, print versions, and digital PDF downloads.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: '1.25rem', maxWidth: '360px', position: 'relative' }}>
        <span
          style={{
            position: 'absolute',
            left: '0.75rem',
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
          placeholder="Search by receipt number..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem 0.5rem 2.25rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.8125rem',
          }}
        />
      </div>

      {error && (
        <div
          style={{
            background: 'var(--status-overdue-bg)',
            border: '1px solid var(--status-overdue-border)',
            color: 'var(--status-overdue)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Loading receipts…
        </div>
      )}

      {!isLoading && receipts.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No receipts found.
        </div>
      )}

      {!isLoading && receipts.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Payer</th>
                <th>Payment Mode</th>
                <th>Total Amount</th>
                <th>Issued At</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => {
                const snapshot = receipt.snapshot;
                const payerName = snapshot?.payer?.fullName ?? 'Unknown';
                const paymentMode = snapshot?.payment?.paymentMode ?? '—';
                const totalAmount = snapshot?.payment?.totalAmountMinor ?? '0';
                const issuedAt = new Date(receipt.issuedAt).toLocaleString('en-IN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <tr key={receipt.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      #{receipt.receiptNumber}
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>
                      {payerName}
                    </td>
                    <td>
                      <span className="badge badge-pending" style={{ fontSize: '0.6875rem' }}>
                        {paymentMode}
                      </span>
                    </td>
                    <td style={{ color: 'var(--status-paid)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(totalAmount)}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      {issuedAt}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => onReceiptClick(receipt)}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                      >
                        Inspect
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
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total receipts)
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.3rem 0.625rem' }}
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.3rem 0.625rem' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
