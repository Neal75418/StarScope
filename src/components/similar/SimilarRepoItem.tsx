/**
 * 單一相似 repo 項目元件，含相似度維度分解條。
 */

import React from "react";
import { safeOpenUrl } from "../../utils/url";
import { SimilarRepo } from "../../api/client";
import { useI18n } from "../../i18n";

interface SimilarRepoItemProps {
  repo: SimilarRepo;
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function truncateDescription(description: string, maxLength: number = 100): string {
  return description.length > maxLength ? description.substring(0, maxLength) + "..." : description;
}

function TopicsList({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;

  const visibleTopics = topics.slice(0, 3);
  const remainingCount = topics.length - 3;

  return (
    <div className="similar-repo-topics">
      {visibleTopics.map((topic) => (
        <span key={topic} className="similar-topic-badge">
          {topic}
        </span>
      ))}
      {remainingCount > 0 && <span className="similar-topic-more">+{remainingCount}</span>}
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="similarity-bar-row">
      <span className="similarity-bar-label">{label}</span>
      <div className="similarity-bar-track">
        <div className="similarity-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="similarity-bar-value">{pct}%</span>
    </div>
  );
}

function SimilarityBreakdown({ repo }: { repo: SimilarRepo }) {
  const { t } = useI18n();

  if (repo.topic_score == null && repo.language_score == null && repo.magnitude_score == null) {
    return null;
  }

  return (
    <div className="similarity-breakdown">
      {repo.topic_score != null && (
        <ScoreBar label={t.similarRepos.breakdown.topics} score={repo.topic_score} />
      )}
      {repo.language_score != null && (
        <ScoreBar label={t.similarRepos.breakdown.language} score={repo.language_score} />
      )}
      {repo.magnitude_score != null && (
        <ScoreBar label={t.similarRepos.breakdown.starScale} score={repo.magnitude_score} />
      )}
    </div>
  );
}

export function SimilarRepoItem({ repo }: SimilarRepoItemProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await safeOpenUrl(repo.url);
  };

  return (
    <div className="similar-repo-item">
      <div className="similar-repo-info">
        <a href={repo.url} onClick={handleLinkClick} className="similar-repo-name">
          {repo.full_name}
        </a>
        <span className="similar-repo-score" title={t.similarRepos.similarityScore}>
          {formatScore(repo.similarity_score)}
        </span>
      </div>
      <div className="similar-repo-meta">
        {repo.language && <span className="similar-repo-language">{repo.language}</span>}
        {repo.same_language && (
          <span className="similar-repo-badge same-lang">{t.similarRepos.sameLanguage}</span>
        )}
      </div>
      <SimilarityBreakdown repo={repo} />
      <TopicsList topics={repo.shared_topics} />
      {repo.description && (
        <p className="similar-repo-desc">{truncateDescription(repo.description)}</p>
      )}
    </div>
  );
}
