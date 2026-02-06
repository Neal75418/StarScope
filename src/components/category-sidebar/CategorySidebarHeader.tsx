/**
 * 分類側邊欄標題列，含新增按鈕。
 */

import { useI18n } from "../../i18n";

interface CategorySidebarHeaderProps {
  showAddForm: boolean;
  onToggleAddForm: () => void;
}

export function CategorySidebarHeader({
  showAddForm,
  onToggleAddForm,
}: CategorySidebarHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="category-sidebar-header">
      <h3>{t.categories.title}</h3>
      <button className="btn btn-sm" onClick={onToggleAddForm} title={t.categories.addCategory}>
        {showAddForm ? "−" : "+"}
      </button>
    </div>
  );
}
