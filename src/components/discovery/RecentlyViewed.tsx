/**
 * 最近檢視的 repo 列表，可收合。
 */

import { useState, memo } from "react";
import { StarIcon, LinkExternalIcon, XIcon } from "../Icons";
import { useI18n } from "../../i18n";
import { safeOpenUrl } from "../../utils/url";
import { formatNumber } from "../../utils/format";
import { getLanguageColor } from "../../constants/languageColors";
import type { RecentlyViewedRepo } from "../../hooks/useRecentlyViewed";
import styles from "./Discovery.module.css";

interface RecentlyViewedProps {
  repos: RecentlyViewedRepo[];
  onClear: () => void;
}

export const RecentlyViewed = memo(function RecentlyViewed({
  repos,
  onClear,
}: RecentlyViewedProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(true);

  if (repos.length === 0) return null;

  return (
    <div className={styles.recentlyViewed}>
      <div className={styles.recentlyViewedHeader}>
        <button
          type="button"
          className={styles.recentlyViewedToggle}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <span className={styles.recentlyViewedTitle}>
            {t.discovery.recentlyViewed.title} ({repos.length})
          </span>
          <span className={styles.recentlyViewedChevron}>{isExpanded ? "▾" : "▸"}</span>
        </button>
        <button type="button" className={styles.recentlyViewedClear} onClick={onClear}>
          <XIcon size={14} />
          {t.discovery.recentlyViewed.clear}
        </button>
      </div>
      {isExpanded && (
        <div className={styles.recentlyViewedList}>
          {repos.map((repo) => (
            <a
              key={repo.full_name}
              href={`https://github.com/${repo.full_name}`}
              className={styles.recentlyViewedItem}
              onClick={async (e) => {
                e.preventDefault();
                await safeOpenUrl(`https://github.com/${repo.full_name}`);
              }}
            >
              {repo.owner_avatar_url && (
                <img
                  src={repo.owner_avatar_url}
                  alt=""
                  className={styles.recentlyViewedAvatar}
                  loading="lazy"
                />
              )}
              <span className={styles.recentlyViewedName}>{repo.full_name}</span>
              {repo.language && (
                <span className={styles.recentlyViewedLang}>
                  <span
                    className={styles.languageDot}
                    style={{ backgroundColor: getLanguageColor(repo.language) }}
                  />
                  {repo.language}
                </span>
              )}
              <span className={styles.recentlyViewedStars}>
                <StarIcon size={12} />
                {formatNumber(repo.stars)}
              </span>
              <LinkExternalIcon size={12} className={styles.recentlyViewedExternal} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
});
