/**
 * Discovery 頁面的搜尋列元件，含搜尋歷史下拉選單。
 */

import React, { useState, useCallback, useEffect, useRef, FormEvent } from "react";
import { SearchIcon } from "../Icons";
import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface DiscoverySearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  initialQuery?: string;
  searchHistory?: string[];
  onSelectHistory?: (query: string) => void;
  onRemoveHistory?: (query: string) => void;
  onClearHistory?: () => void;
}

export function DiscoverySearchBar({
  onSearch,
  loading = false,
  initialQuery = "",
  searchHistory = [],
  onSelectHistory,
  onRemoveHistory,
  onClearHistory,
}: DiscoverySearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [showHistory, setShowHistory] = useState(false);
  const wrapperRef = useRef<HTMLFormElement>(null);

  // 當父層重置 keyword 時同步內部狀態（例如 "Clear All"）
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // 點擊外部時關閉歷史下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        onSearch(query.trim());
        setShowHistory(false);
      }
    },
    [query, onSearch]
  );

  const handleSelectHistory = useCallback(
    (item: string) => {
      setQuery(item);
      setShowHistory(false);
      onSelectHistory?.(item);
    },
    [onSelectHistory]
  );

  const handleRemoveHistory = useCallback(
    (e: React.MouseEvent, item: string) => {
      e.stopPropagation();
      onRemoveHistory?.(item);
    },
    [onRemoveHistory]
  );

  const handleFocus = useCallback(() => {
    if (searchHistory.length > 0 && !query.trim()) {
      setShowHistory(true);
    }
  }, [searchHistory.length, query]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      if (!val.trim() && searchHistory.length > 0) {
        setShowHistory(true);
      } else {
        setShowHistory(false);
      }
    },
    [searchHistory.length]
  );

  return (
    <form className={styles.searchBar} onSubmit={handleSubmit} ref={wrapperRef}>
      <div className={styles.searchInputWrapper}>
        <SearchIcon size={18} className={styles.searchInputIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t.discovery.searchPlaceholder}
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowHistory(false);
          }}
          disabled={loading}
          aria-expanded={showHistory && searchHistory.length > 0}
          aria-haspopup="listbox"
          aria-controls={showHistory ? "search-history-listbox" : undefined}
        />
        {showHistory && searchHistory.length > 0 && (
          <div className={styles.searchHistory} role="listbox" id="search-history-listbox">
            <div className={styles.searchHistoryHeader}>
              <span className={styles.searchHistoryTitle}>{t.discovery.searchHistory.title}</span>
              <button
                type="button"
                className={styles.searchHistoryClear}
                onClick={() => {
                  onClearHistory?.();
                  setShowHistory(false);
                }}
              >
                {t.discovery.searchHistory.clear}
              </button>
            </div>
            {searchHistory.map((item) => (
              <div
                key={item}
                className={styles.searchHistoryItem}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handleSelectHistory(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSelectHistory(item);
                }}
              >
                <span className={styles.searchHistoryText}>{item}</span>
                <button
                  type="button"
                  className={styles.searchHistoryRemove}
                  onClick={(e) => handleRemoveHistory(e, item)}
                  aria-label={t.discovery.searchHistory.removeItem.replace("{item}", item)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="submit" className={styles.searchButton} disabled={loading || !query.trim()}>
        {loading ? t.discovery.searching : t.common.search}
      </button>
    </form>
  );
}
