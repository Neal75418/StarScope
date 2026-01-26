/**
 * Individual similar repo item component.
 */

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

export function SimilarRepoItem({ repo }: SimilarRepoItemProps) {
  const { t } = useI18n();

  return (
    <div className="similar-repo-item">
      <div className="similar-repo-info">
        <a href={repo.url} target="_blank" rel="noopener noreferrer" className="similar-repo-name">
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
      <TopicsList topics={repo.shared_topics} />
      {repo.description && (
        <p className="similar-repo-desc">{truncateDescription(repo.description)}</p>
      )}
    </div>
  );
}
