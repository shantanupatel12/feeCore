import React, { useState, useEffect } from 'react';
import { useSettings } from '../../features/settings/useSettings.js';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import {
  OrganizationProfileDto,
  ReceiptConfigDto,
  TerminologyDto,
  UpdateOrganizationProfileRequest,
  UpdateReceiptConfigRequest,
  UpdateTerminologyRequest,
  CreateCustomFieldRequest,
  UpdateCustomFieldRequest,
  UserRole,
} from '@feecore/shared-types';
import { BuildingIcon, SettingsIcon, PlusIcon } from '../common/Icons.js';

interface Props {
  tenantId: string;
  userRole?: UserRole;
}

export const SettingsPage: React.FC<Props> = ({ tenantId, userRole }) => {
  const {
    profile,
    receiptConfig,
    terminology,
    customFields,
    isLoading,
    error,
    isSaving,
    saveError,
    fetchProfile,
    updateProfile,
    fetchReceiptConfig,
    updateReceiptConfig,
    fetchTerminology,
    updateTerminology,
    fetchCustomFields,
    createCustomField,
    deleteCustomField,
  } = useSettings(tenantId);

  const { setTerminology: setGlobalTerminology } = useTerminology();
  const [activeCategory, setActiveCategory] = useState<'organization' | 'terminology' | 'customFields' | 'receipts'>('organization');

  useEffect(() => {
    if (tenantId) {
      fetchProfile();
      fetchReceiptConfig();
      fetchTerminology();
      fetchCustomFields();
    }
  }, [tenantId, fetchProfile, fetchReceiptConfig, fetchTerminology, fetchCustomFields]);

  const canEdit = userRole === 'ROLE_ADMIN';

  const [orgForm, setOrgForm] = useState<Partial<OrganizationProfileDto>>({});
  const [termForm, setTermForm] = useState<Partial<TerminologyDto>>({});
  const [receiptForm, setReceiptForm] = useState<Partial<ReceiptConfigDto>>({});
  const [customFieldForm, setCustomFieldForm] = useState<{ fieldKey: string; fieldLabel: string; dataType: string; isRequired: boolean; options: string }>({ fieldKey: '', fieldLabel: '', dataType: 'TEXT', isRequired: false, options: '' });

  useEffect(() => {
    if (profile) setOrgForm(profile);
  }, [profile]);

  useEffect(() => {
    if (terminology) setTermForm({
      personLabelSingular: terminology.personLabelSingular,
      personLabelPlural: terminology.personLabelPlural,
      chargeLabelSingular: terminology.chargeLabelSingular,
      chargeLabelPlural: terminology.chargeLabelPlural,
    });
  }, [terminology]);

  useEffect(() => {
    if (receiptConfig) setReceiptForm({
      receiptPrefix: receiptConfig.receiptPrefix,
      receiptFooterText: receiptConfig.receiptFooterText ?? '',
      logoUrl: receiptConfig.logoUrl ?? '',
    });
  }, [receiptConfig]);

  const handleSaveOrg = async () => {
    try {
      await updateProfile({
        name: orgForm.name ?? '',
        address: orgForm.address ?? undefined,
        taxId: orgForm.taxId ?? undefined,
        logoUrl: orgForm.logoUrl ?? undefined,
        currency: orgForm.currency ?? undefined,
        timezone: orgForm.timezone ?? undefined,
      } as UpdateOrganizationProfileRequest);
    } catch {}
  };

  const handleSaveTerms = async () => {
    try {
      await updateTerminology({
        personLabelSingular: termForm.personLabelSingular,
        personLabelPlural: termForm.personLabelPlural,
        chargeLabelSingular: termForm.chargeLabelSingular,
        chargeLabelPlural: termForm.chargeLabelPlural,
      } as UpdateTerminologyRequest);
      if (terminology) {
        setGlobalTerminology({
          personLabelSingular: termForm.personLabelSingular ?? 'Person',
          personLabelPlural: termForm.personLabelPlural ?? 'People',
          chargeLabelSingular: termForm.chargeLabelSingular ?? 'Charge',
          chargeLabelPlural: termForm.chargeLabelPlural ?? 'Charges',
        });
      }
    } catch {}
  };

  const handleSaveReceiptConfig = async () => {
    try {
      await updateReceiptConfig({
        receiptPrefix: receiptForm.receiptPrefix,
        receiptFooterText: receiptForm.receiptFooterText,
        logoUrl: receiptForm.logoUrl,
      } as UpdateReceiptConfigRequest);
    } catch {}
  };

  const handleCreateCustomField = async () => {
    try {
      const data: CreateCustomFieldRequest = {
        fieldKey: customFieldForm.fieldKey,
        fieldLabel: customFieldForm.fieldLabel,
        dataType: customFieldForm.dataType as any,
        isRequired: customFieldForm.isRequired,
        options: customFieldForm.dataType === 'SELECT' && customFieldForm.options
          ? customFieldForm.options.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      };
      await createCustomField(data);
      setCustomFieldForm({ fieldKey: '', fieldLabel: '', dataType: 'TEXT', isRequired: false, options: '' });
      fetchCustomFields();
    } catch {}
  };

  const handleDeleteCustomField = async (id: string) => {
    if (!window.confirm('Delete this custom field? This cannot be undone.')) return;
    try {
      await deleteCustomField(id);
    } catch {}
  };

  const categories = [
    { id: 'organization', label: 'Organization Profile', description: 'Name, address, tax ID & currency' },
    { id: 'terminology', label: 'Custom Terminology', description: 'Payer and fee entity naming' },
    { id: 'customFields', label: 'Custom Fields', description: 'User-defined profile attributes' },
    { id: 'receipts', label: 'Receipt Configuration', description: 'Numbering sequence, prefix & footer' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure organization parameters, nomenclature, and system templates.</p>
        </div>
        {!canEdit && (
          <span className="badge badge-pending">Read-Only Access</span>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--status-overdue-bg)', border: '1px solid var(--status-overdue-border)', color: 'var(--status-overdue)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Two-Column Settings Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gap: '1.5rem',
          alignItems: 'start',
        }}
        className="settings-layout-grid"
      >
        {/* Left: Category Navigation */}
        <div className="card" style={{ padding: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {categories.map((cat) => {
              const isSelected = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    background: isSelected ? 'var(--brand-primary-subtle)' : 'transparent',
                    border: isSelected ? '1px solid var(--brand-primary-border)' : '1px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--bg-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span style={{ fontSize: '0.84375rem', fontWeight: isSelected ? 700 : 600, color: isSelected ? 'var(--brand-primary)' : 'var(--text-primary)' }}>
                    {cat.label}
                  </span>
                  <span style={{ fontSize: '0.71875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                    {cat.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Active Category Form Content */}
        <div className="card" style={{ padding: '1.75rem' }}>
          {/* Organization Profile */}
          {activeCategory === 'organization' && (
            <div>
              <div style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <h2 className="section-title">Organization Profile</h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Legal entity details, primary currency, and contact metadata.
                </p>
              </div>

              {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading settings…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Organization Name</label>
                      <input
                        type="text"
                        value={orgForm.name ?? ''}
                        onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Tax / Registration ID</label>
                      <input
                        type="text"
                        value={orgForm.taxId ?? ''}
                        onChange={(e) => setOrgForm({ ...orgForm, taxId: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Physical Address</label>
                    <textarea
                      value={orgForm.address ?? ''}
                      onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                      disabled={!canEdit || isSaving}
                      rows={2}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Currency</label>
                      <input
                        type="text"
                        value={orgForm.currency ?? 'INR'}
                        onChange={(e) => setOrgForm({ ...orgForm, currency: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Timezone</label>
                      <input
                        type="text"
                        value={orgForm.timezone ?? 'Asia/Kolkata'}
                        onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Logo URL</label>
                    <input
                      type="text"
                      value={orgForm.logoUrl ?? ''}
                      onChange={(e) => setOrgForm({ ...orgForm, logoUrl: e.target.value })}
                      disabled={!canEdit || isSaving}
                      placeholder="https://..."
                      style={{ width: '100%' }}
                    />
                  </div>

                  {canEdit && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <button
                        onClick={handleSaveOrg}
                        disabled={isSaving}
                        className="btn btn-primary"
                      >
                        {isSaving ? 'Saving…' : 'Save Organization'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Custom Terminology */}
          {activeCategory === 'terminology' && (
            <div>
              <div style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <h2 className="section-title">Custom Terminology</h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Tailor domain labels to your industry (e.g., Student/Fee, Resident/Maintenance, Member/Dues).
                </p>
              </div>

              {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading terminology…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Person Label (Singular)</label>
                      <input
                        type="text"
                        value={termForm.personLabelSingular ?? ''}
                        onChange={(e) => setTermForm({ ...termForm, personLabelSingular: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Person Label (Plural)</label>
                      <input
                        type="text"
                        value={termForm.personLabelPlural ?? ''}
                        onChange={(e) => setTermForm({ ...termForm, personLabelPlural: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Charge Label (Singular)</label>
                      <input
                        type="text"
                        value={termForm.chargeLabelSingular ?? ''}
                        onChange={(e) => setTermForm({ ...termForm, chargeLabelSingular: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Charge Label (Plural)</label>
                      <input
                        type="text"
                        value={termForm.chargeLabelPlural ?? ''}
                        onChange={(e) => setTermForm({ ...termForm, chargeLabelPlural: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  {canEdit && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <button
                        onClick={handleSaveTerms}
                        disabled={isSaving}
                        className="btn btn-primary"
                      >
                        {isSaving ? 'Saving…' : 'Save Terminology'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Custom Fields */}
          {activeCategory === 'customFields' && (
            <div>
              <div style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <h2 className="section-title">Custom Field Definitions</h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Extend payer profiles with custom fields such as Roll Numbers, Department, or Flat Numbers.
                </p>
              </div>

              {saveError && (
                <div style={{ background: 'var(--status-overdue-bg)', border: '1px solid var(--status-overdue-border)', color: 'var(--status-overdue)', padding: '0.625rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.8125rem' }}>
                  {saveError}
                </div>
              )}

              {canEdit && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', border: '1px solid var(--border-subtle)', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>Create New Custom Field</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Field Key</label>
                      <input
                        type="text"
                        value={customFieldForm.fieldKey}
                        onChange={(e) => setCustomFieldForm({ ...customFieldForm, fieldKey: e.target.value })}
                        placeholder="e.g. flat_no"
                        disabled={isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Field Label</label>
                      <input
                        type="text"
                        value={customFieldForm.fieldLabel}
                        onChange={(e) => setCustomFieldForm({ ...customFieldForm, fieldLabel: e.target.value })}
                        placeholder="e.g. Flat Number"
                        disabled={isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Data Type</label>
                      <select
                        value={customFieldForm.dataType}
                        onChange={(e) => setCustomFieldForm({ ...customFieldForm, dataType: e.target.value })}
                        disabled={isSaving}
                        style={{ width: '100%' }}
                      >
                        <option value="TEXT">Text</option>
                        <option value="NUMBER">Number</option>
                        <option value="DATE">Date</option>
                        <option value="SELECT">Dropdown Select</option>
                        <option value="BOOLEAN">Boolean</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={customFieldForm.isRequired}
                        onChange={(e) => setCustomFieldForm({ ...customFieldForm, isRequired: e.target.checked })}
                        disabled={isSaving}
                      />
                      <span>Mandatory Field</span>
                    </label>

                    <button
                      onClick={handleCreateCustomField}
                      disabled={isSaving || !customFieldForm.fieldKey || !customFieldForm.fieldLabel}
                      className="btn btn-primary btn-sm"
                    >
                      <PlusIcon size={14} color="#FFFFFF" />
                      <span>{isSaving ? 'Creating…' : 'Create Field'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Custom Fields List */}
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                Defined Custom Attributes
              </div>

              {customFields.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  No custom attributes defined yet.
                </div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Label</th>
                        <th>Data Type</th>
                        <th>Required</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customFields.map((field) => (
                        <tr key={field.id}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{field.fieldKey}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{field.fieldLabel}</td>
                          <td>
                            <span className="badge badge-pending" style={{ fontSize: '0.625rem' }}>{field.dataType}</span>
                          </td>
                          <td>{field.isRequired ? <span style={{ color: 'var(--status-paid)', fontWeight: 600 }}>Yes</span> : <span style={{ color: 'var(--text-muted)' }}>No</span>}</td>
                          <td style={{ textAlign: 'right' }}>
                            {canEdit && (
                              <button
                                onClick={() => handleDeleteCustomField(field.id)}
                                className="btn btn-danger btn-sm"
                                style={{ fontSize: '0.6875rem', padding: '2px 8px' }}
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Receipt Configuration */}
          {activeCategory === 'receipts' && (
            <div>
              <div style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <h2 className="section-title">Receipt Configuration</h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Prefix numbers, footer disclaimers, and fiscal year sequence counters.
                </p>
              </div>

              {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading receipt config…</div>
              ) : receiptConfig && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Receipt Prefix</label>
                      <input
                        type="text"
                        value={receiptForm.receiptPrefix ?? ''}
                        onChange={(e) => setReceiptForm({ ...receiptForm, receiptPrefix: e.target.value })}
                        disabled={!canEdit || isSaving}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Logo URL</label>
                      <input
                        type="text"
                        value={receiptForm.logoUrl ?? ''}
                        onChange={(e) => setReceiptForm({ ...receiptForm, logoUrl: e.target.value })}
                        disabled={!canEdit || isSaving}
                        placeholder="https://..."
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Receipt Footer Disclaimer</label>
                    <textarea
                      value={receiptForm.receiptFooterText ?? ''}
                      onChange={(e) => setReceiptForm({ ...receiptForm, receiptFooterText: e.target.value })}
                      disabled={!canEdit || isSaving}
                      placeholder="e.g. This is a computer-generated receipt."
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>

                  {receiptConfig.sequences && receiptConfig.sequences.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                        Fiscal Year Sequence Counters (Read-Only)
                      </div>
                      <div className="table-wrapper">
                        <table>
                          <thead>
                            <tr>
                              <th>Fiscal Year</th>
                              <th style={{ textAlign: 'right' }}>Current Sequence Counter</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receiptConfig.sequences.map((seq) => (
                              <tr key={seq.fiscalYear}>
                                <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{seq.fiscalYear}</td>
                                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>
                                  {seq.currentSequence}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {canEdit && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <button
                        onClick={handleSaveReceiptConfig}
                        disabled={isSaving}
                        className="btn btn-primary"
                      >
                        {isSaving ? 'Saving…' : 'Save Receipt Config'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .settings-layout-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};
