/**
 * Discovery 頁面的搜尋列元件。
 */

import { useState, useCallback, FormEvent } from "react";
import { SearchIcon } from "../Icons";
import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface DiscoverySearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  initialQuery?: string;
}

export function DiscoverySearchBar({
  onSearch,
  loading = false,
  initialQuery = "",
}: DiscoverySearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);

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
    <form className={styles.searchBar} onSubmit={handleSubmit}>
      <div className={styles.searchInputWrapper}>
        <SearchIcon size={18} className={styles.searchInputIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t.discovery.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
      </div>
      <button type="submit" className={styles.searchButton} disabled={loading || !query.trim()}>
        {loading ? t.discovery.searching : t.common.search}
      </button>
    </form>
  );
}
