/**
 * Trending time range filters - mimics GitHub Trending page.
 * Options: Today, This Week, This Month
 */

import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

export type TrendingPeriod = "daily" | "weekly" | "monthly";

interface TrendingFiltersProps {
  activePeriod?: TrendingPeriod;
  onSelectPeriod: (period: TrendingPeriod) => void;
}

export function TrendingFilters({ activePeriod, onSelectPeriod }: TrendingFiltersProps) {
  const { t } = useI18n();

  const periods: { value: TrendingPeriod; labelKey: keyof typeof t.discovery.trending }[] = [
    { value: "daily", labelKey: "today" },
    { value: "weekly", labelKey: "thisWeek" },
    { value: "monthly", labelKey: "thisMonth" },
  ];

  return (
    <div className={styles.trendingSection}>
      <span className={styles.trendingLabel}>{t.discovery.trending.label}</span>
      <div className={styles.trendingTags}>
        {periods.map((period) => (
          <button
            key={period.value}
            className={`${styles.trendingTag} ${activePeriod === period.value ? styles.active : ""}`}
            onClick={() => onSelectPeriod(period.value)}
          >
            {t.discovery.trending[period.labelKey]}
          </button>
        ))}
      </div>
    </div>
  );
}
