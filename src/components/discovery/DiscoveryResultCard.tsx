/**
 * 探索結果的 repo 卡片。
 */

import React from "react";
import { DiscoveryRepo } from "../../api/client";
import { StarIcon, ForkIcon, LinkExternalIcon } from "../Icons";
import { useI18n } from "../../i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatNumber } from "../../utils/format";
import { getLanguageColor } from "../../constants/languageColors";
import styles from "./Discovery.module.css";

interface DiscoveryResultCardProps {
  repo: DiscoveryRepo;
  isInWatchlist: boolean;
  onAddToWatchlist: (repo: DiscoveryRepo) => void;
  isAdding?: boolean;
}

export function DiscoveryResultCard({
  repo,
  isInWatchlist,
  onAddToWatchlist,
  isAdding = false,
}: DiscoveryResultCardProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await openUrl(repo.url);
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
      </div>

      {repo.topics.length > 0 && (
        <div className={styles.topics}>
          {repo.topics.slice(0, 5).map((topic) => (
            <span key={topic} className={styles.topic}>
              {topic}
            </span>
          ))}
          {repo.topics.length > 5 && (
            <span className={styles.topicMore}>+{repo.topics.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}
