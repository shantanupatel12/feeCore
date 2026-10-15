import React from 'react';
import { useAuth } from '../contexts/AuthContext.js';

interface MainLayoutProps {
  notification: string | null;
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ notification, children }) => {
  const { session, logout } = useAuth();

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', minHeight: '100vh' }}>
      {/* Toast Notification */}
      {notification && (
        <div style={{ position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999, background: 'var(--brand-primary)', color: '#fff', padding: '0.875rem 1.5rem', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', fontWeight: 600 }}>
          {notification}
        </div>
      )}

      {/* Header */}
      <header className="glass-panel" style={{ padding: '1.5rem 2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, background: 'var(--brand-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            FeeCore Universal
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Universal Fee, Charge & Collection Platform
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span className="badge badge-paid">PostgreSQL 18 Running</span>
          <span className="badge badge-pending">Phase 2: Charges & Dues Engine Ready</span>
          {session?.user && (
            <button
              onClick={logout}
              style={{
                padding: '0.4rem 0.875rem',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
              title={`Signed in as ${session.user.fullName}`}
            >
              Sign out ({session.user.fullName})
            </button>
          )}
        </div>
      </header>
      
      {children}
    </div>
  );
};
