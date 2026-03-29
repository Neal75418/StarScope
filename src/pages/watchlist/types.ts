/**
 * Watchlist 子元件共用型別。
 */

import type { RepoWithSignals } from "../../api/client";
import type { useWindowedBatchRepoData } from "../../hooks/useWindowedBatchRepoData";

export interface RepoViewProps {
  repos: RepoWithSignals[];
  loadingRepoId: number | null;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
  batchData: ReturnType<typeof useWindowedBatchRepoData>["dataMap"];
  onVisibleRangeChange: (range: { start: number; stop: number }) => void;
  isSelectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelection?: (repoId: number) => void;
}
