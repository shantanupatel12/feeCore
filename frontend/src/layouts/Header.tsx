import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { useSearch } from '../features/search/useSearch.js';
import { NavTabId } from './Sidebar.js';
import {
  MenuIcon,
  SearchIcon,
  LogoutIcon,
  CloseIcon,
} from '../components/common/Icons.js';

interface HeaderProps {
  activeTab: NavTabId;
  onOpenMobileMenu: () => void;
  tenantId: string;
  orgName?: string;
  onSelectPerson?: (personId: string) => void;
  onSelectReceipt?: (receiptId: string) => void;
  labels?: {
    pPlural?: string;
    cPlural?: string;
  };
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onOpenMobileMenu,
  tenantId,
  orgName = 'Universal Tenant',
  onSelectPerson,
  onSelectReceipt,
  labels,
}) => {
  const { session, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const user = session?.user;

  // Search logic using existing real search hook
  const { query, results, isLoading, search, clear } = useSearch(tenantId);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut Ctrl+K or Cmd+Space
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.code === 'Space')) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsSearchFocused(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute breadcrumb & title
  const getBreadcrumbInfo = (): { section: string; title: string } => {
    switch (activeTab) {
      case 'overview':
        return { section: 'Overview', title: 'Dashboard' };
      case 'people':
        return { section: 'Operations', title: labels?.pPlural || 'People' };
      case 'charges':
        return { section: 'Operations', title: labels?.cPlural || 'Charges & Plans' };
      case 'dues':
        return { section: 'Operations', title: 'Dues' };
      case 'payments':
        return { section: 'Operations', title: 'Payments' };
      case 'receipts':
        return { section: 'Operations', title: 'Receipts' };
      case 'reports':
        return { section: 'Insights', title: 'Reports' };
      case 'activity':
        return { section: 'Insights', title: 'Activity History' };
      case 'settings':
        return { section: 'Administration', title: 'Settings' };
      default:
        return { section: 'FeeCore', title: 'Dashboard' };
    }
  };

  const { section, title } = getBreadcrumbInfo();

  // User initials
  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U';

  const roleDisplay = user?.role === 'ROLE_ADMIN' ? 'Admin' : user?.role === 'ROLE_COLLECTOR' ? 'Collector' : 'Viewer';

  return (
    <header
      style={{
        height: '68px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.75rem',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        gap: '1.25rem',
        transition: 'background-color var(--transition-normal), border-color var(--transition-normal)',
      }}
    >
      {/* Left: Mobile Toggle + Breadcrumb & Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: 0 }}>
        <button
          onClick={onOpenMobileMenu}
          className="mobile-hamburger-btn"
          style={{
            padding: '0.375rem',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-secondary)',
            display: 'none',
          }}
          aria-label="Open sidebar menu"
        >
          <MenuIcon size={20} />
        </button>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.71875rem', color: 'var(--color-text-muted)' }}>
            <span>{section}</span>
            <span>/</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{title}</span>
          </div>
          <div
            style={{
              fontSize: '1.0625rem',
              fontWeight: 700,
              color: 'var(--color-text)',
              letterSpacing: '-0.025em',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        </div>
      </div>

      {/* Middle: Search with Shortcut Badge */}
      <div
        ref={searchContainerRef}
        style={{
          flex: '1',
          maxWidth: '420px',
          position: 'relative',
        }}
        className="header-search-wrapper"
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: '0.875rem',
              color: 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <SearchIcon size={15} />
          </span>

          <input
            ref={inputRef}
            type="text"
            placeholder="Search people, receipts, references..."
            value={query}
            onChange={(e) => {
              search(e.target.value);
              setIsSearchFocused(true);
            }}
            onFocus={() => setIsSearchFocused(true)}
            style={{
              width: '100%',
              padding: '0.5rem 5rem 0.5rem 2.375rem',
              background: 'var(--color-surface-hover)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.8125rem',
              color: 'var(--color-text)',
              transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast), background-color var(--transition-fast)',
            }}
          />

          {/* Shortcut badge: ⌘ + Space */}
          {!query && (
            <span
              style={{
                position: 'absolute',
                right: '0.625rem',
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-xs)',
                fontWeight: 600,
                pointerEvents: 'none',
              }}
            >
              ⌘ Space
            </span>
          )}

          {query && (
            <button
              onClick={() => {
                clear();
                setIsSearchFocused(false);
              }}
              style={{
                position: 'absolute',
                right: '0.625rem',
                color: 'var(--color-text-muted)',
                padding: '3px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Clear search"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        {/* Global Search Live Dropdown Results */}
        {isSearchFocused && query.trim().length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              right: 0,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 100,
              maxHeight: '340px',
              overflowY: 'auto',
            }}
          >
            {isLoading ? (
              <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                Searching database…
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                No records matching "{query}"
              </div>
            ) : (
              <div>
                <div
                  style={{
                    padding: '0.4375rem 0.875rem',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-surface-hover)',
                    borderBottom: '1px solid var(--color-border)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Results ({results.length})
                </div>
                {results.map((res: any, idx) => {
                  const isPerson = 'fullName' in res;
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        setIsSearchFocused(false);
                        if (isPerson && onSelectPerson) {
                          onSelectPerson(res.id);
                        } else if (!isPerson && onSelectReceipt) {
                          onSelectReceipt(res.id);
                        }
                      }}
                      style={{
                        padding: '0.6875rem 0.875rem',
                        borderBottom: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        transition: 'background var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--color-surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                          {isPerson ? res.fullName : `Receipt #${res.receiptNumber}`}
                        </div>
                        <div style={{ fontSize: '0.71875rem', color: 'var(--color-text-secondary)' }}>
                          {isPerson
                            ? `${res.primaryPhone || ''} ${res.email ? `• ${res.email}` : ''}`
                            : `Payment: ${res.paymentId ? res.paymentId.slice(0, 10) : '—'}`}
                        </div>
                      </div>
                      <span
                        className={`badge ${isPerson ? 'badge-pending' : 'badge-paid'}`}
                        style={{ fontSize: '0.625rem' }}
                      >
                        {isPerson ? 'Person' : 'Receipt'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Theme Toggle, Database Status, User Avatar & Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          style={{
            padding: '0.4375rem 0.6875rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontSize: '0.75rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all var(--transition-fast)',
          }}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span className="theme-toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>

        {/* PostgreSQL status pill */}
        <div
          className="header-db-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 9px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(53, 201, 139, 0.12)',
            border: '1px solid rgba(53, 201, 139, 0.28)',
            color: 'var(--color-success)',
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          <span className="status-dot status-dot-paid" style={{ width: '6px', height: '6px' }} />
          <span>LIVE</span>
        </div>

        {/* User Card */}
        {user && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              paddingLeft: '0.75rem',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-full)',
                background: 'linear-gradient(135deg, #8B35FF 0%, #6B25D1 100%)',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                flexShrink: 0,
              }}
              title={user.fullName}
            >
              {initials}
            </div>

            <div className="user-details-compact" style={{ lineHeight: 1.2 }}>
              <div
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  maxWidth: '120px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.fullName}
              </div>
              <div style={{ fontSize: '0.65625rem', color: 'var(--color-text-muted)' }}>
                {roleDisplay}
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={logout}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.375rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-hover)',
                color: 'var(--color-text-secondary)',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-danger)';
                e.currentTarget.style.borderColor = 'rgba(255, 100, 124, 0.28)';
                e.currentTarget.style.background = 'rgba(255, 100, 124, 0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-secondary)';
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.background = 'var(--color-surface-hover)';
              }}
              title="Sign Out"
              aria-label="Sign out"
            >
              <LogoutIcon size={15} />
            </button>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 960px) {
          .mobile-hamburger-btn {
            display: flex !important;
          }
          .header-db-badge {
            display: none !important;
          }
          .theme-toggle-label {
            display: none !important;
          }
        }
        @media (max-width: 640px) {
          .user-details-compact {
            display: none !important;
          }
          .header-search-wrapper {
            max-width: 160px !important;
          }
        }
      `}</style>
    </header>
  );
};