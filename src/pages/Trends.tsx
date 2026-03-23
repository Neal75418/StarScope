/**
 * 趨勢頁面，依不同指標排序顯示 repo，支援語言與星數篩選、快速加入追蹤。
 */

import { Fragment, useState, useMemo, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "../components/Skeleton";
import { AnimatedPage } from "../components/motion";
import { formatNumber } from "../utils/format";
import { useI18n } from "../i18n";
import { useTrends, SortOption, TrendingRepo } from "../hooks/useTrends";
import { addRepo } from "../api/client";
import { useWatchlistState } from "../contexts/WatchlistContext";
import { queryKeys } from "../lib/react-query";
import { useViewMode } from "../hooks/useViewMode";
import { useSelectionMode } from "../hooks/useSelectionMode";
import { STORAGE_KEYS } from "../constants/storage";
import { useAppStatus } from "../contexts/AppStatusContext";
import { logger } from "../utils/logger";
import { TrendRow } from "./trends/TrendRow";
import { TrendExpandedRow } from "./trends/TrendExpandedRow";
import { TrendGrid } from "./trends/TrendGrid";
import { TrendsExportDropdown } from "./trends/TrendsExportDropdown";
import { TrendsBatchAddBar } from "./trends/TrendsBatchAddBar";
import { useTrendEarlySignals } from "../hooks/useTrendEarlySignals";

const SORT_KEYS: SortOption[] = [
  "velocity",
  "stars_delta_7d",
  "stars_delta_30d",
  "acceleration",
  "forks_delta_7d",
  "issues_delta_7d",
];

const MIN_STARS_OPTIONS = [0, 100, 500, 1000, 5000, 10000];

const REFRESH_INTERVALS: { label: string; value: number | false }[] = [
  { label: "off", value: false },
  { label: "5m", value: 5 * 60 * 1000 },
  { label: "15m", value: 15 * 60 * 1000 },
  { label: "30m", value: 30 * 60 * 1000 },
];

function getStoredRefreshInterval(): number | false {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.TRENDS_AUTO_REFRESH);
    if (stored) {
      const num = Number(stored);
      if (REFRESH_INTERVALS.some((r) => r.value === num)) return num;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function formatTimeAgo(
  timestamp: number,
  t: { justNow: string; minutesAgo: string; hoursAgo: string }
): string {
  if (timestamp === 0) return "";
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 60) return t.justNow;
  const min = Math.floor(diff / 60);
  if (min < 60) return t.minutesAgo.replace("{min}", String(min));
  const hr = Math.floor(min / 60);
  return t.hoursAgo.replace("{hr}", String(hr));
}

/** 自管 tick 的子元件，避免 30s 間隔重渲整頁。 */
function LastUpdatedIndicator({
  dataUpdatedAt,
  t,
}: {
  dataUpdatedAt: number;
  t: { lastUpdated: string; justNow: string; minutesAgo: string; hoursAgo: string };
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (dataUpdatedAt === 0) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  if (dataUpdatedAt === 0) return null;

  return (
    <span
      className="trends-refresh-indicator"
      data-testid="trends-last-updated"
      role="status"
      aria-live="polite"
    >
      {t.lastUpdated.replace("{time}", formatTimeAgo(dataUpdatedAt, t))}
    </span>
  );
}

export function Trends() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Auto-refresh 間隔
  const [refreshInterval, setRefreshInterval] = useState<number | false>(getStoredRefreshInterval);

  const {
    trends,
    loading,
    error,
    sortBy,
    setSortBy,
    languageFilter,
    setLanguageFilter,
    minStarsFilter,
    setMinStarsFilter,
    availableLanguages,
    retry,
    dataUpdatedAt,
  } = useTrends({ refetchInterval: refreshInterval });

  const handleRefreshIntervalChange = useCallback((value: string) => {
    const num = value === "false" ? false : Number(value);
    setRefreshInterval(num);
    try {
      if (num === false) {
        localStorage.removeItem(STORAGE_KEYS.TRENDS_AUTO_REFRESH);
      } else {
        localStorage.setItem(STORAGE_KEYS.TRENDS_AUTO_REFRESH, String(num));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 視圖模式：List / Grid
  const { viewMode, setViewMode } = useViewMode(STORAGE_KEYS.TRENDS_VIEW_MODE);

  // Watchlist 狀態 — 從 Context 讀取，避免重複 API 請求
  const watchlistState = useWatchlistState();
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());
  const [addingRepoIds, setAddingRepoIds] = useState<Set<number>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  // 展開狀態 — 同一時間只展開一行（僅 list 模式）
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(null);

  // 多選模式 — 批次加入 watchlist
  const selection = useSelectionMode();
  const { level } = useAppStatus();

  const selectedRepos = useMemo(
    () => trends.filter((r) => selection.selectedIds.has(r.id)),
    [trends, selection.selectedIds]
  );

  const handleSelectionDone = useCallback(() => {
    selection.exit();
    setExpandedRepoId(null);
  }, [selection]);

  // Breakout / Early Signal 偵測
  const repoIds = useMemo(() => trends.map((r) => r.id), [trends]);
  const { signalsByRepoId, reposWithBreakouts } = useTrendEarlySignals(repoIds);
  const [showBreakoutsOnly, setShowBreakoutsOnly] = useState(false);

  const displayedTrends = useMemo(
    () => (showBreakoutsOnly ? trends.filter((r) => reposWithBreakouts.has(r.id)) : trends),
    [trends, showBreakoutsOnly, reposWithBreakouts]
  );

  const allWatchlistNames = useMemo(() => {
    const names = new Set(watchlistState.repos.map((r) => r.full_name.toLowerCase()));
    locallyAdded.forEach((n) => names.add(n));
    return names;
  }, [watchlistState.repos, locallyAdded]);

  const handleAddToWatchlist = useCallback(
    async (repo: TrendingRepo) => {
      setAddingRepoIds((prev) => new Set(prev).add(repo.id));
      setAddError(null);
      try {
        await addRepo({ owner: repo.owner, name: repo.name });
        setLocallyAdded((prev) => new Set(prev).add(repo.full_name.toLowerCase()));
        // 同步全域 watchlist 資料源，避免雙真相
        void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
      } catch (err) {
        logger.error("[Trends] 加入追蹤失敗:", err);
        setAddError(`${t.common.error}: ${repo.full_name}`);
      } finally {
        setAddingRepoIds((prev) => {
          const next = new Set(prev);
          next.delete(repo.id);
          return next;
        });
      }
    },
    [t, queryClient]
  );

  const handleToggleExpand = useCallback((repoId: number) => {
    setExpandedRepoId((prev) => (prev === repoId ? null : repoId));
  }, []);

  const handleCloseExpand = useCallback(() => {
    setExpandedRepoId(null);
  }, []);

  if (loading) {
    return (
      <AnimatedPage className="page">
        <header className="page-header">
          <h1 data-testid="page-title">{t.trends.title}</h1>
          <p className="subtitle">{t.trends.subtitle}</p>
        </header>

        <div className="toolbar">
          <div className="sort-tabs">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width={80} height={32} variant="rounded" />
            ))}
          </div>
        </div>

        <div className="trends-table">
          <table>
            <thead>
              <tr>
                <th className="rank-col">{t.trends.columns.rank}</th>
                <th className="repo-col">{t.trends.columns.repo}</th>
                <th className="stars-col">{t.trends.columns.stars}</th>
                <th className="delta-col">{t.trends.columns.delta7d}</th>
                <th className="delta-col">{t.trends.columns.delta30d}</th>
                <th className="velocity-col">{t.trends.columns.velocity}</th>
                <th className="trend-col">{t.repo.trend}</th>
                <th className="delta-col">{t.trends.columns.forksDelta7d}</th>
                <th className="delta-col">{t.trends.columns.issuesDelta7d}</th>
                <th className="action-col" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  <td className="rank-col">
                    <Skeleton width={24} height={24} variant="circular" />
                  </td>
                  <td className="repo-col">
                    <Skeleton width="70%" height={16} />
                  </td>
                  <td className="stars-col">
                    <Skeleton width={40} height={16} />
                  </td>
                  <td className="delta-col">
                    <Skeleton width={40} height={16} />
                  </td>
                  <td className="delta-col">
                    <Skeleton width={40} height={16} />
                  </td>
                  <td className="velocity-col">
                    <Skeleton width={30} height={16} />
                  </td>
                  <td className="trend-col">
                    <Skeleton width={20} height={16} />
                  </td>
                  <td className="delta-col">
                    <Skeleton width={40} height={16} />
                  </td>
                  <td className="delta-col">
                    <Skeleton width={40} height={16} />
                  </td>
                  <td className="action-col">
                    <Skeleton width={60} height={24} variant="rounded" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AnimatedPage>
    );
  }

  if (error) {
    const message =
      level === "sidecar-down"
        ? t.status.sidecarDown
        : level === "offline"
          ? t.status.offline
          : error;
    return (
      <AnimatedPage className="page">
        <div className="error-container">
          <h2>{t.trends.loadingError}</h2>
          <p>{message}</p>
          <button className="btn btn-primary" onClick={retry}>
            {t.trends.retry}
          </button>
        </div>
      </AnimatedPage>
    );
  }

  const sortLabels: Record<SortOption, string> = {
    velocity: t.trends.sortOptions.velocity,
    stars_delta_7d: t.trends.sortOptions.stars_delta_7d,
    stars_delta_30d: t.trends.sortOptions.stars_delta_30d,
    acceleration: t.trends.sortOptions.acceleration,
    forks_delta_7d: t.trends.sortOptions.forks_delta_7d,
    issues_delta_7d: t.trends.sortOptions.issues_delta_7d,
  };

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.trends.title}</h1>
        <p className="subtitle">{t.trends.subtitle}</p>
      </header>

      <div className="toolbar">
        <div
          className="sort-tabs"
          data-testid="sort-tabs"
          role="group"
          aria-label={t.trends.filters.sortLabel}
        >
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              data-testid={`sort-${key}`}
              className={`sort-tab ${sortBy === key ? "active" : ""}`}
              onClick={() => setSortBy(key)}
              aria-pressed={sortBy === key}
            >
              {sortLabels[key]}
            </button>
          ))}
        </div>

        <div className="trends-filters">
          <select
            className="trends-filter-select"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            aria-label={t.trends.filters.languageLabel}
          >
            <option value="">{t.trends.filters.allLanguages}</option>
            {availableLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>

          <select
            className="trends-filter-select"
            value={minStarsFilter ?? ""}
            onChange={(e) => setMinStarsFilter(e.target.value ? Number(e.target.value) : null)}
            aria-label={t.trends.filters.starsLabel}
          >
            <option value="">{t.trends.filters.minStars}</option>
            {MIN_STARS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                &ge; {formatNumber(n)}
              </option>
            ))}
          </select>

          {reposWithBreakouts.size > 0 && (
            <button
              className={`btn btn-sm${showBreakoutsOnly ? " btn-primary" : ""}`}
              onClick={() => setShowBreakoutsOnly((prev) => !prev)}
              data-testid="trends-breakouts-filter"
              aria-pressed={showBreakoutsOnly}
            >
              {t.trends.breakouts.filter} ({reposWithBreakouts.size})
            </button>
          )}

          <div className="view-mode-toggle" data-testid="view-mode-toggle">
            <button
              className={`view-mode-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => setViewMode("list")}
              aria-label={t.trends.viewMode.list}
              title={t.trends.viewMode.list}
              aria-pressed={viewMode === "list"}
            >
              ☰
            </button>
            <button
              className={`view-mode-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-label={t.trends.viewMode.grid}
              title={t.trends.viewMode.grid}
              aria-pressed={viewMode === "grid"}
            >
              ▦
            </button>
          </div>

          {selection.isActive ? (
            <button
              className="btn btn-sm"
              onClick={handleSelectionDone}
              data-testid="trends-selection-exit"
            >
              {t.trends.selection.exit}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={selection.enter}
              data-testid="trends-selection-enter"
            >
              {t.trends.selection.enter}
            </button>
          )}

          <TrendsExportDropdown
            sortBy={sortBy}
            language={languageFilter}
            minStars={minStarsFilter}
          />

          <div className="trends-refresh-controls" data-testid="trends-refresh-controls">
            <select
              className="trends-filter-select"
              value={refreshInterval === false ? "false" : String(refreshInterval)}
              onChange={(e) => handleRefreshIntervalChange(e.target.value)}
              aria-label={t.trends.autoRefresh.interval}
              data-testid="trends-refresh-select"
            >
              {REFRESH_INTERVALS.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {opt.value === false ? t.trends.autoRefresh.off : `${opt.label}`}
                </option>
              ))}
            </select>
            {refreshInterval !== false && (
              <LastUpdatedIndicator dataUpdatedAt={dataUpdatedAt} t={t.trends.autoRefresh} />
            )}
          </div>
        </div>
      </div>

      {addError && (
        <div className="error-banner" role="alert">
          {addError}
          <button
            className="btn btn-sm"
            onClick={() => setAddError(null)}
            aria-label={t.common.close}
          >
            &times;
          </button>
        </div>
      )}

      {displayedTrends.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          <p>{t.trends.empty}</p>
        </div>
      ) : viewMode === "grid" ? (
        <TrendGrid
          trends={displayedTrends}
          allWatchlistNames={allWatchlistNames}
          addingRepoIds={addingRepoIds}
          onAddToWatchlist={handleAddToWatchlist}
          t={t}
          isSelectionMode={selection.isActive}
          selectedIds={selection.selectedIds}
          onToggleSelection={selection.toggleSelection}
          signalsByRepoId={signalsByRepoId}
        />
      ) : (
        <div className="trends-table" data-testid="trends-table">
          <table>
            <thead>
              <tr>
                <th className="rank-col">{t.trends.columns.rank}</th>
                <th className="repo-col">{t.trends.columns.repo}</th>
                <th className="stars-col">{t.trends.columns.stars}</th>
                <th className="delta-col">{t.trends.columns.delta7d}</th>
                <th className="delta-col">{t.trends.columns.delta30d}</th>
                <th className="velocity-col">{t.trends.columns.velocity}</th>
                <th className="trend-col">{t.repo.trend}</th>
                <th className="delta-col">{t.trends.columns.forksDelta7d}</th>
                <th className="delta-col">{t.trends.columns.issuesDelta7d}</th>
                <th className="action-col" />
              </tr>
            </thead>
            <tbody>
              {displayedTrends.map((repo) => (
                <Fragment key={repo.id}>
                  <TrendRow
                    repo={repo}
                    isInWatchlist={allWatchlistNames.has(repo.full_name.toLowerCase())}
                    isAdding={addingRepoIds.has(repo.id)}
                    onAddToWatchlist={handleAddToWatchlist}
                    isExpanded={expandedRepoId === repo.id}
                    onToggleExpand={handleToggleExpand}
                    t={t}
                    isSelectionMode={selection.isActive}
                    isSelected={selection.selectedIds.has(repo.id)}
                    onToggleSelection={selection.toggleSelection}
                    signals={signalsByRepoId[repo.id]}
                  />
                  {expandedRepoId === repo.id && (
                    <TrendExpandedRow repo={repo} onClose={handleCloseExpand} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selection.isActive && (
        <TrendsBatchAddBar
          selectedRepos={selectedRepos}
          selectedCount={selection.selectedCount}
          onDone={handleSelectionDone}
          onError={setAddError}
        />
      )}
    </AnimatedPage>
  );
}
