import React from 'react';

export type StatusType =
  | 'PAID'
  | 'OVERDUE'
  | 'PARTIALLY_PAID'
  | 'PENDING'
  | 'VOIDED'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'CANCELLED'
  | 'PAUSED'
  | 'SUCCESS'
  | 'FAILED'
  | string;

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  showDot?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, showDot = true }) => {
  const norm = (status || '').toUpperCase();
  const displayLabel = label || norm.replace(/_/g, ' ');

  let badgeClass = 'badge badge-pending';
  let dotClass = 'status-dot status-dot-pending';

  if (['PAID', 'ACTIVE', 'SUCCESS'].includes(norm)) {
    badgeClass = 'badge badge-paid';
    dotClass = 'status-dot status-dot-paid';
  } else if (['OVERDUE', 'FAILED'].includes(norm)) {
    badgeClass = 'badge badge-overdue';
    dotClass = 'status-dot status-dot-overdue';
  } else if (['PARTIALLY_PAID', 'PARTIAL', 'PAUSED'].includes(norm)) {
    badgeClass = 'badge badge-partial';
    dotClass = 'status-dot status-dot-partial';
  } else if (['VOIDED', 'INACTIVE', 'CANCELLED'].includes(norm)) {
    badgeClass = 'badge badge-voided';
    dotClass = 'status-dot';
  }

  return (
    <span className={badgeClass}>
      {showDot && <span className={dotClass} />}
      <span>{displayLabel}</span>
    </span>
  );
};
