/**
 * Simplified filter dropdowns for Discovery page.
 * Only language and sort - keeping it simple and human-friendly.
 */

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

const SORT_OPTIONS: { value: SortOption; labelKey: keyof typeof import("../../i18n/translations").translations.en.discovery.filters }[] = [
  { value: "stars", labelKey: "sortByStars" },
  { value: "forks", labelKey: "sortByForks" },
  { value: "updated", labelKey: "sortByUpdated" },
];

interface DiscoveryFiltersProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
}

export function DiscoveryFilters({ filters, onFiltersChange }: DiscoveryFiltersProps) {
  const { t } = useI18n();

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
    </div>
  );
}
