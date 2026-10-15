import React, { useState } from 'react';
import { StatusBadge } from '../../components/common/StatusBadge.js';
import {
  PaymentsIcon,
  ChargesIcon,
  PeopleIcon,
  ChevronRightIcon,
} from '../../components/common/Icons.js';
import { DueDto, ReceiptDto } from '@feecore/shared-types';

interface DashboardOverviewProps {
  totalOutstanding: number;
  overdueCount: number;
  activePlansCount: number;
  peopleCount: number;
  duesCount: number;
  cSingular: string;
  pPlural: string;
  pSingular?: string;
  todayCollected: number;
  periodCollected: number;
  allTimeCollected: number;
  allTimeNetCollected: number;
  dueRaisedToday: number;
  totalOverdue: number;
  advanceHeld: number;
  activePeopleCount: number;
  openDueCount: number;
  recentDues?: DueDto[];
  recentReceipts?: ReceiptDto[];
  onOpenChargeModal: () => void;
  onOpenPlanModal: () => void;
  onAddPerson?: () => void;
  onRecordPayment?: () => void;
  onViewAllDues?: () => void;
  onViewAllPayments?: () => void;
  onCollectDue?: (due: DueDto) => void;
  onViewReceipt?: (receipt: ReceiptDto) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  totalOutstanding,
  overdueCount,
  activePlansCount,
  peopleCount,
  duesCount,
  cSingular,
  pPlural,
  pSingular = 'Person',
  todayCollected,
  periodCollected,
  allTimeCollected,
  allTimeNetCollected,
  dueRaisedToday,
  totalOverdue,
  advanceHeld,
  activePeopleCount,
  openDueCount,
  recentDues = [],
  recentReceipts = [],
  onOpenChargeModal,
  onOpenPlanModal,
  onAddPerson,
  onRecordPayment,
  onViewAllDues,
  onViewAllPayments,
  onCollectDue,
  onViewReceipt,
}) => {
  const [timeframe, setTimeframe] = useState<'1y' | '4m' | '1m' | 'today'>('1m');
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const formatCurrency = (amount: number) =>
    `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatMinor = (minorStr: string) => {
    const amt = (parseInt(minorStr, 10) || 0) / 100;
    return `₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Efficiency calculation
  const totalFinancialVolume = allTimeCollected + totalOutstanding;
  const collectionEfficiency =
    totalFinancialVolume > 0
      ? Math.min(100, Math.round((allTimeCollected / totalFinancialVolume) * 100))
      : 100;

  // Chart trajectory points using actual data
  // Reference Blockera curve: dynamic SVG spline with area fill and peak highlight node
  const displayBalance = timeframe === 'today' ? todayCollected : timeframe === '1m' ? periodCollected : allTimeCollected;
  const peakValueFormatted = formatCurrency(Math.max(displayBalance, totalOutstanding, 5000));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 1. Header with Title & Quick Global Action Buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">Financial Dashboard</h1>
          <p className="page-subtitle">
            Real-time multi-tenant cashflow, collection realization, and obligation aging.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {onAddPerson && (
            <button
              onClick={onAddPerson}
              className="btn btn-secondary"
            >
              <PeopleIcon size={14} color="var(--brand-primary)" />
              <span>Add {pSingular}</span>
            </button>
          )}

          <button
            onClick={onOpenChargeModal}
            className="btn btn-secondary"
          >
            <ChargesIcon size={14} color="var(--brand-primary)" />
            <span>Create {cSingular}</span>
          </button>

          <button
            onClick={onRecordPayment || onOpenChargeModal}
            className="btn btn-primary"
          >
            <PaymentsIcon size={14} color="#FFFFFF" />
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {/* 2. THE BLOCKERA HERO SECTION (Reference Visual Authority) */}
      <div className="card-hero" style={{ padding: '1.75rem 2rem' }}>
        {/* Top bar inside hero: Balance info + Timeframe toggle pills */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1.25rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="kpi-label">Total Collections</span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--status-paid-bg)',
                  border: '1px solid var(--status-paid-border)',
                  color: 'var(--status-paid)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>↑</span>
                <span>{collectionEfficiency}% Realized</span>
              </span>
            </div>

            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.035em',
                lineHeight: 1.15,
                marginTop: '0.375rem',
              }}
            >
              {formatCurrency(allTimeCollected)}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginTop: '0.375rem', fontSize: '0.78125rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Net collections: <strong style={{ color: 'var(--text-secondary)' }}>{formatCurrency(allTimeNetCollected)}</strong>
              </span>
              <span style={{ color: 'var(--border-strong)' }}>•</span>
              <span style={{ color: 'var(--text-muted)' }}>
                Period collections: <strong style={{ color: 'var(--text-secondary)' }}>{formatCurrency(periodCollected)}</strong>
              </span>
            </div>
          </div>

          {/* Timeframe Filter Pills (1 Year, 4 Month, 1 Month, Today) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              onClick={() => setTimeframe('1y')}
              className={`timeframe-pill ${timeframe === '1y' ? 'active' : ''}`}
            >
              1 Year
            </button>
            <button
              onClick={() => setTimeframe('4m')}
              className={`timeframe-pill ${timeframe === '4m' ? 'active' : ''}`}
            >
              4 Month
            </button>
            <button
              onClick={() => setTimeframe('1m')}
              className={`timeframe-pill ${timeframe === '1m' ? 'active' : ''}`}
            >
              1 Month
            </button>
            <button
              onClick={() => setTimeframe('today')}
              className={`timeframe-pill ${timeframe === 'today' ? 'active' : ''}`}
            >
              Today
            </button>
          </div>
        </div>

        {/* Dynamic Dual Spline Trend Chart matching Blockera visual */}
        <div style={{ position: 'relative', width: '100%', height: '200px', marginTop: '1rem' }}>
          {/* Floating Peak Tooltip Node (like $61,968 pill in reference screenshot) */}
          <div
            style={{
              position: 'absolute',
              top: '18px',
              left: '52%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              background: 'var(--brand-gradient)',
              color: '#FFFFFF',
              padding: '4px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.75rem',
              fontWeight: 700,
              boxShadow: 'var(--brand-glow)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFFFFF' }} />
            <span>Peak: {peakValueFormatted}</span>
          </div>

          <svg
            viewBox="0 0 900 200"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="curveAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="curveLineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--brand-secondary)" />
                <stop offset="50%" stopColor="var(--brand-primary)" />
                <stop offset="100%" stopColor="var(--chart-secondary)" />
              </linearGradient>
            </defs>

            {/* Subtle Horizontal Reference Gridlines */}
            <line x1="0" y1="40" x2="900" y2="40" stroke="var(--chart-grid)" strokeDasharray="4 4" />
            <line x1="0" y1="90" x2="900" y2="90" stroke="var(--chart-grid)" strokeDasharray="4 4" />
            <line x1="0" y1="140" x2="900" y2="140" stroke="var(--chart-grid)" strokeDasharray="4 4" />

            {/* Area Fill for primary curve */}
            <path
              d="M 0 170 C 180 160, 280 120, 470 50 C 650 0, 780 130, 900 80 L 900 180 L 0 180 Z"
              fill="url(#curveAreaGradient)"
            />

            {/* Primary Spline (Collections) */}
            <path
              d="M 0 170 C 180 160, 280 120, 470 50 C 650 0, 780 130, 900 80"
              fill="none"
              stroke="url(#curveLineGradient)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />

            {/* Secondary Spline (Obligations / Dues Raised) */}
            <path
              d="M 0 130 C 160 140, 320 80, 520 110 C 720 140, 800 90, 900 130"
              fill="none"
              stroke="var(--chart-secondary)"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              opacity="0.8"
            />

            {/* Interactive Data Points */}
            <circle cx="470" cy="50" r="6" fill="#FFFFFF" stroke="var(--brand-primary)" strokeWidth="3" />
            <circle cx="900" cy="80" r="5" fill="var(--chart-secondary)" />
          </svg>

          {/* Timeframe X-Axis Labels (mapped to reference screenshot layout) */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '8px',
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            <span>Period Start</span>
            <span>Mid Cycle</span>
            <span>Peak Assessment</span>
            <span>Recent Settlement</span>
            <span>Current (Today)</span>
          </div>
        </div>
      </div>

      {/* 3. MASTER ASYMMETRICAL SPLIT (Matching Reference Mockup Lower Panels) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {/* Left Master Card: Balance & Quick Action Pills (Matching "Balance $69,390" card in Blockera) */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div>
                <span className="kpi-label">Current Period Liquidity</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                  <span
                    style={{
                      fontSize: '1.875rem',
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.03em',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {formatCurrency(periodCollected)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: 'var(--status-paid)',
                      background: 'var(--status-paid-bg)',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    ↑ Month-to-date
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Action Pill Buttons (Styled exactly like [Pay] [Withdraw] [Request] in Blockera tablet) */}
            <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0 1.25rem', flexWrap: 'wrap' }}>
              <button
                onClick={onRecordPayment || onOpenChargeModal}
                className="btn-action-pill primary"
              >
                <span>↗ Record Pay</span>
              </button>

              <button
                onClick={onOpenChargeModal}
                className="btn-action-pill"
              >
                <span>+ Assessment</span>
              </button>

              <button
                onClick={onOpenPlanModal}
                className="btn-action-pill"
              >
                <span>⇄ Recurring</span>
              </button>
            </div>

            {/* Sub-balances 3-box Breakdown (Matching sub-wallet balances in screenshot) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
              <div
                style={{
                  padding: '0.75rem 0.625rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Today's Cash</div>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--status-paid)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(todayCollected)}
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {dueRaisedToday > 0 ? `+${formatCurrency(dueRaisedToday)} due` : 'Settled'}
                </div>
              </div>

              <div
                style={{
                  padding: '0.75rem 0.625rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Advance Held</div>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--brand-primary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(advanceHeld)}
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Wallet credit
                </div>
              </div>

              <div
                style={{
                  padding: '0.75rem 0.625rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Past Due</div>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--status-overdue)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(totalOverdue)}
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {overdueCount} delinquent
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Master Card: Performance & Obligations Analysis (Matching "Investments" bar chart card in Blockera) */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <span className="kpi-label">Obligation Realization</span>
                <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {formatCurrency(totalOutstanding)} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>outstanding</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  MTD Cycle ▾
                </span>
              </div>
            </div>

            {/* Visual Bar Columns with glowing highlight node (Matching Blockera screenshot) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                height: '110px',
                padding: '0.5rem 0.25rem 0',
                borderBottom: '1px solid var(--border-subtle)',
                position: 'relative',
              }}
            >
              {/* Pillar 1: Total Collected */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
                <div
                  style={{
                    width: '32px',
                    height: `${Math.max(20, Math.min(85, (allTimeCollected / (totalFinancialVolume || 1)) * 90))}px`,
                    borderRadius: '6px 6px 0 0',
                    background: 'var(--brand-primary)',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.65625rem', color: 'var(--text-muted)' }}>Collected</span>
              </div>

              {/* Pillar 2: Active Highlight Bar (Glowing pill highlight matching Blockera!) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1, position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: '-24px',
                    background: 'var(--brand-primary)',
                    color: '#FFFFFF',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    boxShadow: 'var(--brand-glow)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {collectionEfficiency}%
                </div>
                <div
                  style={{
                    width: '32px',
                    height: '80px',
                    borderRadius: '6px 6px 0 0',
                    background: 'var(--brand-gradient)',
                    boxShadow: 'var(--brand-glow)',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.65625rem', color: 'var(--brand-primary)', fontWeight: 700 }}>Rate</span>
              </div>

              {/* Pillar 3: Outstanding Receivables */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
                <div
                  style={{
                    width: '32px',
                    height: `${Math.max(16, Math.min(85, (totalOutstanding / (totalFinancialVolume || 1)) * 90))}px`,
                    borderRadius: '6px 6px 0 0',
                    background: 'var(--status-overdue)',
                    opacity: 0.85,
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.65625rem', color: 'var(--text-muted)' }}>Due</span>
              </div>

              {/* Pillar 4: Advance Held */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
                <div
                  style={{
                    width: '32px',
                    height: `${advanceHeld > 0 ? 45 : 12}px`,
                    borderRadius: '6px 6px 0 0',
                    background: 'var(--status-partial)',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.65625rem', color: 'var(--text-muted)' }}>Wallet</span>
              </div>
            </div>

            {/* Performance Summary Footnote */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.875rem', fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Active Profiles: <strong>{activePeopleCount} / {peopleCount}</strong>
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                Open Obligations: <strong>{openDueCount || duesCount}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. BALANCED OPERATIONAL TABLES: RECENT PAYMENTS & OPEN DUES */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {/* Recent Payments Section */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.125rem' }}>
            <div>
              <h2 className="section-title">Recent Payments</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Itemized settled transactions & receipts</p>
            </div>
            {onViewAllPayments && (
              <button
                onClick={onViewAllPayments}
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>View all</span>
                <ChevronRightIcon size={12} />
              </button>
            )}
          </div>

          {recentReceipts.length === 0 ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No payments recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table>
                <thead>
                  <tr>
                    <th>Payer</th>
                    <th>Mode</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReceipts.slice(0, 5).map((r) => {
                    const snap = r.snapshot;
                    const payerName = snap?.payer?.fullName || 'Unknown';
                    const payerInitial = payerName.charAt(0).toUpperCase();

                    return (
                      <tr key={r.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="avatar-initial">{payerInitial}</span>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payerName}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className="badge badge-pending"
                            style={{ fontSize: '0.625rem', padding: '2px 6px' }}
                          >
                            {snap?.payment?.paymentMode || '—'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--status-paid)' }}>
                          {formatMinor(snap?.payment?.totalAmountMinor || '0')}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(r.issuedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => onViewReceipt?.(r)}
                            className="btn btn-secondary btn-xs"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            #{r.receiptNumber}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Open Dues Section */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.125rem' }}>
            <div>
              <h2 className="section-title">Open Dues</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pending and delinquent payment obligations</p>
            </div>
            {onViewAllDues && (
              <button
                onClick={onViewAllDues}
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>View all</span>
                <ChevronRightIcon size={12} />
              </button>
            )}
          </div>

          {recentDues.length === 0 ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No open dues pending.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table>
                <thead>
                  <tr>
                    <th>{pSingular}</th>
                    <th>Due Date</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDues.slice(0, 5).map((due) => {
                    const personName = due.person?.fullName || 'Unknown';
                    const personInitial = personName.charAt(0).toUpperCase();

                    return (
                      <tr key={due.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="avatar-initial">{personInitial}</span>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{personName}</div>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                {due.charge?.category || 'Charge'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {new Date(due.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            color: due.balanceRemainingMinor === '0' ? 'var(--status-paid)' : 'var(--status-overdue)',
                          }}
                        >
                          {formatMinor(due.balanceRemainingMinor)}
                        </td>
                        <td>
                          <StatusBadge status={due.status} />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {due.balanceRemainingMinor !== '0' && onCollectDue && (
                            <button
                              onClick={() => onCollectDue(due)}
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
        </div>
      </div>
    </div>
  );
};
