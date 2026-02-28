/**
 * 工具列元件，包含搜尋、新增、刷新和重新計算功能。
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n, interpolate } from "../../i18n";

interface ToolbarProps {
  onAddRepo: () => void;
  onRefreshAll: () => void;
  onRecalculateAll: () => void;
  isRefreshing: boolean;
  isRecalculating: boolean;
  selectedCategoryId: number | null;
  displayedCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Toolbar({
  onAddRepo,
  onRefreshAll,
  onRecalculateAll,
  isRefreshing,
  isRecalculating,
  selectedCategoryId,
  displayedCount,
  totalCount,
  searchQuery,
  onSearchChange,
}: ToolbarProps) {
  const { t } = useI18n();
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 同步外部 searchQuery 變更（例如清除篩選時）
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearchChange(value), 300);
    },
    [onSearchChange]
  );

  // 清理 debounce timer
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div className="toolbar">
      <div className="toolbar-search">
        <input
          type="text"
          placeholder={t.watchlist.searchPlaceholder}
          value={localQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="search-input"
          data-testid="watchlist-search"
          aria-label={t.watchlist.searchPlaceholder}
        />
      </div>
      <button
        data-testid="add-repo-btn"
        onClick={onAddRepo}
        className="btn btn-primary"
        aria-label={t.watchlist.addRepo}
      >
        + {t.watchlist.addRepo}
      </button>
      <button
        data-testid="refresh-all-btn"
        onClick={onRefreshAll}
        disabled={isRefreshing}
        className="btn"
        aria-label={t.watchlist.refreshAll}
      >
        {isRefreshing ? t.watchlist.refreshing : t.watchlist.refreshAll}
      </button>
      <button
        onClick={onRecalculateAll}
        disabled={isRecalculating}
        className="btn"
        title={t.watchlist.recalculateAll}
        aria-label={t.watchlist.recalculateAll}
      >
        {isRecalculating ? t.watchlist.recalculating : t.watchlist.recalculateAll}
      </button>
      {(selectedCategoryId || searchQuery) && (
        <span className="filter-indicator">
          {interpolate(t.watchlist.showing, {
            count: displayedCount,
            total: totalCount,
          })}
        </span>
      )}
    </div>
  );
}
