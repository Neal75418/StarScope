/**
 * Repo 卡片內容區（徽章、描述）。
 */

import { memo } from "react";
import { ContextBadge } from "../../api/client";
import { ContextBadges } from "../ContextBadges";
import { useI18n } from "../../i18n";

interface RepoCardContentProps {
  repoId: number;
  description?: string | null;
  badges: ContextBadge[];
  badgesLoading: boolean;
  onRefreshContext?: () => void;
  isRefreshingContext?: boolean;
}

export const RepoCardContent = memo(function RepoCardContent({
  repoId,
  description,
  badges,
  badgesLoading,
  onRefreshContext,
  isRefreshingContext,
}: RepoCardContentProps) {
  const { t } = useI18n();

  return (
    <>
      {badgesLoading ? (
        <div className="badges-loading">{t.repo.loadingBadges}</div>
      ) : (
        <ContextBadges
          badges={badges}
          repoId={repoId}
          onRefresh={onRefreshContext}
          isRefreshing={isRefreshingContext}
        />
      )}

      {description && <p className="repo-description">{description}</p>}
    </>
  );
});
