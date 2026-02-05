/**
 * Repo card content section (badges, description).
 * Simplified version without tags.
 */

import { ContextBadge } from "../../api/client";
import { ContextBadges } from "../ContextBadges";
import { useI18n } from "../../i18n";

interface RepoCardContentProps {
  description?: string | null;
  badges: ContextBadge[];
  badgesLoading: boolean;
  onRefreshContext?: () => void;
  isRefreshingContext?: boolean;
}

export function RepoCardContent({
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
          onRefresh={onRefreshContext}
          isRefreshing={isRefreshingContext}
        />
      )}

      {description && <p className="repo-description">{description}</p>}
    </>
  );
}
