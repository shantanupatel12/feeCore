import React, { useState } from 'react';
import { useTerminology } from '../../contexts/TerminologyContext.js';
import { CloseIcon } from '../common/Icons.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    fullName: string;
    primaryPhone: string;
    secondaryPhone?: string;
    email?: string;
    address?: string;
  }) => void;
}

function validatePhoneNumber(phone: string): string | null {
  if (!phone || !phone.trim()) {
    return 'Primary phone number is required.';
  }
  const stripped = phone.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?[0-9]{10,15}$/.test(stripped)) {
    return 'Please enter a valid phone number (10 to 15 digits, e.g. +91 98765 43210 or 9876543210).';
  }
  return null;
}

function validateOptionalPhoneNumber(phone?: string): string | null {
  if (!phone || !phone.trim()) return null;
  const stripped = phone.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?[0-9]{10,15}$/.test(stripped)) {
    return 'Please enter a valid phone number (10 to 15 digits, e.g. +91 98765 43210).';
  }
  return null;
}

export const CreatePersonModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const { pSingular } = useTerminology();
  const [fullName, setFullName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [secondaryPhoneError, setSecondaryPhoneError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pErr = validatePhoneNumber(primaryPhone);
    const sErr = validateOptionalPhoneNumber(secondaryPhone);
    setPhoneError(pErr);
    setSecondaryPhoneError(sErr);

    if (pErr || sErr || !fullName.trim()) return;

    onSubmit({
      fullName: fullName.trim(),
      primaryPhone: primaryPhone.trim(),
      secondaryPhone: secondaryPhone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
    });
    setFullName('');
    setPrimaryPhone('');
    setSecondaryPhone('');
    setEmail('');
    setAddress('');
    setPhoneError(null);
    setSecondaryPhoneError(null);
    onClose();
  };

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
          maxWidth: '500px',
          padding: '2rem',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Add New {pSingular}
          </h2>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>
            <CloseIcon size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Full Name *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Primary Phone *</label>
            <input
              type="tel"
              required
              value={primaryPhone}
              onChange={(e) => {
                setPrimaryPhone(e.target.value);
                if (phoneError) setPhoneError(validatePhoneNumber(e.target.value));
              }}
              placeholder="+91 98765 43210"
              style={{ width: '100%', borderColor: phoneError ? 'var(--status-overdue)' : undefined }}
            />
            {phoneError && (
              <div style={{ color: 'var(--status-overdue)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {phoneError}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Secondary Phone (Optional)</label>
            <input
              type="tel"
              value={secondaryPhone}
              onChange={(e) => {
                setSecondaryPhone(e.target.value);
                if (secondaryPhoneError) setSecondaryPhoneError(validateOptionalPhoneNumber(e.target.value));
              }}
              placeholder="+91 98765 00000"
              style={{ width: '100%', borderColor: secondaryPhoneError ? 'var(--status-overdue)' : undefined }}
            />
            {secondaryPhoneError && (
              <div style={{ color: 'var(--status-overdue)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {secondaryPhoneError}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Email (Optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rahul@example.com"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Address (Optional)</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Flat 402, Royal Residency"
              rows={2}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save {pSingular}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
