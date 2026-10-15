import React from 'react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  badge?: React.ReactNode;
  valueColor?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  size?: 'default' | 'compact' | 'large';
  trend?: { value: string; positive: boolean };
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  subtitle,
  badge,
  valueColor = 'var(--text-primary)',
  onClick,
  style,
  size = 'default',
  trend,
}) => {
  const isLarge = size === 'large';
  const isCompact = size === 'compact';

  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        padding: isCompact ? '1rem 1.25rem' : isLarge ? '1.75rem' : '1.25rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)',
        minHeight: isCompact ? '90px' : isLarge ? '140px' : '115px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isCompact ? '0.375rem' : '0.5rem' }}>
        <span className="kpi-label">{title}</span>
        {badge}
      </div>
      <div>
        <div
          className={isLarge ? 'kpi-value kpi-value-lg' : isCompact ? 'kpi-value' : 'kpi-value'}
          style={{
            color: valueColor,
            fontSize: isLarge ? '2.25rem' : isCompact ? '1.5rem' : '1.875rem',
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
          }}
        >
          {value}
        </div>
        {trend && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '0.375rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: trend.positive ? 'var(--status-paid)' : 'var(--status-overdue)',
            }}
          >
            {trend.positive ? '▲' : '▼'}
            <span>{trend.value}</span>
          </div>
        )}
        {subtitle && !trend && (
          <div className="kpi-subtitle">{subtitle}</div>
        )}
        {subtitle && trend && (
          <div className="kpi-subtitle" style={{ marginTop: '0.25rem' }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
};