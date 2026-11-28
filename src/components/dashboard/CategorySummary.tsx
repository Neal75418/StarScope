/**
 * 分類摘要面板。
 * 顯示所有分類的 repo 數量、圖示與顏色。
 */

import { memo } from "react";
import type { CategoryTreeNode } from "../../api/types";
import { useCategoryTreeQuery } from "../../hooks/useCategoryQueries";
import { loadStatus } from "../../lib/react-query";
import { Skeleton } from "../Skeleton";
import { LoadError } from "../LoadError";
import { useI18n } from "../../i18n";
import { useNavigation } from "../../contexts/NavigationContext";

function flattenTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  const result: CategoryTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

interface CategoryCardProps {
  category: CategoryTreeNode;
}

function CategoryCard({ category }: CategoryCardProps) {
  const { t } = useI18n();
  const hasColor = Boolean(category.color);
  return (
    <div
      className="category-summary-card"
      style={hasColor ? { borderLeftColor: category.color ?? undefined } : undefined}
    >
      <div className="category-summary-icon">{category.icon ?? "📁"}</div>
      <div className="category-summary-info">
        <div className="category-summary-name">{category.name}</div>
        <div className="category-summary-count">
          {category.repo_count} {t.dashboard.categorySummary.repos}
        </div>
      </div>
    </div>
  );
}

export const CategorySummary = memo(function CategorySummary() {
  const { t } = useI18n();
  const { navigateTo } = useNavigation();

  // 和 Watchlist 側欄共用同一份分類樹：在那裡改過分類、加入或移出分類之後，這裡打開就是新的
  const query = useCategoryTreeQuery();
  const { data } = query;
  // 跟儀表板主體（useDashboard 的 load）一樣看 loadStatus：第一次就讀不到時說讀不到並給重試（重試中說明與按鈕留著）；
  // 已經有資料時重讀失敗保留內容，另外說沒有更新成功（每次打開儀表板都會重讀，見 useCategoryTreeQuery）
  const load = loadStatus(query);

  if (!load.ready && !load.failed) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.categorySummary.title}</h3>
        <div className="category-summary-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={56} variant="rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!load.ready || !data) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.categorySummary.title}</h3>
        <LoadError
          message={t.dashboard.categorySummary.loadError}
          onRetry={load.retry}
          isRetrying={load.inProgress}
        />
      </div>
    );
  }

  const categories = flattenTree(data.tree).filter((c) => c.repo_count > 0);
  const refreshFailed = load.failed && (
    <LoadError
      message={t.dashboard.categorySummary.refreshFailed}
      onRetry={load.retry}
      isRetrying={load.inProgress}
    />
  );

  if (categories.length === 0) {
    // --fit：空狀態不跟著並排的「最近活動」撐到整欄高，
    // 一片幾乎全空的巨大卡片比沒有分類本身更違和
    return (
      <div className="dashboard-section dashboard-section--fit">
        <h3>{t.dashboard.categorySummary.title}</h3>
        {refreshFailed}
        <div className="category-summary-empty">
          <div>{t.dashboard.categorySummary.empty}</div>
          <button
            type="button"
            className="category-summary-cta"
            onClick={() => navigateTo("watchlist")}
          >
            {t.dashboard.categorySummary.emptyCta}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section">
      <h3>
        {t.dashboard.categorySummary.title}
        <span className="section-badge">{categories.length}</span>
      </h3>
      {refreshFailed}
      <div className="category-summary-grid">
        {categories.map((cat) => (
          <CategoryCard key={cat.id} category={cat} />
        ))}
      </div>
    </div>
  );
});
