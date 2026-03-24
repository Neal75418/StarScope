/**
 * 空狀態元件：依篩選情境顯示對應的空白畫面。
 */

import { useI18n } from "../../i18n";
import { EmptyState } from "../../components/EmptyState";

interface EmptyStateViewProps {
  hasRepos: boolean;
  hasSearch: boolean;
  onAddRepo: () => void;
}

export function EmptyStateView({ hasRepos, hasSearch, onAddRepo }: EmptyStateViewProps) {
  const { t } = useI18n();

  if (!hasRepos) {
    return (
      <EmptyState
        title={t.watchlist.empty.noRepos}
        description={t.watchlist.empty.addPrompt}
        actionLabel={t.watchlist.addRepo}
        onAction={onAddRepo}
      />
    );
  }
  if (hasSearch) {
    return (
      <EmptyState
        title={t.watchlist.empty.noSearch}
        description={t.watchlist.empty.noSearchDesc}
        icon={
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        }
      />
    );
  }
  // 分類篩選啟用但無匹配 repo
  return (
    <EmptyState
      title={t.watchlist.empty.noCategory}
      description={t.watchlist.empty.noCategoryDesc}
      icon={
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      }
    />
  );
}
