/**
 * Result card for a discovered repository.
 */

import { DiscoveryRepo } from "../../api/client";
import { StarIcon, ForkIcon, LinkExternalIcon } from "../Icons";
import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface DiscoveryResultCardProps {
  repo: DiscoveryRepo;
  isInWatchlist: boolean;
  onAddToWatchlist: (repo: DiscoveryRepo) => void;
  isAdding?: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

export function DiscoveryResultCard({
  repo,
  isInWatchlist,
  onAddToWatchlist,
  isAdding = false,
}: DiscoveryResultCardProps) {
  const { t } = useI18n();

  return (
    <div className={styles.resultCard}>
      <div className={styles.cardHeader}>
        <a href={repo.url} target="_blank" rel="noopener noreferrer" className={styles.repoName}>
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

// Language colors (subset of GitHub's language colors)
function getLanguageColor(language: string): string {
  const colors: Record<string, string> = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Rust: "#dea584",
    Go: "#00ADD8",
    Java: "#b07219",
    "C++": "#f34b7d",
    "C#": "#178600",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    Ruby: "#701516",
    PHP: "#4F5D95",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Shell: "#89e051",
  };
  return colors[language] || "#8b949e";
}
