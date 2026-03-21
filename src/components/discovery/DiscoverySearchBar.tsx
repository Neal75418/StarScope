/**
 * Discovery 頁面的搜尋列元件。
 */

import React, { memo, useState, useCallback, useEffect, FormEvent } from "react";
import { SearchIcon } from "../Icons";
import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface DiscoverySearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  initialQuery?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const DiscoverySearchBar = memo(function DiscoverySearchBar({
  onSearch,
  loading = false,
  initialQuery = "",
  inputRef,
}: DiscoverySearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);

  // 當父層重置 keyword 時同步內部狀態（例如 "Clear All"）
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        onSearch(query.trim());
      }
    },
    [query, onSearch]
  );

  return (
    <form className={styles.searchBar} onSubmit={handleSubmit} data-testid="discovery-search-bar">
      <div className={styles.searchInputWrapper}>
        <SearchIcon size={18} className={styles.searchInputIcon} />
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder={t.discovery.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          data-testid="discovery-search-input"
        />
      </div>
      <button
        type="submit"
        className={styles.searchButton}
        disabled={loading || !query.trim()}
        data-testid="discovery-search-submit"
      >
        {loading ? t.discovery.searching : t.common.search}
      </button>
    </form>
  );
});
