/**
 * Repo card content section (badges, tags, description).
 */

import { ContextBadge, RepoTag } from "../../api/client";
import { ContextBadges } from "../ContextBadges";
import { TagList } from "../TagBadge";
import { useI18n } from "../../i18n";

interface RepoCardContentProps {
  description?: string | null;
  badges: ContextBadge[];
  badgesLoading: boolean;
  tags: RepoTag[];
  tagsLoading: boolean;
  onRefreshContext?: () => void;
  isRefreshingContext?: boolean;
}

export function RepoCardContent({
  description,
  badges,
  badgesLoading,
  tags,
  tagsLoading,
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

      {tagsLoading ? (
        <div className="tags-loading">{t.repo.loadingTags}</div>
      ) : tags.length > 0 ? (
        <TagList tags={tags} maxVisible={6} />
      ) : null}

      {description && <p className="repo-description">{description}</p>}
    </>
  );
}
