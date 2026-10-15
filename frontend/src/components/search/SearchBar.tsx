import React, { useState, useCallback } from 'react';
import { useSearch } from '../../features/search/useSearch.js';
import {
  SearchResponse,
  SearchPersonResult,
  SearchReceiptResult,
  PersonDto,
  ReceiptDto,
} from '@feecore/shared-types';

interface Props {
  tenantId: string;
  onPersonSelect?: (person: PersonDto) => void;
  onReceiptSelect?: (receipt: ReceiptDto) => void;
}

type SearchResultItem = SearchPersonResult | SearchReceiptResult;

function isPersonResult(item: SearchResultItem): item is SearchPersonResult {
  return 'fullName' in item;
}

export const SearchBar: React.FC<Props> = ({ tenantId, onPersonSelect, onReceiptSelect }) => {
  const { query, results, isLoading, error, search, clear } = useSearch(tenantId);
  const [showResults, setShowResults] = useState(false);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    search(value);
    setShowResults(value.length > 0);
  }, [search]);

  const handleClear = () => {
    clear();
    setShowResults(false);
  };

  const handleResultClick = (item: SearchResultItem) => {
    setShowResults(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '480px' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          onFocus={() => query && setShowResults(true)}
          onBlur={() => setTimeout(() => { if (!showResults) setShowResults(false); }, 200)}
          placeholder="Search people, receipts..."
          style={{
            width: '100%',
            padding: '0.625rem 2.75rem 0.625rem 0.875rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
        />
        <div style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          &#8981;K
        </div>
      </div>

      {showResults && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 1000,
          marginTop: '0.25rem',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          maxHeight: '320px',
          overflowY: 'auto',
        }}>
          {isLoading ? (
            <div style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
              Searching...
            </div>
          ) : error ? (
            <div style={{ padding: '0.75rem', color: 'var(--status-overdue)', fontSize: '0.875rem', textAlign: 'center' }}>
              {error}
            </div>
          ) : results.length > 0 ? (
            <div>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => handleResultClick(result)}
                  style={{
                    padding: '0.625rem 0.875rem',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-subtle)',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--bg-card-hover)'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: isPersonResult(result) ? 'var(--brand-primary)' : 'var(--status-paid)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {isPersonResult(result) ? 'P' : 'R'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        {isPersonResult(result) ? result.fullName : `Receipt #${result.receiptNumber}`}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
                        {isPersonResult(result)
                          ? `${result.email ?? result.primaryPhone ?? ''}`
                          : `Payment ID: ${result.paymentId?.slice(0, 8) ?? '—'}`}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {isPersonResult(result) ? 'Person' : 'Receipt'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SearchResults: React.FC<Props> = ({ tenantId, onPersonSelect, onReceiptSelect }) => {
  return <SearchBar tenantId={tenantId} onPersonSelect={onPersonSelect} onReceiptSelect={onReceiptSelect} />;
};
