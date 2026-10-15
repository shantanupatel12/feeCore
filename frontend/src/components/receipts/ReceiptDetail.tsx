import React from 'react';
import { ReceiptDto } from '@feecore/shared-types';
import { PrinterIcon, DownloadIcon, CloseIcon } from '../common/Icons.js';

interface ReceiptDetailProps {
  receipt: ReceiptDto | null;
  onClose: () => void;
  onDownloadPdf: () => void;
  onPrint: () => void;
  onRefund: (allocation: { id: string; totalAllocatedMinor: string; refundedAmountMinor: string; chargeCategory?: string }) => void;
  canRefund?: boolean;
}

export const ReceiptDetail: React.FC<ReceiptDetailProps> = ({
  receipt,
  onClose,
  onDownloadPdf,
  onPrint,
  onRefund,
  canRefund = true,
}) => {
  if (!receipt) return null;

  const snapshot = receipt.snapshot;
  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  const org = snapshot?.organization ?? {};
  const payer = snapshot?.payer ?? {};
  const payment = snapshot?.payment ?? {};
  const allocations = snapshot?.allocations ?? [];
  const totals = snapshot?.totals ?? {};

  const totalCollected = formatCurrency(payment?.totalAmountMinor ?? '0');
  const allocatedPrincipal = formatCurrency(totals?.allocatedPrincipalMinor ?? '0');
  const allocatedLateFee = formatCurrency(totals?.allocatedLateFeeMinor ?? '0');
  const creditedToAdvance = formatCurrency(totals?.creditedToAdvanceMinor ?? '0');

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
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '680px',
          padding: '2rem',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Document Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingBottom: '1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-paid" style={{ fontSize: '0.625rem' }}>
                OFFICIAL RECEIPT
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Template {snapshot?.templateVersion ?? 'v1.0'}
              </span>
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.375rem', fontFamily: 'var(--font-mono)' }}>
              #{receipt.receiptNumber}
            </h2>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
              Issued on {new Date(receipt.issuedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.375rem', borderRadius: 'var(--radius-xs)' }}
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Parties Grid (Organization & Payer) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
              Issuing Organization
            </div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {org.name ?? 'FeeCore Organization'}
            </div>
            {org.address && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{org.address}</div>}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Currency: {org.currency ?? 'INR'}</div>
          </div>

          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
              Billed Payer
            </div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {payer.fullName ?? '—'}
            </div>
            {payer.primaryPhone && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Phone: {payer.primaryPhone}</div>}
            {payer.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Email: {payer.email}</div>}
          </div>
        </div>

        {/* Payment Metadata Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: '#FFFFFF',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1.25rem',
            fontSize: '0.8125rem',
          }}
        >
          <div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', display: 'block' }}>Payment Mode</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payment.paymentMode ?? '—'}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', display: 'block' }}>Reference</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{payment.referenceNumber ?? '—'}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', display: 'block' }}>Collector</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payment.collectorName ?? payment.collectorUserId ?? 'System'}</span>
          </div>
        </div>

        {/* Allocation Breakdown Table */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Allocated Line Items
          </div>

          {allocations.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Due Date</th>
                    <th style={{ textAlign: 'right' }}>Principal</th>
                    <th style={{ textAlign: 'right' }}>Late Fee</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((alloc: any, idx: number) => {
                    const refunded = parseInt(alloc.refundedAmountMinor ?? '0', 10) || 0;
                    const total = parseInt(alloc.totalAllocatedMinor ?? '0', 10) || 0;
                    const refundable = total - refunded;

                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {alloc.category ?? 'General'}
                          {alloc.description && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                              {alloc.description}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                          {alloc.dueDate ?? '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {formatCurrency(alloc.allocatedPrincipalMinor ?? '0')}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          {formatCurrency(alloc.allocatedLateFeeMinor ?? '0')}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          {formatCurrency(alloc.totalAllocatedMinor ?? '0')}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {refundable > 0 && canRefund ? (
                            <button
                              onClick={() =>
                                onRefund({
                                  id: alloc.id,
                                  totalAllocatedMinor: alloc.totalAllocatedMinor ?? '0',
                                  refundedAmountMinor: alloc.refundedAmountMinor ?? '0',
                                  chargeCategory: alloc.category ?? undefined,
                                })
                              }
                              className="btn btn-secondary btn-sm"
                              style={{ color: 'var(--status-overdue)', fontSize: '0.6875rem', padding: '2px 6px' }}
                            >
                              Refund
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                              {refunded > 0 ? `Ref: ${formatCurrency(alloc.refundedAmountMinor ?? '0')}` : 'Settled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No individual allocation lines itemized.
            </div>
          )}
        </div>

        {/* Totals Summary */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '1.5rem',
            fontSize: '0.8125rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Allocated Principal:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{allocatedPrincipal}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Assessed Late Fee:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{allocatedLateFee}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Credited to Advance Wallet:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{creditedToAdvance}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingTop: '0.5rem',
              borderTop: '1px solid var(--border-subtle)',
              fontWeight: 700,
              fontSize: '1rem',
              color: 'var(--brand-primary)',
            }}
          >
            <span>Total Collected:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{totalCollected}</span>
          </div>
        </div>

        {/* Action Buttons: Print, Download PDF, Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', flexWrap: 'wrap' }}>
          <button
            onClick={onPrint}
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}
          >
            <PrinterIcon size={14} />
            <span>Print Receipt</span>
          </button>

          <button
            onClick={onDownloadPdf}
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}
          >
            <DownloadIcon size={14} />
            <span>Download PDF</span>
          </button>

          <button
            onClick={onClose}
            className="btn btn-primary"
            style={{ fontSize: '0.8125rem', padding: '0.5rem 1rem' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
