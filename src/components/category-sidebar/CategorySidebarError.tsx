/**
 * Error state for category sidebar.
 */

import { useI18n } from "../../i18n";

interface CategorySidebarErrorProps {
  error: string;
}

export function CategorySidebarError({ error }: CategorySidebarErrorProps) {
  const { t } = useI18n();

  return (
    <div className="category-sidebar">
      <div className="category-sidebar-header">
        <h3>{t.categories.title}</h3>
      </div>
      <div className="category-sidebar-error">{error}</div>
    </div>
  );
}
