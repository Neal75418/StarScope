/**
 * Commit 活躍度徽章，顯示每週平均 commit 數。
 */

import { useCommitActivitySummary } from "../hooks/useCommitActivitySummary";
import { useI18n, interpolate } from "../i18n";

interface CommitActivityBadgeProps {
  repoId: number;
}

// 依每週 commit 數對應顏色
const ACTIVITY_COLORS: Record<string, { bg: string; text: string }> = {
  high: { bg: "#14532d", text: "#86efac" }, // ≥10/wk - very active
  medium: { bg: "#166534", text: "#86efac" }, // 5-9/wk - active
  low: { bg: "#ca8a04", text: "#fef9c3" }, // 1-4/wk - moderate
  inactive: { bg: "#6b7280", text: "#f3f4f6" }, // 0/wk - inactive
};

function getActivityLevel(avgCommitsPerWeek: number): string {
  if (avgCommitsPerWeek >= 10) return "high";
  if (avgCommitsPerWeek >= 5) return "medium";
  if (avgCommitsPerWeek >= 1) return "low";
  return "inactive";
}

function LoadingBadge() {
  return <span className="activity-badge activity-badge-loading">...</span>;
}

function ErrorBadge({ error }: { error: string }) {
  return (
    <span className="activity-badge activity-badge-error" title={error}>
      !
    </span>
  );
}

function EmptyBadge({ fetching, onClick }: { fetching: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="activity-badge activity-badge-empty"
      onClick={onClick}
      disabled={fetching}
      title={t.commitActivity?.clickToFetch ?? "Click to fetch commit activity"}
    >
      {fetching ? "..." : "?"}
    </button>
  );
}

function ActivityBadge({
  avgCommitsPerWeek,
  onClick,
  fetching,
}: {
  avgCommitsPerWeek: number;
  onClick: () => void;
  fetching: boolean;
}) {
  const { t } = useI18n();
  const level = getActivityLevel(avgCommitsPerWeek);
  const colors = ACTIVITY_COLORS[level];
  const displayText = `${Math.round(avgCommitsPerWeek)}/wk`;
  const titleText = interpolate(t.commitActivity?.perWeek ?? "{count}/wk", {
    count: Math.round(avgCommitsPerWeek),
  });

  return (
    <button
      className="activity-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={titleText}
      onClick={onClick}
      disabled={fetching}
    >
      {fetching ? "..." : displayText}
    </button>
  );
}

export function CommitActivityBadge({ repoId }: CommitActivityBadgeProps) {
  const { summary, loading, fetching, error, fetchData } = useCommitActivitySummary(repoId);

  if (loading) {
    return <LoadingBadge />;
  }

  if (error) {
    return <ErrorBadge error={error} />;
  }

  const handleClick = () => void fetchData();

  if (!summary) {
    return <EmptyBadge fetching={fetching} onClick={handleClick} />;
  }

  return (
    <ActivityBadge
      avgCommitsPerWeek={summary.avg_commits_per_week}
      onClick={handleClick}
      fetching={fetching}
    />
  );
}
