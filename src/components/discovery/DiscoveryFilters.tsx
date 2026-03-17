/**
 * Discovery 頁面的篩選下拉選單，含語言、授權、排序、Topic、Stars 範圍。
 */

import { useState, useCallback, useEffect, FormEvent } from "react";
import { useI18n } from "../../i18n";
import { SearchFilters } from "../../api/client";
import type { SortOption } from "../../hooks/useDiscovery";
import { SortAscIcon, SortDescIcon } from "../Icons";
import styles from "./Discovery.module.css";

const LANGUAGES = [
  { value: "", label: "" },
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

const LICENSES = [
  { value: "", label: "" },
  { value: "mit", label: "MIT" },
  { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GPL 3.0" },
  { value: "bsd-2-clause", label: "BSD 2-Clause" },
  { value: "bsd-3-clause", label: "BSD 3-Clause" },
  { value: "isc", label: "ISC" },
  { value: "mpl-2.0", label: "MPL 2.0" },
  { value: "lgpl-3.0", label: "LGPL 3.0" },
  { value: "agpl-3.0", label: "AGPL 3.0" },
  { value: "unlicense", label: "Unlicense" },
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
  { value: 0, label: "" },
  { value: 100, label: "100+" },
  { value: 500, label: "500+" },
  { value: 1000, label: "1,000+" },
  { value: 5000, label: "5,000+" },
  { value: 10000, label: "10,000+" },
] as const;

const MAX_STARS_OPTIONS = [
  { value: 0, label: "" },
  { value: 1000, label: "\u2264 1,000" },
  { value: 5000, label: "\u2264 5,000" },
  { value: 10000, label: "\u2264 10,000" },
  { value: 50000, label: "\u2264 50,000" },
  { value: 100000, label: "\u2264 100,000" },
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

  const isAsc = filters.order === "asc";

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
        value={filters.license || ""}
        onChange={(e) => onFiltersChange({ ...filters, license: e.target.value || undefined })}
      >
        {LICENSES.map((lic) => (
          <option key={lic.value} value={lic.value}>
            {lic.value === "" ? t.discovery.filters.allLicenses : lic.label}
          </option>
        ))}
      </select>

      <div className={styles.sortGroup}>
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
        <button
          type="button"
          className={styles.orderToggle}
          onClick={() => onFiltersChange({ ...filters, order: isAsc ? "desc" : "asc" })}
          title={isAsc ? t.discovery.filters.ascending : t.discovery.filters.descending}
          aria-label={isAsc ? t.discovery.filters.ascending : t.discovery.filters.descending}
        >
          {isAsc ? <SortAscIcon size={14} /> : <SortDescIcon size={14} />}
        </button>
      </div>

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

      <select
        className={styles.filterSelect}
        value={filters.maxStars || 0}
        onChange={(e) => {
          const val = Number(e.target.value);
          onFiltersChange({ ...filters, maxStars: val || undefined });
        }}
      >
        {MAX_STARS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value === 0
              ? `${t.discovery.filters.maxStars}: ${t.discovery.filters.anyStars}`
              : `${t.discovery.filters.maxStars}: ${opt.label}`}
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

      <label className={styles.hideArchivedLabel}>
        <input
          type="checkbox"
          checked={filters.hideArchived || false}
          onChange={(e) =>
            onFiltersChange({ ...filters, hideArchived: e.target.checked || undefined })
          }
        />
        {t.discovery.filters.hideArchived}
      </label>
    </div>
  );
}
