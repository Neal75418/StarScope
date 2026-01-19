/**
 * Similar repositories component.
 * Shows repos that are similar to the current one based on topics and language.
 */

import { useState, useEffect } from "react";
import { SimilarRepo, getSimilarRepos } from "../api/client";
import { useI18n } from "../i18n";

interface SimilarReposProps {
  repoId: number;
  onClose?: () => void;
}

export function SimilarRepos({ repoId, onClose }: SimilarReposProps) {
  const { t } = useI18n();
  const [similar, setSimilar] = useState<SimilarRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    getSimilarRepos(repoId, 5)
      .then((response) => {
        if (isMounted) {
          setSimilar(response.similar);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load similar repos:", err);
          setError(t.similarRepos.loadError);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const formatScore = (score: number): string => {
    return `${Math.round(score * 100)}%`;
  };

  if (loading) {
    return (
      <div className="similar-repos">
        <div className="similar-repos-header">
          <h4>{t.similarRepos.title}</h4>
          {onClose && (
            <button className="btn btn-sm" onClick={onClose}>
              &times;
            </button>
          )}
        </div>
        <div className="similar-repos-loading">{t.similarRepos.loading}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="similar-repos">
        <div className="similar-repos-header">
          <h4>{t.similarRepos.title}</h4>
          {onClose && (
            <button className="btn btn-sm" onClick={onClose}>
              &times;
            </button>
          )}
        </div>
        <div className="similar-repos-error">{error}</div>
      </div>
    );
  }

  if (similar.length === 0) {
    return (
      <div className="similar-repos">
        <div className="similar-repos-header">
          <h4>{t.similarRepos.title}</h4>
          {onClose && (
            <button className="btn btn-sm" onClick={onClose}>
              &times;
            </button>
          )}
        </div>
        <div className="similar-repos-empty">{t.similarRepos.empty}</div>
      </div>
    );
  }

  return (
    <div className="similar-repos">
      <div className="similar-repos-header">
        <h4>{t.similarRepos.title}</h4>
        {onClose && (
          <button className="btn btn-sm" onClick={onClose}>
            &times;
          </button>
        )}
      </div>
      <div className="similar-repos-list">
        {similar.map((repo) => (
          <div key={repo.repo_id} className="similar-repo-item">
            <div className="similar-repo-info">
              <a
                href={repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="similar-repo-name"
              >
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
            {repo.shared_topics.length > 0 && (
              <div className="similar-repo-topics">
                {repo.shared_topics.slice(0, 3).map((topic) => (
                  <span key={topic} className="similar-topic-badge">
                    {topic}
                  </span>
                ))}
                {repo.shared_topics.length > 3 && (
                  <span className="similar-topic-more">+{repo.shared_topics.length - 3}</span>
                )}
              </div>
            )}
            {repo.description && (
              <p className="similar-repo-desc">
                {repo.description.length > 100
                  ? repo.description.substring(0, 100) + "..."
                  : repo.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SimilarReposButtonProps {
  repoId: number;
}

export function SimilarReposButton({ repoId }: SimilarReposButtonProps) {
  const { t } = useI18n();
  const [showPanel, setShowPanel] = useState(false);

  return (
    <>
      <button
        className={`btn btn-sm ${showPanel ? "active" : ""}`}
        onClick={() => setShowPanel(!showPanel)}
        title={t.similarRepos.showSimilar}
      >
        {t.similarRepos.similar}
      </button>
      {showPanel && (
        <div className="similar-repos-panel">
          <SimilarRepos repoId={repoId} onClose={() => setShowPanel(false)} />
        </div>
      )}
    </>
  );
}
