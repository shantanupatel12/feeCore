import React, { useState } from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { PersonDto, UserRole } from '@feecore/shared-types';
import { StatusBadge } from '../common/StatusBadge.js';
import { PlusIcon, SearchIcon, DownloadIcon, CloseIcon } from '../common/Icons.js';

interface Props {
  people: PersonDto[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onAddPerson: () => void;
  onEditPerson: (person: PersonDto) => void;
  onDeactivatePerson: (person: PersonDto) => void;
  userRole?: UserRole;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
  error?: string | null;
  onOpenImport?: () => void;
  exportElement?: React.ReactNode;
}

export const PeopleTable: React.FC<Props> = ({
  people,
  searchTerm,
  onSearchChange,
  onAddPerson,
  onEditPerson,
  onDeactivatePerson,
  userRole,
  pagination,
  onPageChange,
  isLoading,
  error,
  onOpenImport,
  exportElement,
}) => {
  const { pSingular, pPlural } = useTerminology();
  const canManagePeople = userRole === 'ROLE_ADMIN' || userRole === 'ROLE_COLLECTOR';
  const canManageStatus = userRole === 'ROLE_ADMIN';
  const [deactivatingPerson, setDeactivatingPerson] = useState<PersonDto | null>(null);
  const [isSubmittingDeactivation, setIsSubmittingDeactivation] = useState(false);

  const formatCurrency = (minorUnitsStr: string) => {
    const amount = (parseInt(minorUnitsStr, 10) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="card" style={{ padding: '1.75rem' }}>
      {/* Header with Title and Actions */}
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
            {pPlural} Directory
          </h2>
          <p className="page-subtitle">
            Manage enrolled payer profiles, contact details, and advance wallet balances.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {onOpenImport && userRole === 'ROLE_ADMIN' && (
            <button
              onClick={onOpenImport}
              className="btn btn-secondary"
            >
              <DownloadIcon size={14} color="var(--text-secondary)" />
              <span>Import CSV</span>
            </button>
          )}

          {exportElement}

          {canManagePeople && (
            <button
              onClick={onAddPerson}
              disabled={isLoading}
              className="btn btn-primary"
            >
              <PlusIcon size={14} color="#FFFFFF" />
              <span>Add {pSingular}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
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
          placeholder={`Search ${pPlural.toLowerCase()} by name, phone, email...`}
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
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
          Loading {pPlural.toLowerCase()} directory…
        </div>
      )}

      {!isLoading && people.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No {pPlural.toLowerCase()} found</div>
          <div className="empty-state-desc">
            Get started by adding a new {pSingular.toLowerCase()} or importing existing records via CSV.
          </div>
          {canManagePeople && (
            <button
              onClick={onAddPerson}
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
            >
              <PlusIcon size={14} color="#FFFFFF" />
              <span>Add First {pSingular}</span>
            </button>
          )}
        </div>
      )}

      {!isLoading && people.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Primary Contact</th>
                <th>Email Address</th>
                <th>Advance Balance</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const initial = person.fullName.charAt(0).toUpperCase();
                return (
                  <tr key={person.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="avatar-initial">{initial}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{person.fullName}</div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>ID: {person.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {person.primaryPhone || '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {person.email || '—'}
                    </td>
                    <td style={{ color: 'var(--brand-primary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(person.advanceBalanceMinor)}
                    </td>
                    <td>
                      <StatusBadge status={person.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.375rem' }}>
                        {canManagePeople && (
                          <button
                            onClick={() => onEditPerson(person)}
                            className="btn btn-secondary btn-xs"
                            title="Edit profile"
                          >
                            Edit
                          </button>
                        )}
                        {canManageStatus && (
                          <button
                            onClick={() => setDeactivatingPerson(person)}
                            className="btn btn-secondary btn-xs"
                            style={{
                              color: person.status === 'INACTIVE' ? 'var(--text-muted)' : 'var(--status-overdue)',
                              cursor: person.status === 'INACTIVE' ? 'default' : 'pointer',
                              opacity: person.status === 'INACTIVE' ? 0.5 : 1,
                            }}
                            disabled={person.status === 'INACTIVE'}
                            title="Deactivate"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
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
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} records
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
      {/* Deactivation Confirmation Dialog */}
      {deactivatingPerson && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(37, 34, 31, 0.55)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '460px',
              padding: '1.75rem',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Confirm Deactivation
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Deactivate {pSingular.toLowerCase()} profile
                </p>
              </div>
              <button
                onClick={() => { if (!isSubmittingDeactivation) setDeactivatingPerson(null); }}
                disabled={isSubmittingDeactivation}
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.25rem' }}
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <div
              style={{
                background: 'var(--status-overdue-bg)',
                border: '1px solid var(--status-overdue-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.875rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.8125rem',
                color: 'var(--text-primary)',
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to deactivate <strong>{deactivatingPerson.fullName}</strong>?
              <div style={{ marginTop: '0.375rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                This {pSingular.toLowerCase()} will become <strong>inactive</strong>. They will no longer be eligible for new charges or automated dues generation. Existing financial transactions, payments, and receipt history will remain preserved.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setDeactivatingPerson(null)}
                disabled={isSubmittingDeactivation}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!deactivatingPerson || isSubmittingDeactivation) return;
                  setIsSubmittingDeactivation(true);
                  try {
                    await Promise.resolve(onDeactivatePerson(deactivatingPerson));
                    setDeactivatingPerson(null);
                  } finally {
                    setIsSubmittingDeactivation(false);
                  }
                }}
                disabled={isSubmittingDeactivation}
                className="btn btn-danger"
              >
                {isSubmittingDeactivation ? 'Deactivating…' : `Deactivate ${pSingular}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
