/**
 * 工具列元件，包含搜尋、排序、新增、刷新、重新計算和匯出功能。
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { useI18n, interpolate } from "../../i18n";
import type { WatchlistSortKey, SortDirection } from "../../hooks/useWatchlistSort";
import type { ViewMode } from "../../hooks/useViewMode";
import { GridIcon, ListIcon } from "../../components/Icons";
import { ExportDropdown } from "./ExportDropdown";

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
  sortKey: WatchlistSortKey;
  sortDirection: SortDirection;
  onSortChange: (key: WatchlistSortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  isSelectionMode?: boolean;
  onEnterSelectionMode?: () => void;
  onExitSelectionMode?: () => void;
  onSelectAll?: () => void;
  selectedCount?: number;
}

const SORT_OPTIONS: WatchlistSortKey[] = [
  "added_at",
  "stars",
  "velocity",
  "stars_delta_7d",
  "acceleration",
  "full_name",
];

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
  sortKey,
  sortDirection,
  onSortChange,
  viewMode,
  onViewModeChange,
  searchInputRef,
  isSelectionMode,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectAll,
  selectedCount,
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

  const sortLabels = t.watchlist.sort;

  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <div className="toolbar-search" role="search">
          <input
            ref={searchInputRef}
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
        <ExportDropdown />
        <div className="view-mode-toggle" data-testid="view-mode-toggle">
          <button
            type="button"
            className={`view-mode-btn${viewMode === "list" ? " active" : ""}`}
            onClick={() => onViewModeChange("list")}
            aria-label={t.watchlist.viewMode.list}
            title={t.watchlist.viewMode.list}
            aria-pressed={viewMode === "list"}
          >
            <ListIcon size={16} />
          </button>
          <button
            type="button"
            className={`view-mode-btn${viewMode === "grid" ? " active" : ""}`}
            onClick={() => onViewModeChange("grid")}
            aria-label={t.watchlist.viewMode.grid}
            title={t.watchlist.viewMode.grid}
            aria-pressed={viewMode === "grid"}
          >
            <GridIcon size={16} />
          </button>
        </div>
        {isSelectionMode ? (
          <div className="selection-controls" data-testid="selection-controls">
            <button className="btn btn-sm" onClick={onSelectAll} data-testid="select-all-btn">
              {t.watchlist.batch.selectAll}
            </button>
            <span className="selection-count">
              {interpolate(t.watchlist.batch.selected, { count: selectedCount ?? 0 })}
            </span>
            <button
              className="btn btn-sm"
              onClick={onExitSelectionMode}
              data-testid="cancel-selection-btn"
            >
              {t.watchlist.batch.cancel}
            </button>
          </div>
        ) : (
          <button
            className="btn btn-sm"
            onClick={onEnterSelectionMode}
            data-testid="enter-selection-btn"
            title={t.watchlist.batch.select}
          >
            {t.watchlist.batch.select}
          </button>
        )}
        {(selectedCategoryId || searchQuery) && (
          <span className="filter-indicator">
            {interpolate(t.watchlist.showing, {
              count: displayedCount,
              total: totalCount,
            })}
          </span>
        )}
      </div>

      <div className="toolbar-sort-row" data-testid="sort-tabs">
        <span className="sort-label">{t.watchlist.sort.label}</span>
        <div className="sort-tabs" role="toolbar" aria-label={t.watchlist.sort.label}>
          {SORT_OPTIONS.map((key) => (
            <button
              key={key}
              type="button"
              className={`sort-tab${sortKey === key ? " active" : ""}`}
              onClick={() => onSortChange(key)}
              data-testid={`sort-tab-${key}`}
              aria-pressed={sortKey === key}
            >
              {sortLabels[key]}
              {sortKey === key && (
                <span
                  className="sort-direction"
                  aria-label={
                    sortDirection === "asc"
                      ? t.watchlist.sort.ascending
                      : t.watchlist.sort.descending
                  }
                >
                  {sortDirection === "asc" ? " ↑" : " ↓"}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
