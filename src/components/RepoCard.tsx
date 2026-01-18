/**
 * Repository card component displaying repo info, signals, and context badges.
 */

import { useState, useEffect } from "react";
import {
  RepoWithSignals,
  getContextBadges,
  ContextBadge,
  HealthScoreResponse,
  getRepoTags,
  RepoTag,
} from "../api/client";
import { TrendArrow } from "./TrendArrow";
import { ContextBadges } from "./ContextBadges";
import { StarsChart } from "./StarsChart";
import { HealthBadge } from "./HealthBadge";
import { HealthScorePanel } from "./HealthScorePanel";
import { TagList } from "./TagBadge";
import { SimilarRepos } from "./SimilarRepos";
import { formatNumber, formatDelta, formatVelocity } from "../utils/format";
import { useI18n } from "../i18n";

interface RepoCardProps {
  repo: RepoWithSignals;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  isLoading?: boolean;
}

export function RepoCard({ repo, onFetch, onRemove, isLoading }: RepoCardProps) {
  const { t } = useI18n();
  const [badges, setBadges] = useState<ContextBadge[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const [tags, setTags] = useState<RepoTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [healthDetails, setHealthDetails] = useState<HealthScoreResponse | null>(null);

  // Fetch context badges
  useEffect(() => {
    let isMounted = true;
    setBadgesLoading(true);

    getContextBadges(repo.id)
      .then((response) => {
        if (isMounted) {
          setBadges(response.badges);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load badges:", err);
        }
      })
      .finally(() => {
        if (isMounted) {
          setBadgesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [repo.id]);

  // Fetch tags
  useEffect(() => {
    let isMounted = true;
    setTagsLoading(true);

    getRepoTags(repo.id)
      .then((response) => {
        if (isMounted) {
          setTags(response.tags);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load tags:", err);
        }
      })
      .finally(() => {
        if (isMounted) {
          setTagsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [repo.id]);

  return (
    <div className="repo-card">
      <div className="repo-header">
        <div className="repo-info">
          <a href={repo.url} target="_blank" rel="noopener noreferrer" className="repo-name">
            {repo.full_name}
          </a>
          {repo.language && <span className="repo-language">{repo.language}</span>}
          <HealthBadge repoId={repo.id} onShowDetails={setHealthDetails} />
        </div>
        <div className="repo-actions">
          <button
            onClick={() => setShowChart(!showChart)}
            className={`btn btn-sm ${showChart ? "active" : ""}`}
            title={t.repo.chart}
          >
            {showChart ? t.repo.hide : t.repo.chart}
          </button>
          <button
            onClick={() => setShowSimilar(!showSimilar)}
            className={`btn btn-sm ${showSimilar ? "active" : ""}`}
            title={t.repo.similar}
          >
            {t.repo.similar}
          </button>
          <button
            onClick={() => onFetch(repo.id)}
            disabled={isLoading}
            className="btn btn-sm"
            title={t.repo.refresh}
          >
            {t.repo.refresh}
          </button>
          <button
            onClick={() => onRemove(repo.id)}
            disabled={isLoading}
            className="btn btn-sm btn-danger"
            title={t.repo.remove}
          >
            {t.repo.remove}
          </button>
        </div>
      </div>

      {/* Context Badges */}
      {badgesLoading ? (
        <div className="badges-loading">{t.repo.loadingBadges}</div>
      ) : (
        <ContextBadges badges={badges} />
      )}

      {/* Tags */}
      {tagsLoading ? (
        <div className="tags-loading">{t.repo.loadingTags}</div>
      ) : tags.length > 0 ? (
        <TagList tags={tags} maxVisible={6} />
      ) : null}

      {repo.description && <p className="repo-description">{repo.description}</p>}

      <div className="repo-stats">
        <div className="stat">
          <span className="stat-label">{t.repo.stars}</span>
          <span className="stat-value">{formatNumber(repo.stars)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">7d</span>
          <span className="stat-value delta">{formatDelta(repo.stars_delta_7d)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">30d</span>
          <span className="stat-value delta">{formatDelta(repo.stars_delta_30d)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.repo.velocity}</span>
          <span className="stat-value">{formatVelocity(repo.velocity)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.repo.trend}</span>
          <span className="stat-value">
            <TrendArrow trend={repo.trend} />
          </span>
        </div>
      </div>

      {/* Expandable Chart */}
      {showChart && (
        <div className="repo-chart-container">
          <StarsChart repoId={repo.id} />
        </div>
      )}

      {/* Similar Repos Panel */}
      {showSimilar && <SimilarRepos repoId={repo.id} onClose={() => setShowSimilar(false)} />}

      {/* Health Score Panel */}
      {healthDetails && (
        <HealthScorePanel
          details={healthDetails}
          onClose={() => setHealthDetails(null)}
          onRecalculate={setHealthDetails}
        />
      )}
    </div>
  );
}
