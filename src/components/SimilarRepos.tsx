/**
 * 相似 repo 元件，依 topic 與語言顯示相似的 repo。
 */

import { useState } from "react";
import { useSimilarRepos } from "../hooks/useSimilarRepos";
import { useI18n } from "../i18n";
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
