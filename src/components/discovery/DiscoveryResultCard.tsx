/**
 * 探索結果的 repo 卡片。
 * 顯示相對更新時間，以及已追蹤 repo 的 StarScope 信號。
 */

import React, { memo } from "react";
import { DiscoveryRepo } from "../../api/client";
import { StarIcon, ForkIcon, LinkExternalIcon, IssueOpenedIcon, LawIcon } from "../Icons";
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
  onView?: (repo: DiscoveryRepo) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: number) => void;
  /** Grid 模式下啟用緊湊佈局 */
  compact?: boolean;
}

export const DiscoveryResultCard = memo(function DiscoveryResultCard({
  repo,
  isInWatchlist,
  onAddToWatchlist,
  isAdding = false,
  signal,
  onView,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  compact = false,
}: DiscoveryResultCardProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onView?.(repo);
    await safeOpenUrl(repo.url);
  };

  const cardClassName = [
    styles.resultCard,
    repo.archived ? styles.archivedCard : "",
    isSelected ? styles.selectedCard : "",
    compact ? styles.compactCard : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClassName}>
      {repo.archived && <span className={styles.archivedBadge}>{t.discovery.archived}</span>}
      <div className={styles.cardHeader}>
        {isSelectionMode && (
          <input
            type="checkbox"
            className={styles.selectionCheckbox}
            checked={isSelected}
            onChange={() => onToggleSelection?.(repo.id)}
          />
        )}
        {repo.owner_avatar_url && (
          <img src={repo.owner_avatar_url} alt="" className={styles.ownerAvatar} loading="lazy" />
        )}
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

      {repo.description && (
        <p className={`${styles.description} ${compact ? styles.descriptionCompact : ""}`}>
          {repo.description}
        </p>
      )}

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
        <span className={styles.stat}>
          <IssueOpenedIcon size={14} />
          {formatNumber(repo.open_issues_count)}
        </span>
        {repo.license_spdx && (
          <span className={styles.licenseBadge}>
            <LawIcon size={14} />
            {repo.license_spdx}
          </span>
        )}
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

      {!compact && repo.topics.length > 0 && (
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
