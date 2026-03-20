/**
 * 相似 repo 元件，依 topic 與語言顯示相似的 repo。
 */

import { useSimilarRepos } from "../hooks/useSimilarRepos";
import { SimilarReposHeader, SimilarReposList } from "./similar";

interface SimilarReposProps {
  repoId: number;
  onClose?: () => void;
}

export function SimilarRepos({ repoId, onClose }: SimilarReposProps) {
  const { similar, loading, error, recalculate, isRecalculating } = useSimilarRepos(repoId);

  return (
    <div className="similar-repos">
      <SimilarReposHeader
        onClose={onClose}
        onRecalculate={recalculate}
        isRecalculating={isRecalculating}
      />
      <SimilarReposList similar={similar} loading={loading} error={error} />
    </div>
  );
}
