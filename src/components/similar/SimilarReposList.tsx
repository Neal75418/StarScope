/**
 * 相似 repo 列表元件。
 */

import { SimilarRepo } from "../../api/client";
import { useI18n } from "../../i18n";
import { SimilarRepoItem } from "./SimilarRepoItem";

interface SimilarReposListProps {
  similar: SimilarRepo[];
  loading: boolean;
  error: string | null;
}

export function SimilarReposList({ similar, loading, error }: SimilarReposListProps) {
  const { t } = useI18n();

  if (loading) {
    return <div className="similar-repos-loading">{t.similarRepos.loading}</div>;
  }

  if (error) {
    return <div className="similar-repos-error">{error}</div>;
  }

  if (similar.length === 0) {
    return <div className="similar-repos-empty">{t.similarRepos.empty}</div>;
  }

  return (
    <div className="similar-repos-list">
      {similar.map((repo) => (
        <SimilarRepoItem key={repo.repo_id} repo={repo} />
      ))}
    </div>
  );
}
