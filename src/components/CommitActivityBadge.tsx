/**
 * Commit 活躍度徽章，顯示每週平均 commit 數。
 */

import { useCommitActivitySummary } from "../hooks/useCommitActivitySummary";
import { useI18n, interpolate } from "../i18n";
import { StatusBadge } from "./StatusBadge";

interface CommitActivityBadgeProps {
  repoId: number;
}

function getActivityLevel(avgCommitsPerWeek: number): string {
  if (avgCommitsPerWeek >= 10) return "high";
  if (avgCommitsPerWeek >= 5) return "medium";
  if (avgCommitsPerWeek >= 1) return "low";
  return "inactive";
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
  const displayText = `${Math.round(avgCommitsPerWeek)}/wk`;
  const titleText = interpolate(t.commitActivity?.perWeek ?? "{count}/wk", {
    count: Math.round(avgCommitsPerWeek),
  });

  return (
    <button
      className={`activity-badge ${level}`}
      title={titleText}
      onClick={onClick}
      disabled={fetching}
    >
      {fetching ? "..." : displayText}
    </button>
  );
}

export function CommitActivityBadge({ repoId }: CommitActivityBadgeProps) {
  const { t } = useI18n();
  const { summary, loading, fetching, error, fetchData } = useCommitActivitySummary(repoId);

  if (loading) {
    return <StatusBadge variant="loading" classPrefix="activity-badge" />;
  }

  if (error) {
    return <StatusBadge variant="error" classPrefix="activity-badge" error={error} />;
  }

  const handleClick = () => void fetchData();

  if (!summary) {
    return (
      <StatusBadge
        variant="empty"
        classPrefix="activity-badge"
        fetching={fetching}
        onClick={handleClick}
        emptyTooltip={t.commitActivity?.clickToFetch ?? "Click to fetch commit activity"}
      />
    );
  }

  return (
    <ActivityBadge
      avgCommitsPerWeek={summary.avg_commits_per_week}
      onClick={handleClick}
      fetching={fetching}
    />
  );
}
