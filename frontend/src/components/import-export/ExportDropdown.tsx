import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useExports, ExportEntity } from '../../features/exports/useExports.js';
import { DownloadIcon } from '../common/Icons.js';

interface Props {
  tenantId: string;
}

export const ExportDropdown: React.FC<Props> = ({ tenantId }) => {
  const { downloadExport, isExporting, exportError } = useExports(tenantId);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = useCallback(async (entity: ExportEntity) => {
    setIsOpen(false);
    await downloadExport(entity);
  }, [downloadExport]);

  const entities: { value: ExportEntity; label: string; description: string }[] = [
    { value: 'people', label: 'People Directory', description: 'All people with contacts & advance balances' },
    { value: 'dues', label: 'Dues Ledger', description: 'All active and historic dues with status' },
    { value: 'payments', label: 'Payment Transactions', description: 'Audited collections & references' },
    { value: 'reports', label: 'Financial Reports', description: 'Aggregated collection statements' },
  ];

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="btn btn-secondary"
        style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}
      >
        <DownloadIcon size={14} />
        <span>{isExporting ? 'Exporting…' : 'Export Data ▼'}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 100,
            minWidth: '220px',
            background: '#FFFFFF',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
          }}
        >
          {entities.map((entity) => (
            <button
              key={entity.value}
              onClick={() => handleExport(entity.value)}
              disabled={isExporting}
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                textAlign: 'left',
                background: '#FFFFFF',
                border: 'none',
                borderBottom: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#FFFFFF';
              }}
            >
              <div style={{ fontWeight: 600 }}>{entity.label}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{entity.description}</div>
            </button>
          ))}
        </div>
      )}

      {exportError && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--status-overdue-bg)',
            border: '1px solid var(--status-overdue-border)',
            color: 'var(--status-overdue)',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            zIndex: 101,
            whiteSpace: 'nowrap',
          }}
        >
          {exportError}
        </div>
      )}
    </div>
  );
};
