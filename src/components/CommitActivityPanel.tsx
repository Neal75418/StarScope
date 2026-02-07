/**
 * Commit 活躍度面板，視覺化呈現每週 commit 資料。
 */

import { useState, useEffect, useCallback } from "react";
import {
  CommitActivityResponse,
  getCommitActivity,
  fetchCommitActivity,
  ApiError,
} from "../api/client";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";

interface CommitActivityPanelProps {
  repoId: number;
  repoName: string;
  onClose: () => void;
}

/**
 * 依每週平均 commit 數判斷活躍等級。
 */
function getActivityLevel(avgCommits: number): "veryHigh" | "high" | "medium" | "low" | "minimal" {
  if (avgCommits >= 20) return "veryHigh";
  if (avgCommits >= 10) return "high";
  if (avgCommits >= 5) return "medium";
  if (avgCommits >= 1) return "low";
  return "minimal";
}

/**
 * 依 commit 數量取得 heatmap 顏色 class。
 */
function getCommitColor(count: number, maxCount: number): string {
  if (count === 0) return "commit-level-0";
  const ratio = count / Math.max(maxCount, 1);
  if (ratio >= 0.75) return "commit-level-4";
  if (ratio >= 0.5) return "commit-level-3";
  if (ratio >= 0.25) return "commit-level-2";
  return "commit-level-1";
}

function CommitActivityEmptyState({
  fetching,
  onFetch,
  t,
}: {
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="no-data">
      <p>{t.commitActivity.noData}</p>
      <button className="btn btn-primary" onClick={onFetch} disabled={fetching}>
        {fetching ? t.commitActivity.fetching : t.commitActivity.fetch}
      </button>
    </div>
  );
}

function CommitActivityStats({
  data,
  t,
}: {
  data: CommitActivityResponse;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const activityLevel = getActivityLevel(data.avg_commits_per_week);

  return (
    <div className="commit-stats">
      <div className="stat">
        <span className="stat-value">{data.total_commits_52w.toLocaleString()}</span>
        <span className="stat-label">{t.commitActivity.totalCommits}</span>
      </div>
      <div className="stat">
        <span className="stat-value">{data.avg_commits_per_week.toFixed(1)}</span>
        <span className="stat-label">{t.commitActivity.avgPerWeek}</span>
      </div>
      <div className="stat">
        <span className={`activity-badge ${activityLevel}`}>
          {t.commitActivity.activityLevel[activityLevel]}
        </span>
      </div>
    </div>
  );
}

function CommitActivityHeatmap({
  weeks,
  maxCommits,
}: {
  weeks: CommitActivityResponse["weeks"];
  maxCommits: number;
}) {
  return (
    <div className="commit-heatmap">
      <div className="heatmap-grid">
        {weeks.map((week, idx) => (
          <div
            key={idx}
            className={`heatmap-cell ${getCommitColor(week.commit_count, maxCommits)}`}
            title={`${week.week_start}: ${week.commit_count} commits`}
          />
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        <div className="heatmap-cell commit-level-0" />
        <div className="heatmap-cell commit-level-1" />
        <div className="heatmap-cell commit-level-2" />
        <div className="heatmap-cell commit-level-3" />
        <div className="heatmap-cell commit-level-4" />
        <span>More</span>
      </div>
    </div>
  );
}

function CommitActivityActions({
  fetching,
  onFetch,
  t,
}: {
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="commit-activity-actions">
      <button className="btn btn-secondary" onClick={onFetch} disabled={fetching}>
        {fetching ? t.commitActivity.fetching : t.commitActivity.refresh}
      </button>
    </div>
  );
}

function CommitActivityDetails({
  data,
  maxCommits,
  fetching,
  onFetch,
  t,
}: {
  data: CommitActivityResponse;
  maxCommits: number;
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <>
      <CommitActivityStats data={data} t={t} />
      <CommitActivityHeatmap weeks={data.weeks} maxCommits={maxCommits} />
      {data.last_updated && (
        <div className="last-updated">
          {t.commitActivity.lastUpdated.replace(
            "{date}",
            new Date(data.last_updated).toLocaleDateString()
          )}
        </div>
      )}
      <CommitActivityActions fetching={fetching} onFetch={onFetch} t={t} />
    </>
  );
}

function CommitActivityContent({
  loading,
  error,
  data,
  maxCommits,
  fetching,
  onFetch,
  t,
}: {
  loading: boolean;
  error: string | null;
  data: CommitActivityResponse | null;
  maxCommits: number;
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (loading) {
    return <div className="loading">{t.commitActivity.fetching}</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data || data.weeks.length === 0) {
    return <CommitActivityEmptyState fetching={fetching} onFetch={onFetch} t={t} />;
  }

  return (
    <CommitActivityDetails
      data={data}
      maxCommits={maxCommits}
      fetching={fetching}
      onFetch={onFetch}
      t={t}
    />
  );
}

export function CommitActivityPanel({ repoId, repoName, onClose }: CommitActivityPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<CommitActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getCommitActivity(repoId);
      setData(result);
    } catch (err) {
      // 404 表示尚未取得資料，屬正常狀態
      if (err instanceof ApiError && err.status === 404) {
        setData(null);
      } else {
        logger.error("載入 commit 活躍度失敗:", err);
        setError(t.commitActivity.fetchFailed);
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, t]);

  const handleFetch = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);
      const result = await fetchCommitActivity(repoId);
      setData(result);
    } catch {
      setError(t.commitActivity.fetchFailed);
    } finally {
      setFetching(false);
    }
  }, [repoId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 計算最大 commit 數以供顏色比例縮放
  const maxCommits = data?.weeks.reduce((max, w) => Math.max(max, w.commit_count), 0) ?? 0;

  return (
    <div className="commit-activity-overlay" onClick={onClose}>
      <div className="commit-activity-panel" onClick={(e) => e.stopPropagation()}>
        {/* 標題列 */}
        <div className="commit-activity-header">
          <div>
            <h3>{t.commitActivity.title}</h3>
            <span className="repo-name">{repoName}</span>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* 內容區 */}
        <div className="commit-activity-content">
          <CommitActivityContent
            loading={loading}
            error={error}
            data={data}
            maxCommits={maxCommits}
            fetching={fetching}
            onFetch={handleFetch}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
