/**
 * 探索結果的 repo 卡片。
 * 顯示相對更新時間，以及已追蹤 repo 的 StarScope 信號。
 */

import React, { memo } from "react";
import { DiscoveryRepo } from "../../api/client";
import { StarIcon, ForkIcon, LinkExternalIcon } from "../Icons";
import { useI18n } from "../../i18n";
import { safeOpenUrl } from "../../utils/url";
import { formatNumber, formatDelta, formatRelativeTime } from "../../utils/format";
import { getLanguageColor } from "../../constants/languageColors";
import { TREND_ARROWS } from "../../constants/trends";
import type { WatchlistSignal } from "./DiscoveryResults";
import styles from "./Discovery.module.css";

const MAX_VISIBLE_TOPICS = 5;

interface DiscoveryResultCardProps {
  repo: DiscoveryRepo;
  isInWatchlist: boolean;
  onAddToWatchlist: (repo: DiscoveryRepo) => void;
  isAdding?: boolean;
  signal?: WatchlistSignal;
}

export const DiscoveryResultCard = memo(function DiscoveryResultCard({
  repo,
  isInWatchlist,
  onAddToWatchlist,
  isAdding = false,
  signal,
}: DiscoveryResultCardProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await safeOpenUrl(repo.url);
  };

  return (
    <div className={styles.resultCard}>
      <div className={styles.cardHeader}>
        <a href={repo.url} onClick={handleLinkClick} className={styles.repoName}>
          {repo.full_name}
          <LinkExternalIcon size={14} className={styles.externalIcon} />
        </a>
        <button
          className={`${styles.addButton} ${isInWatchlist ? styles.inWatchlist : ""}`}
          onClick={() => onAddToWatchlist(repo)}
          disabled={isInWatchlist || isAdding}
        >
          {isInWatchlist ? t.discovery.inWatchlist : t.discovery.addToWatchlist}
        </button>
      </div>

      {repo.description && <p className={styles.description}>{repo.description}</p>}

      <div className={styles.cardMeta}>
        {repo.language && (
          <span className={styles.language}>
            <span
              className={styles.languageDot}
              style={{ backgroundColor: getLanguageColor(repo.language) }}
            />
            {repo.language}
          </span>
        )}
        <span className={styles.stat}>
          <StarIcon size={14} />
          {formatNumber(repo.stars)}
        </span>
        <span className={styles.stat}>
          <ForkIcon size={14} />
          {formatNumber(repo.forks)}
        </span>
        {repo.updated_at && (
          <span className={styles.updatedAt}>{formatRelativeTime(repo.updated_at)}</span>
        )}
        {signal && signal.velocity != null && (
          <span className={styles.signalBadge}>
            {formatDelta(signal.velocity)}/d
            {signal.trend != null && ` ${TREND_ARROWS[signal.trend] ?? "→"}`}
          </span>
        )}
      </div>

      {repo.topics.length > 0 && (
        <div className={styles.topics}>
          {repo.topics.slice(0, MAX_VISIBLE_TOPICS).map((topic) => (
            <span key={topic} className={styles.topic}>
              {topic}
            </span>
          ))}
          {repo.topics.length > MAX_VISIBLE_TOPICS && (
            <span className={styles.topicMore}>+{repo.topics.length - MAX_VISIBLE_TOPICS}</span>
          )}
        </div>
      )}
    </div>
  );
});
