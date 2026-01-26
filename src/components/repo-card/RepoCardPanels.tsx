/**
 * Repo card expandable panels (chart, similar repos, health details).
 */

import { HealthScoreResponse } from "../../api/client";
import { StarsChart } from "../StarsChart";
import { SimilarRepos } from "../SimilarRepos";
import { HealthScorePanel } from "../HealthScorePanel";

interface RepoCardPanelsProps {
  repoId: number;
  showChart: boolean;
  showSimilar: boolean;
  healthDetails: HealthScoreResponse | null;
  onCloseSimilar: () => void;
  onCloseHealth: () => void;
  onRecalculateHealth: (details: HealthScoreResponse | null) => void;
}

export function RepoCardPanels({
  repoId,
  showChart,
  showSimilar,
  healthDetails,
  onCloseSimilar,
  onCloseHealth,
  onRecalculateHealth,
}: RepoCardPanelsProps) {
  return (
    <>
      {showChart && (
        <div className="repo-chart-container">
          <StarsChart repoId={repoId} />
        </div>
      )}

      {showSimilar && <SimilarRepos repoId={repoId} onClose={onCloseSimilar} />}

      {healthDetails && (
        <HealthScorePanel
          details={healthDetails}
          onClose={onCloseHealth}
          onRecalculate={onRecalculateHealth}
        />
      )}
    </>
  );
}
