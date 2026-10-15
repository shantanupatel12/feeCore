import React, { useState, useCallback } from 'react';
import { useReports } from '../features/reports/useReports.js';
import { UserRole } from '@feecore/shared-types';
import { CollectionReport, CollectionReportControls, DuesReport } from './reports/DuesReport.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { SearchBar } from './search/SearchBar.js';
import { ImportPeopleModal } from './import-export/ImportPeopleModal.js';
import { ExportDropdown } from './import-export/ExportDropdown.js';
import { ActivityLog } from './activity/ActivityLog.js';

interface Props {
  tenantId: string;
  userRole?: UserRole;
}

interface SearchSectionProps {
  tenantId: string;
  userRole?: UserRole;
  showImportModal: boolean;
  onOpenImportModal: () => void;
  onCloseImportModal: () => void;
  onImportComplete: () => void;
}

export const ReportsPageSection: React.FC<Props> = ({ tenantId, userRole }) => {
  return (
    <div className="card" style={{ padding: '1.75rem' }}>
      <div style={{ marginBottom: '1.5rem', paddingBottom: '0.875rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="section-title" style={{ fontSize: '1.375rem' }}>
          Audited Financial Reports
        </h2>
        <p className="page-subtitle">
          Audited statements of gross and net collections, refunds, and due obligations.
        </p>
      </div>

      <CollectionReportContent tenantId={tenantId} userRole={userRole} />
    </div>
  );
};

const CollectionReportContent: React.FC<{ tenantId: string; userRole?: UserRole }> = ({ tenantId, userRole }) => {
  const {
    filters,
    setFilters,
    collectionReport,
    duesReport,
    isLoadingCollection,
    isLoadingDues,
    generateCollectionReport,
    generateDuesReport,
    paymentModes,
  } = useReports(tenantId);

  const [activeReport, setActiveReport] = useState<'collection' | 'dues'>('collection');

  const handleApplyCollection = useCallback(() => {
    generateCollectionReport();
  }, [generateCollectionReport]);

  const handleApplyDues = useCallback(() => {
    generateDuesReport();
  }, [generateDuesReport]);

  return (
    <div>
      <div
        style={{
          display: 'inline-flex',
          gap: '4px',
          padding: '4px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
      >
        <button
          onClick={() => setActiveReport('collection')}
          className={`timeframe-pill ${activeReport === 'collection' ? 'active' : ''}`}
          style={{ padding: '6px 14px', fontSize: '0.78125rem' }}
        >
          Collection Report
        </button>
        <button
          onClick={() => setActiveReport('dues')}
          className={`timeframe-pill ${activeReport === 'dues' ? 'active' : ''}`}
          style={{ padding: '6px 14px', fontSize: '0.78125rem' }}
        >
          Dues Aging Report
        </button>
      </div>

      {activeReport === 'collection' && (
        <>
          <CollectionReportControls
            filters={filters}
            onChange={(newFilters) => {
              setFilters(newFilters);
              generateCollectionReport();
            }}
            paymentModes={paymentModes}
          />
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <button
              onClick={handleApplyCollection}
              disabled={isLoadingCollection}
              className="btn btn-primary"
            >
              {isLoadingCollection ? 'Generating Report…' : 'Generate Collection Report'}
            </button>
          </div>
          <CollectionReport data={collectionReport} isLoading={isLoadingCollection} />
        </>
      )}

      {activeReport === 'dues' && (
        <>
          <CollectionReportControls
            filters={filters}
            onChange={(newFilters) => {
              setFilters(newFilters);
              generateDuesReport();
            }}
            paymentModes={paymentModes}
          />
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <button
              onClick={handleApplyDues}
              disabled={isLoadingDues}
              className="btn btn-primary"
            >
              {isLoadingDues ? 'Generating Report…' : 'Generate Dues Report'}
            </button>
          </div>
          <DuesReport data={duesReport} isLoading={isLoadingDues} />
        </>
      )}
    </div>
  );
};

export const SearchSection: React.FC<SearchSectionProps> = ({
  tenantId,
  userRole,
  showImportModal,
  onOpenImportModal,
  onCloseImportModal,
  onImportComplete,
}) => {
  return (
    <div className="card" style={{ padding: '1.75rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ fontSize: '1.125rem' }}>
            Quick Operations
          </h2>
          <p className="page-subtitle">Batch data management and record lookup</p>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
          {userRole === 'ROLE_ADMIN' && (
            <button
              onClick={onOpenImportModal}
              className="btn btn-secondary"
            >
              Import People CSV
            </button>
          )}
          {userRole === 'ROLE_ADMIN' && <ExportDropdown tenantId={tenantId} />}
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <SearchBar tenantId={tenantId} />
      </div>

      <ImportPeopleModal
        tenantId={tenantId}
        isOpen={showImportModal}
        onClose={onCloseImportModal}
        onImportComplete={onImportComplete}
      />
    </div>
  );
};

export const SettingsSection: React.FC<Props> = ({ tenantId, userRole }) => {
  return <SettingsPage tenantId={tenantId} userRole={userRole} />;
};

export const ActivitySection: React.FC<Props> = ({ tenantId, userRole }) => {
  return (
    <div className="card" style={{ padding: '1.75rem' }}>
      <div style={{ marginBottom: '1.5rem', paddingBottom: '0.875rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="section-title" style={{ fontSize: '1.375rem' }}>
          Activity & Audit Ledger
        </h2>
        <p className="page-subtitle">
          Chronological audit trail of all operational events, charge creations, collections, and refunds.
        </p>
      </div>
      <ActivityLog tenantId={tenantId} userRole={userRole} />
    </div>
  );
};

export { CollectionReport, CollectionReportControls, DuesReport };
export type { Props };
