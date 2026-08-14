/**
 * 空狀態元件：依篩選情境顯示對應的空白畫面。
 */

import { useI18n } from "../../i18n";
import { EmptyState } from "../../components/EmptyState";

interface EmptyStateViewProps {
  hasRepos: boolean;
  hasSearch: boolean;
  onGoDiscover: () => void;
}

export function EmptyStateView({ hasRepos, hasSearch, onGoDiscover }: EmptyStateViewProps) {
  const { t } = useI18n();

  if (!hasRepos) {
    // 主按鈕導向探索頁：取得 repo 的主線是「feed → ⭐」（與儀表板引導卡同一敘事）。
    // 手動輸入仍可用，但入口是工具列上方的「新增儲存庫」，說明文字有指路——
    // 面板裡不再放第二顆按鈕，避免與正上方的工具列按鈕同屏做同一件事。
    return (
      <EmptyState
        title={t.watchlist.empty.noRepos}
        description={t.watchlist.empty.addPrompt}
        actionLabel={t.dashboard.onboard.cta}
        onAction={onGoDiscover}
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
