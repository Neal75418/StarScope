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
        aria-label={t.discovery.removeFilter.replace(
          "{type}",
          (t.discovery.filterTypes as Record<string, string>)?.[filterType] ?? filterType
        )}
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
  maxStars?: number;
  license?: string;
  hideArchived?: boolean;
  onRemoveKeyword: () => void;
  onRemovePeriod: () => void;
  onRemoveLanguage: () => void;
  onRemoveTopic: () => void;
  onRemoveMinStars: () => void;
  onRemoveMaxStars: () => void;
  onRemoveLicense: () => void;
  onRemoveHideArchived: () => void;
  onClearAll: () => void;
}

export function ActiveFilters({
  keyword,
  period,
  language,
  topic,
  minStars,
  maxStars,
  license,
  hideArchived,
  onRemoveKeyword,
  onRemovePeriod,
  onRemoveLanguage,
  onRemoveTopic,
  onRemoveMinStars,
  onRemoveMaxStars,
  onRemoveLicense,
  onRemoveHideArchived,
  onClearAll,
}: ActiveFiltersProps) {
  const { t } = useI18n();

  const hasAny =
    keyword || period || language || topic || minStars || maxStars || license || hideArchived;
  if (!hasAny) {
    return null;
  }

  // 建立星數標籤：範圍、僅最小值、或僅最大值
  const starLabel =
    minStars && maxStars
      ? `\u2605 ${minStars.toLocaleString()} - ${maxStars.toLocaleString()}`
      : minStars
        ? `\u2605 \u2265 ${minStars.toLocaleString()}`
        : null;
  const maxStarLabel = !minStars && maxStars ? `\u2605 \u2264 ${maxStars.toLocaleString()}` : null;

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
        {license && (
          <FilterTag
            label={license.toUpperCase()}
            onRemove={onRemoveLicense}
            filterType="license"
          />
        )}
        {topic && <FilterTag label={`#${topic}`} onRemove={onRemoveTopic} filterType="topic" />}
        {starLabel && (
          <FilterTag label={starLabel} onRemove={onRemoveMinStars} filterType="min stars" />
        )}
        {maxStarLabel && (
          <FilterTag label={maxStarLabel} onRemove={onRemoveMaxStars} filterType="max stars" />
        )}
        {hideArchived && (
          <FilterTag
            label={t.discovery.filters.hideArchived}
            onRemove={onRemoveHideArchived}
            filterType="hide archived"
          />
        )}
        <button className={styles.clearAllBtn} onClick={onClearAll}>
          {t.discovery.clearAll}
        </button>
      </div>
    </div>
  );
}
