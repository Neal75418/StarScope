/**
 * Repo 卡片可展開面板（圖表）。
 */

import { memo } from "react";
import { StarsChart } from "../StarsChart";

interface RepoCardPanelsProps {
  repoId: number;
  showChart: boolean;
}

export const RepoCardPanels = memo(function RepoCardPanels({
  repoId,
  showChart,
}: RepoCardPanelsProps) {
  return (
    <>
      {showChart && (
        <div className="repo-chart-container">
          <StarsChart repoId={repoId} />
        </div>
      )}
    </>
  );
});
