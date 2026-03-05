/**
 * 顯示目前啟用的篩選條件，含移除按鈕。
 */

import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

function FilterTag({
  label,
  onRemove,
  filterType,
}: {
  label: string;
  onRemove: () => void;
  filterType: string;
}) {
  const { t } = useI18n();
  return (
    <span className={styles.activeFilterTag}>
      {label}
      <button
        className={styles.removeFilterBtn}
        onClick={onRemove}
        aria-label={t.discovery.removeFilter.replace("{type}", filterType)}
      >
        ×
      </button>
    </span>
  );
}

interface ActiveFiltersProps {
  keyword?: string;
  period?: string;
  language?: string;
  topic?: string;
  minStars?: number;
  onRemoveKeyword: () => void;
  onRemovePeriod: () => void;
  onRemoveLanguage: () => void;
  onRemoveTopic: () => void;
  onRemoveMinStars: () => void;
  onClearAll: () => void;
}

export function ActiveFilters({
  keyword,
  period,
  language,
  topic,
  minStars,
  onRemoveKeyword,
  onRemovePeriod,
  onRemoveLanguage,
  onRemoveTopic,
  onRemoveMinStars,
  onClearAll,
}: ActiveFiltersProps) {
  const { t } = useI18n();

  if (!keyword && !period && !language && !topic && !minStars) {
    return null;
  }

  return (
    <div className={styles.activeFilters}>
      <span className={styles.activeFiltersLabel}>{t.discovery.currentFilters}</span>
      <div className={styles.activeFilterTags}>
        {keyword && (
          <FilterTag label={`"${keyword}"`} onRemove={onRemoveKeyword} filterType="keyword" />
        )}
        {period && <FilterTag label={period} onRemove={onRemovePeriod} filterType="period" />}
        {language && (
          <FilterTag label={language} onRemove={onRemoveLanguage} filterType="language" />
        )}
        {topic && <FilterTag label={`#${topic}`} onRemove={onRemoveTopic} filterType="topic" />}
        {minStars != null && minStars > 0 && (
          <FilterTag
            label={`★ ≥ ${minStars.toLocaleString()}`}
            onRemove={onRemoveMinStars}
            filterType="min stars"
          />
        )}
        <button className={styles.clearAllBtn} onClick={onClearAll}>
          {t.discovery.clearAll}
        </button>
      </div>
    </div>
  );
}
