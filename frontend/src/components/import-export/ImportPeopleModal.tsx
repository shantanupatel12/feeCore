import React, { useState, useCallback } from 'react';
import { useImportPeopleModal } from '../../features/imports/useImportPeopleModal.js';
import { CloseIcon, DownloadIcon } from '../common/Icons.js';

interface Props {
  tenantId: string;
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export const ImportPeopleModal: React.FC<Props> = ({ tenantId, isOpen, onClose, onImportComplete }) => {
  const {
    csvText,
    csvFile,
    errors,
    isProcessing,
    result,
    handleFileChange,
    handleCsvChange,
    validateCsv,
    processImport,
    reset,
  } = useImportPeopleModal({ tenantId });

  const [step, setStep] = useState<'upload' | 'confirm'>('upload');

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChange(e);
    setStep('confirm');
  }, [handleFileChange]);

  const handleSubmit = useCallback(async () => {
    const success = await processImport();
    if (success) {
      onImportComplete();
      setTimeout(() => {
        onClose();
        reset();
        setStep('upload');
      }, 1500);
    }
  }, [processImport, onImportComplete, onClose, reset]);

  const handleRetry = () => {
    reset();
    setStep('upload');
  };

  if (!isOpen) return null;

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
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '2rem',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Import People via CSV
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Batch upload contacts and payer records</p>
          </div>
          <button
            onClick={() => { onClose(); reset(); setStep('upload'); }}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.25rem' }}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div>
          {step === 'upload' && (
            <div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Upload a CSV file containing contact records. Required columns: <code style={{ background: 'var(--bg-secondary)', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-xs)', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>name</code>, and either <code style={{ background: 'var(--bg-secondary)', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-xs)', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>email</code> or <code style={{ background: 'var(--bg-secondary)', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-xs)', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>phone</code>.
              </p>

              <div
                style={{
                  border: '2px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '2.5rem 1.5rem',
                  textAlign: 'center',
                  background: 'var(--bg-secondary)',
                  cursor: 'pointer',
                  transition: 'border-color var(--transition-fast)',
                }}
                onClick={() => document.getElementById('csv-upload-input')?.click()}
              >
                <input
                  id="csv-upload-input"
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelected}
                  style={{ display: 'none' }}
                />
                <div style={{ color: 'var(--brand-primary)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                  <DownloadIcon size={28} />
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  Click to browse or drop CSV here
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {csvFile?.name ?? 'Standard UTF-8 CSV formatted file'}
                </div>
              </div>

              {errors.length > 0 && (
                <div
                  style={{
                    marginTop: '1rem',
                    background: 'var(--status-overdue-bg)',
                    border: '1px solid var(--status-overdue-border)',
                    color: 'var(--status-overdue)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8125rem',
                  }}
                >
                  {errors.map((err, i) => (
                    <div key={i}>
                      Row {err.row}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && (
            <div>
              {csvFile && (
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    fontSize: '0.8125rem',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>File Selected:</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{csvFile.name}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>File Size:</span>
                    <span style={{ color: 'var(--text-muted)' }}>{(csvFile.size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              )}

              {errors.length > 0 && (
                <div
                  style={{
                    background: 'var(--status-overdue-bg)',
                    border: '1px solid var(--status-overdue-border)',
                    color: 'var(--status-overdue)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '1rem',
                    fontSize: '0.8125rem',
                    maxHeight: '160px',
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>{errors.length} validation error(s):</div>
                  {errors.map((err, i) => (
                    <div key={i}>Row {err.row}: {err.message}</div>
                  ))}
                </div>
              )}

              {isProcessing && (
                <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Processing batch records… Please wait.
                </div>
              )}

              {result && (
                <div
                  style={{
                    background: result.failureCount > 0 ? 'var(--status-partial-bg)' : 'var(--status-paid-bg)',
                    border: `1px solid ${result.failureCount > 0 ? 'var(--status-partial-border)' : 'var(--status-paid-border)'}`,
                    color: result.failureCount > 0 ? 'var(--status-partial)' : 'var(--status-paid)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '1rem',
                    fontSize: '0.8125rem',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Import Complete</div>
                  <div>Total: {result.totalRows} | Succeeded: {result.successCount} | Failed: {result.failureCount}</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  onClick={handleRetry}
                  disabled={isProcessing}
                  className="btn btn-secondary"
                >
                  Back
                </button>
                <button
                  onClick={() => validateCsv()}
                  disabled={isProcessing || !csvText}
                  className="btn btn-secondary"
                >
                  Validate
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isProcessing || errors.length > 0}
                  className="btn btn-primary"
                >
                  {isProcessing ? 'Importing…' : 'Execute Import'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
