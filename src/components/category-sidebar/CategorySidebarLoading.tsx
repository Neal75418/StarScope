/**
 * 分類側邊欄的載入中狀態。
 */

import { useI18n } from "../../i18n";

export function CategorySidebarLoading() {
  const { t } = useI18n();

  return (
    <div className="category-sidebar">
      <div className="category-sidebar-header">
        <h3>{t.categories.title}</h3>
      </div>
      <div className="category-sidebar-loading">{t.categories.loading}</div>
    </div>
  );
}
