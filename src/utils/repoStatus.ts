/**
 * Repo 狀態判斷工具函式。
 */

import type { RepoWithSignals, EarlySignal } from "../api/client";

const HOT_VELOCITY_THRESHOLD = 50;
const STALE_DAYS_THRESHOLD = 30;

/** 判斷 Repo 是否為熱門（velocity > 50）。 */
export function isHotRepo(repo: RepoWithSignals): boolean {
  return repo.velocity != null && repo.velocity > HOT_VELOCITY_THRESHOLD;
}

/** 判斷 Repo 是否過期（超過 30 天未更新）。 */
export function isStaleRepo(repo: RepoWithSignals): boolean {
  if (!repo.last_fetched) return true;
  const lastFetched = new Date(repo.last_fetched);
  const daysSince = (Date.now() - lastFetched.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > STALE_DAYS_THRESHOLD;
}

/** 判斷是否有未確認的早期訊號。 */
export function hasActiveSignals(signals: EarlySignal[]): boolean {
  return signals.some((s) => !s.acknowledged);
}
