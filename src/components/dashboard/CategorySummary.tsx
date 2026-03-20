/**
 * 分類摘要面板。
 * 顯示所有分類的 repo 數量、圖示與顏色。
 */

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCategoryTree } from "../../api/client";
import type { CategoryTreeNode } from "../../api/types";
import { queryKeys } from "../../lib/react-query";
import { Skeleton } from "../Skeleton";
import { useI18n } from "../../i18n";

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

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard.categories(),
    queryFn: () => getCategoryTree(),
  });

  if (isLoading) {
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

  if (error) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.categorySummary.title}</h3>
        <div className="category-summary-empty">{t.dashboard.categorySummary.loadError}</div>
      </div>
    );
  }

  const categories = data ? flattenTree(data.tree).filter((c) => c.repo_count > 0) : [];

  if (categories.length === 0) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.categorySummary.title}</h3>
        <div className="category-summary-empty">{t.dashboard.categorySummary.empty}</div>
      </div>
    );
  }

  return (
    <div className="dashboard-section">
      <h3>
        {t.dashboard.categorySummary.title}
        <span className="section-badge">{categories.length}</span>
      </h3>
      <div className="category-summary-grid">
        {categories.map((cat) => (
          <CategoryCard key={cat.id} category={cat} />
        ))}
      </div>
    </div>
  );
});
