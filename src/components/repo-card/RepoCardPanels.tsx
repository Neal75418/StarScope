/**
 * Repo 卡片可展開面板（圖表、相似 repo）。
 */

import { StarsChart } from "../StarsChart";
import { SimilarRepos } from "../SimilarRepos";

interface RepoCardPanelsProps {
  repoId: number;
  showChart: boolean;
  showSimilar: boolean;
  onCloseSimilar: () => void;
}

export function RepoCardPanels({
  repoId,
  showChart,
  showSimilar,
  onCloseSimilar,
}: RepoCardPanelsProps) {
  return (
    <>
      {showChart && (
        <div className="repo-chart-container">
          <StarsChart repoId={repoId} />
        </div>
      )}

      {showSimilar && <SimilarRepos repoId={repoId} onClose={onCloseSimilar} />}
    </>
  );
}
