/**
 * 趨勢頁面，依不同指標排序顯示 repo，支援語言與星數篩選、快速加入追蹤。
 */

import React, { useState, useMemo, useCallback } from "react";
import { TrendArrow } from "../components/TrendArrow";
import { Skeleton } from "../components/Skeleton";
import { AnimatedPage } from "../components/motion";
import { formatNumber, formatDelta } from "../utils/format";
import { useI18n } from "../i18n";
import { useTrends, SortOption, TrendingRepo } from "../hooks/useTrends";
import { addRepo } from "../api/client";
import { useWatchlistState } from "../contexts/WatchlistContext";
import { logger } from "../utils/logger";
import { safeOpenUrl } from "../utils/url";

const SORT_KEYS: SortOption[] = ["velocity", "stars_delta_7d", "stars_delta_30d", "acceleration"];

const MIN_STARS_OPTIONS = [0, 100, 500, 1000, 5000, 10000];

const TrendRow = React.memo(function TrendRow({
  repo,
  isInWatchlist,
  isAdding,
  onAddToWatchlist,
  t,
}: {
  repo: TrendingRepo;
  isInWatchlist: boolean;
  isAdding: boolean;
  onAddToWatchlist: (repo: TrendingRepo) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await safeOpenUrl(repo.url);
  };

  return (
    <tr>
      <td className="rank-col">
        <span className="rank-badge">{repo.rank}</span>
      </td>
      <td className="repo-col">
        <a href={repo.url} onClick={handleLinkClick} className="repo-link">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
      </td>
      <td className="stars-col">{formatNumber(repo.stars)}</td>
      <td className="delta-col positive">{formatDelta(repo.stars_delta_7d)}</td>
      <td className="delta-col positive">{formatDelta(repo.stars_delta_30d)}</td>
      <td className="velocity-col">{repo.velocity !== null ? repo.velocity.toFixed(1) : "—"}</td>
      <td className="trend-col">
        <TrendArrow trend={repo.trend} />
      </td>
      <td className="action-col">
        {isInWatchlist ? (
          <span className="trends-in-watchlist">{t.trends.filters.inWatchlist}</span>
        ) : (
          <button
            className="btn btn-sm btn-outline trends-add-btn"
            onClick={() => onAddToWatchlist(repo)}
            disabled={isAdding}
          >
            {t.trends.filters.addToWatchlist}
          </button>
        )}
      </td>
    </tr>
  );
});

export function Trends() {
  const { t } = useI18n();
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
  } = useTrends();

  // Watchlist 狀態 — 從 Context 讀取，避免重複 API 請求
  const watchlistState = useWatchlistState();
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());
  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const allWatchlistNames = useMemo(() => {
    const names = new Set(watchlistState.repos.map((r) => r.full_name.toLowerCase()));
    locallyAdded.forEach((n) => names.add(n));
    return names;
  }, [watchlistState.repos, locallyAdded]);

  const handleAddToWatchlist = useCallback(async (repo: TrendingRepo) => {
    setAddingRepoId(repo.id);
    setAddError(null);
    try {
      await addRepo({ owner: repo.owner, name: repo.name });
      setLocallyAdded((prev) => new Set(prev).add(repo.full_name.toLowerCase()));
    } catch (err) {
      logger.error("[Trends] 加入追蹤失敗:", err);
      setAddError(`Failed to add ${repo.full_name}`);
    } finally {
      setAddingRepoId(null);
    }
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
            {Array.from({ length: 4 }).map((_, i) => (
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
    return (
      <div className="error-container">
        <h2>{t.trends.loadingError}</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={retry}>
          {t.trends.retry}
        </button>
      </div>
    );
  }

  const sortLabels: Record<SortOption, string> = {
    velocity: t.trends.sortOptions.velocity,
    stars_delta_7d: t.trends.sortOptions.stars_delta_7d,
    stars_delta_30d: t.trends.sortOptions.stars_delta_30d,
    acceleration: t.trends.sortOptions.acceleration,
  };

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.trends.title}</h1>
        <p className="subtitle">{t.trends.subtitle}</p>
      </header>

      <div className="toolbar">
        <div className="sort-tabs" data-testid="sort-tabs" role="tablist" aria-label="Sort options">
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              data-testid={`sort-${key}`}
              className={`sort-tab ${sortBy === key ? "active" : ""}`}
              onClick={() => setSortBy(key)}
              role="tab"
              aria-selected={sortBy === key}
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
            aria-label="Filter by language"
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
            aria-label="Minimum stars"
          >
            <option value="">{t.trends.filters.minStars}</option>
            {MIN_STARS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                ≥ {formatNumber(n)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {addError && (
        <div className="error-banner" role="alert">
          {addError}
          <button className="btn btn-sm" onClick={() => setAddError(null)}>
            ✕
          </button>
        </div>
      )}

      {trends.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          <p>{t.trends.empty}</p>
        </div>
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
                <th className="action-col" />
              </tr>
            </thead>
            <tbody>
              {trends.map((repo) => (
                <TrendRow
                  key={repo.id}
                  repo={repo}
                  isInWatchlist={allWatchlistNames.has(repo.full_name.toLowerCase())}
                  isAdding={addingRepoId === repo.id}
                  onAddToWatchlist={handleAddToWatchlist}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnimatedPage>
  );
}
