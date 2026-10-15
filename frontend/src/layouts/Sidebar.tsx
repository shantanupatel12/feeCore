import React from 'react';
import {
  DashboardIcon,
  PeopleIcon,
  ChargesIcon,
  DuesIcon,
  PaymentsIcon,
  ReceiptsIcon,
  ReportsIcon,
  ActivityIcon,
  SettingsIcon,
  BuildingIcon,
  CloseIcon,
  LogoutIcon,
} from '../components/common/Icons.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { UserRole } from '@feecore/shared-types';

export type NavTabId =
  | 'overview'
  | 'people'
  | 'charges'
  | 'dues'
  | 'payments'
  | 'receipts'
  | 'reports'
  | 'activity'
  | 'settings';

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  counts?: {
    people?: number;
    dues?: number;
    receipts?: number;
    plans?: number;
  };
  orgName?: string;
  labels?: {
    pPlural?: string;
    cPlural?: string;
  };
}

interface NavItem {
  id: NavTabId;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  roles?: UserRole[];
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  'ROLE_ADMIN': 3,
  'ROLE_COLLECTOR': 2,
  'ROLE_VIEWER': 1,
};

function canAccess(userRole: UserRole | null, requiredRoles?: UserRole[]): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  return requiredRoles.some((r) => (ROLE_HIERARCHY[r] ?? 0) <= userLevel);
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isMobileOpen,
  onCloseMobile,
  counts,
  orgName = 'Universal Tenant',
  labels,
}) => {
  const { session, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const peopleLabel = labels?.pPlural || 'People';
  const chargesLabel = labels?.cPlural || 'Charges';
  const userRole = (session?.user?.role as UserRole) ?? null;

  const navGroups: NavGroup[] = [
    {
      heading: 'OVERVIEW',
      items: [
        {
          id: 'overview',
          label: 'Dashboard',
          icon: <DashboardIcon size={18} />,
        },
      ],
    },
{
          heading: 'OPERATIONS',
          items: [
            {
              id: 'people',
              label: peopleLabel,
              icon: <PeopleIcon size={18} />,
              badge: counts?.people,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
            },
            {
              id: 'charges',
              label: chargesLabel,
              icon: <ChargesIcon size={18} />,
              badge: counts?.plans,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
            },
            {
              id: 'dues',
              label: 'Dues',
              icon: <DuesIcon size={18} />,
              badge: counts?.dues,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
            },
            {
              id: 'payments',
              label: 'Payments',
              icon: <PaymentsIcon size={18} />,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
            },
            {
              id: 'receipts',
              label: 'Receipts',
              icon: <ReceiptsIcon size={18} />,
              badge: counts?.receipts,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR', 'ROLE_VIEWER'],
            },
          ],
        },
        {
          heading: 'INSIGHTS',
          items: [
            {
              id: 'reports',
              label: 'Reports',
              icon: <ReportsIcon size={18} />,
              roles: ['ROLE_ADMIN', 'ROLE_COLLECTOR', 'ROLE_VIEWER'],
            },
            {
              id: 'activity',
              label: 'Activity',
              icon: <ActivityIcon size={18} />,
              roles: ['ROLE_ADMIN'],
            },
          ],
        },
        {
          heading: 'ADMINISTRATION',
          items: [
            {
              id: 'settings',
              label: 'Settings',
              icon: <SettingsIcon size={18} />,
              roles: ['ROLE_ADMIN'],
            },
          ],
        },
  ];

  const filteredNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(userRole, item.roles)),
    }))
    .filter((group) => group.items.length > 0);

  const handleItemClick = (id: NavTabId) => {
    onSelectTab(id);
    onCloseMobile();
  };

  // If current active tab is not accessible, redirect to first available tab
  const isCurrentTabAccessible = filteredNavGroups.some((g) =>
    g.items.some((item) => item.id === activeTab)
  );
  const firstAccessibleTab = filteredNavGroups[0]?.items[0]?.id;

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(8, 7, 17, 0.75)',
            zIndex: 49,
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* Sidebar Container */}
      <aside
        style={{
          width: '260px',
          height: '100vh',
          position: 'sticky',
          top: 0,
          left: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          transition: 'transform var(--transition-normal), background-color var(--transition-normal)',
          flexShrink: 0,
        }}
        className={`sidebar-root ${isMobileOpen ? 'mobile-open' : ''}`}
      >
        {/* Branding & Org Header */}
        <div
          style={{
            padding: '1.25rem 1.25rem 1rem',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #8B35FF 0%, #6B25D1 100%)',
                  boxShadow: '0 4px 18px rgba(139, 53, 255, 0.4)',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1.0625rem',
                  letterSpacing: '-0.03em',
                  flexShrink: 0,
                }}
              >
                FC
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      color: 'var(--color-text)',
                      letterSpacing: '-0.03em',
                      lineHeight: 1.15,
                    }}
                  >
                    FeeCore
                  </span>
                  <span
                    style={{
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      padding: '2px 5px',
                      borderRadius: '4px',
                      background: 'rgba(139, 53, 255, 0.14)',
                      color: 'var(--color-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    PRO
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.02em',
                    display: 'block',
                    marginTop: '2px',
                  }}
                >
                  Universal Financial Core
                </span>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="mobile-close-btn"
              style={{
                color: 'var(--color-text-secondary)',
                padding: '0.25rem',
                borderRadius: 'var(--radius-xs)',
              }}
              aria-label="Close sidebar"
            >
              <CloseIcon size={20} />
            </button>
          </div>

          {/* Organization Indicator Card */}
          <div
            style={{
              marginTop: '0.875rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-hover)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '6px',
                background: 'rgba(139, 53, 255, 0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <BuildingIcon size={12} color="var(--color-primary)" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: '0.78125rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={orgName}
              >
                {orgName}
              </div>
              <div style={{ fontSize: '0.65625rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="status-dot status-dot-paid" style={{ width: '5px', height: '5px' }} />
                <span>Production Tenant</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <nav
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {filteredNavGroups.map((group) => (
            <div key={group.heading}>
              <div
                style={{
                  fontSize: '0.65625rem',
                  fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.08em',
                  padding: '0 0.75rem 0.375rem',
                  textTransform: 'uppercase',
                }}
              >
                {group.heading}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {group.items.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemClick(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.5625rem 0.75rem',
                        borderRadius: 'var(--radius-md)',
                        background: isActive ? 'rgba(139, 53, 255, 0.14)' : 'transparent',
                        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontWeight: isActive ? 600 : 500,
                        fontSize: '0.84375rem',
                        textAlign: 'left',
                        width: '100%',
                        transition: 'all var(--transition-fast)',
                        border: isActive ? '1px solid rgba(139, 53, 255, 0.3)' : '1px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'var(--color-surface-hover)';
                          e.currentTarget.style.color = 'var(--color-text)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--color-text-secondary)';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            transition: 'color var(--transition-fast)',
                          }}
                        >
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>

                      {typeof item.badge === 'number' && item.badge > 0 && (
                        <span
                          style={{
                            fontSize: '0.65625rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-full)',
                            background: isActive ? 'var(--color-primary)' : 'var(--color-surface-hover)',
                            color: isActive ? '#FFFFFF' : 'var(--color-text-secondary)',
                            fontFamily: 'var(--font-mono)',
                            border: isActive ? 'none' : '1px solid var(--color-border)',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer: User profile, theme toggle & system status */}
        <div
          style={{
            padding: '0.875rem 1rem',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface-hover)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
          }}
        >
          {/* Theme Quick Switcher in Sidebar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.375rem 0.625rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem' }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {theme === 'dark' ? 'Obsidian Dark' : 'Warm Ivory'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-primary)',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(139, 53, 255, 0.14)',
              }}
            >
              Switch
            </button>
          </div>

          {session?.user && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
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
                >
                  {session.user.fullName
                    ? session.user.fullName
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                    : 'U'}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '0.78125rem',
                      fontWeight: 600,
                      color: 'var(--color-text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={session.user.fullName}
                  >
                    {session.user.fullName}
                  </div>
                  <div style={{ fontSize: '0.65625rem', color: 'var(--color-text-muted)' }}>
                    {session.user.role === 'ROLE_ADMIN' ? 'Administrator' : session.user.role === 'ROLE_COLLECTOR' ? 'Collector' : 'Viewer'}
                  </div>
                </div>
              </div>

              <button
                onClick={logout}
                style={{
                  padding: '0.375rem',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all var(--transition-fast)',
                }}
                title="Sign out"
                aria-label="Sign out"
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-danger)';
                  e.currentTarget.style.borderColor = 'rgba(255, 100, 124, 0.28)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                }}
              >
                <LogoutIcon size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <style>{`
        @media (max-width: 1024px) {
          .sidebar-root {
            position: fixed !important;
            transform: translateX(-100%);
            box-shadow: var(--shadow-xl);
          }
          .sidebar-root.mobile-open {
            transform: translateX(0);
          }
        }
        @media (min-width: 1025px) {
          .mobile-close-btn {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
};