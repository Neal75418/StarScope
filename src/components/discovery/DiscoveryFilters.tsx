/**
 * Discovery 頁面的篩選下拉選單，含語言、排序、Topic、Min Stars。
 */

import { useState, useCallback, useEffect, FormEvent } from "react";
import { useI18n } from "../../i18n";
import { SearchFilters } from "../../api/client";
import type { SortOption } from "../../hooks/useDiscovery";
import styles from "./Discovery.module.css";

const LANGUAGES = [
  { value: "", labelKey: "allLanguages" as const },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "c++", label: "C++" },
  { value: "c#", label: "C#" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
] as const;

const SORT_OPTIONS: {
  value: SortOption;
  labelKey: keyof typeof import("../../i18n/translations").translations.en.discovery.filters;
}[] = [
  { value: "stars", labelKey: "sortByStars" },
  { value: "forks", labelKey: "sortByForks" },
  { value: "updated", labelKey: "sortByUpdated" },
];

const MIN_STARS_OPTIONS = [
  { value: 0, labelKey: "anyStars" as const },
  { value: 100, label: "100+" },
  { value: 500, label: "500+" },
  { value: 1000, label: "1,000+" },
  { value: 5000, label: "5,000+" },
  { value: 10000, label: "10,000+" },
] as const;

interface DiscoveryFiltersProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
}

export function DiscoveryFilters({ filters, onFiltersChange }: DiscoveryFiltersProps) {
  const { t } = useI18n();
  const [topicInput, setTopicInput] = useState(filters.topic || "");

  // 當父層重置 filters 時同步 topic 輸入（例如 "Clear All"）
  useEffect(() => {
    setTopicInput(filters.topic || "");
  }, [filters.topic]);

  const handleTopicSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = topicInput.trim();
      onFiltersChange({ ...filters, topic: trimmed || undefined });
    },
    [topicInput, filters, onFiltersChange]
  );

  const handleTopicBlur = useCallback(() => {
    const trimmed = topicInput.trim();
    if (trimmed !== (filters.topic || "")) {
      onFiltersChange({ ...filters, topic: trimmed || undefined });
    }
  }, [topicInput, filters, onFiltersChange]);

  return (
    <div className={styles.filters}>
      <select
        className={styles.filterSelect}
        value={filters.language || ""}
        onChange={(e) => onFiltersChange({ ...filters, language: e.target.value || undefined })}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.value === "" ? t.discovery.filters.allLanguages : lang.label}
          </option>
        ))}
      </select>

      <select
        className={styles.filterSelect}
        value={filters.sort || "stars"}
        onChange={(e) => onFiltersChange({ ...filters, sort: e.target.value as SortOption })}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t.discovery.filters[opt.labelKey]}
          </option>
        ))}
      </select>

      <select
        className={styles.filterSelect}
        value={filters.minStars || 0}
        onChange={(e) => {
          const val = Number(e.target.value);
          onFiltersChange({ ...filters, minStars: val || undefined });
        }}
      >
        {MIN_STARS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value === 0
              ? `${t.discovery.filters.minStars}: ${t.discovery.filters.anyStars}`
              : `${t.discovery.filters.minStars}: ${opt.label}`}
          </option>
        ))}
      </select>

      <form onSubmit={handleTopicSubmit} className={styles.topicForm}>
        <input
          type="text"
          className={styles.topicInput}
          placeholder={t.discovery.filters.topicPlaceholder}
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
          onBlur={handleTopicBlur}
        />
      </form>
    </div>
  );
}
