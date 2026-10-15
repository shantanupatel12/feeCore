import React, { useState } from 'react';
import { Sidebar, NavTabId } from './Sidebar.js';
import { Header } from './Header.js';

interface AppShellProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  notification: string | null;
  orgName?: string;
  tenantId: string;
  counts?: {
    people?: number;
    dues?: number;
    receipts?: number;
    plans?: number;
  };
  labels?: {
    pPlural?: string;
    cPlural?: string;
  };
  onSelectPerson?: (personId: string) => void;
  onSelectReceipt?: (receiptId: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  onSelectTab,
  notification,
  orgName,
  tenantId,
  counts,
  labels,
  onSelectPerson,
  onSelectReceipt,
  children,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        transition: 'background-color var(--transition-normal)',
      }}
    >
      {/* Toast Notification */}
      {notification && (
        <div className="toast-banner">
          <span style={{ color: 'var(--status-paid)', fontSize: '0.875rem' }}>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Left Persistent / Drawer Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        counts={counts}
        orgName={orgName}
        labels={labels}
      />

      {/* Main Right Area: Top Header + Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: 'var(--bg-primary)',
          transition: 'background-color var(--transition-normal)',
        }}
      >
        <Header
          activeTab={activeTab}
          onOpenMobileMenu={() => setIsMobileOpen(true)}
          tenantId={tenantId}
          orgName={orgName}
          onSelectPerson={onSelectPerson}
          onSelectReceipt={onSelectReceipt}
          labels={labels}
        />

        <main
          style={{
            flex: 1,
            padding: '2rem 2.25rem',
            maxWidth: '1440px',
            width: '100%',
            margin: '0 auto',
          }}
          className="main-content-container"
        >
          {children}
        </main>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .main-content-container {
            padding: 1.25rem 1rem !important;
          }
        }
      `}</style>
    </div>
  );
};
