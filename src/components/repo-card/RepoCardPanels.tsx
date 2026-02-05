/**
 * Repo card expandable panels (chart, similar repos).
 * Simplified version without health score panel.
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
