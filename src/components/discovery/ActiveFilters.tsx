/**
 * Shows currently active filters with remove buttons.
 * Supports: keyword, time period, and language filters.
 */

import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface ActiveFiltersProps {
  keyword?: string;
  period?: string;
  language?: string;
  onRemoveKeyword: () => void;
  onRemovePeriod: () => void;
  onRemoveLanguage: () => void;
  onClearAll: () => void;
}

export function ActiveFilters({
  keyword,
  period,
  language,
  onRemoveKeyword,
  onRemovePeriod,
  onRemoveLanguage,
  onClearAll,
}: ActiveFiltersProps) {
  const { t } = useI18n();

  // Don't render if no filters are active
  if (!keyword && !period && !language) {
    return null;
  }

  return (
    <div className={styles.activeFilters}>
      <span className={styles.activeFiltersLabel}>{t.discovery.currentFilters}</span>
      <div className={styles.activeFilterTags}>
        {keyword && (
          <span className={styles.activeFilterTag}>
            &quot;{keyword}&quot;
            <button
              className={styles.removeFilterBtn}
              onClick={onRemoveKeyword}
              aria-label={`Remove keyword filter`}
            >
              ×
            </button>
          </span>
        )}
        {period && (
          <span className={styles.activeFilterTag}>
            {period}
            <button
              className={styles.removeFilterBtn}
              onClick={onRemovePeriod}
              aria-label={`Remove period filter`}
            >
              ×
            </button>
          </span>
        )}
        {language && (
          <span className={styles.activeFilterTag}>
            {language}
            <button
              className={styles.removeFilterBtn}
              onClick={onRemoveLanguage}
              aria-label={`Remove language filter`}
            >
              ×
            </button>
          </span>
        )}
        <button className={styles.clearAllBtn} onClick={onClearAll}>
          {t.discovery.clearAll}
        </button>
      </div>
    </div>
  );
}
