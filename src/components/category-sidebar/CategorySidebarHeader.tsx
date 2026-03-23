/**
 * 分類側邊欄標題列，含新增按鈕。
 */

import { useI18n } from "../../i18n";

interface CategorySidebarHeaderProps {
  showAddForm: boolean;
  onToggleAddForm: () => void;
  disabled?: boolean;
}

export function CategorySidebarHeader({
  showAddForm,
  onToggleAddForm,
  disabled,
}: CategorySidebarHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="category-sidebar-header">
      <h3>{t.categories.title}</h3>
      <button
        className="btn btn-sm"
        onClick={onToggleAddForm}
        disabled={disabled}
        title={t.categories.addCategory}
        aria-label={t.categories.addCategory}
        aria-expanded={showAddForm}
      >
        {showAddForm ? "−" : "+"}
      </button>
    </div>
  );
}
