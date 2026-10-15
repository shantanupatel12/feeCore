import React, { useState } from 'react';
import { useAuth, ApiError } from '../contexts/AuthContext.js';
import { useTheme } from '../contexts/ThemeContext.js';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [tenantId, setTenantId] = useState('a0000000-0000-0000-0000-000000000001');
  const [email, setEmail] = useState('admin@feecore.dev');
  const [password, setPassword] = useState('Password@123');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!tenantId || !email || !password) {
      setError('All fields are required.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ tenantId, email, password });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Login failed.');
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFillDemo = () => {
    setTenantId('a0000000-0000-0000-0000-000000000001');
    setEmail('admin@feecore.dev');
    setPassword('Password@123');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        backgroundImage: 'url("/login-bg.svg")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        padding: '1.5rem',
        position: 'relative',
        transition: 'background-color var(--transition-normal)',
      }}
    >
      {/* Subtle dark overlay for form readability - minimal opacity to reveal background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(8,7,17,0.15) 0%, rgba(8,7,17,0.25) 50%, rgba(5,4,8,0.35) 100%)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      {/* Top Bar with Brand & Theme Switcher */}
      <div
        style={{
          position: 'absolute',
          top: '1.5rem',
          right: '1.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <button
          onClick={toggleTheme}
          style={{
            padding: '0.4375rem 0.875rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: '0.75rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer',
          }}
        >
          <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span>{theme === 'dark' ? 'Obsidian Dark' : 'Warm Ivory'}</span>
        </button>
      </div>

      <div
        className="card-hero"
        style={{
          padding: '2.5rem 2.25rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: 'var(--shadow-xl)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header Branding */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'var(--brand-gradient)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.5rem',
              letterSpacing: '-0.04em',
              margin: '0 auto 1rem',
              boxShadow: 'var(--brand-glow)',
            }}
          >
            FC
          </div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.03em',
              marginBottom: '0.375rem',
            }}
          >
            FeeCore
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Enterprise Financial Operations & Collections Engine
          </p>
        </div>

        {error && (
          <div className="error-state">
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
          <div className="input-group">
            <label htmlFor="tenantId">Organization Tenant ID</label>
            <input
              id="tenantId"
              type="text"
              placeholder="e.g. a0000000-0000-0000-0000-000000000001"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={isSubmitting}
              required
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
            />
          </div>

          <div className="input-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              placeholder="name@organization.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: '0.5rem' }}
          >
            {isSubmitting ? 'Authenticating Session…' : 'Sign In to Portal →'}
          </button>
        </form>

        {/* Demo Quick Fill Helper */}
        <div
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.625rem',
          }}
        >
          <button
            type="button"
            onClick={handleFillDemo}
            className="btn-action-pill"
            style={{ fontSize: '0.6875rem' }}
          >
            ⚡ Auto-Fill Dev Credentials
          </button>
          <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Universal Fee, Charge & Collections Platform • Production v1.0
          </p>
        </div>
      </div>
    </div>
  );
};