/**
 * 程式語言徽章，顯示主要語言。
 */

import { useLanguagesSummary } from "../hooks/useLanguagesSummary";
import { useI18n } from "../i18n";
import { getLanguageColors } from "../constants/languageColors";

interface LanguagesBadgeProps {
  repoId: number;
}

function LoadingBadge() {
  return <span className="language-badge language-badge-loading">...</span>;
}

function ErrorBadge({ error }: { error: string }) {
  return (
    <span className="language-badge language-badge-error" title={error}>
      !
    </span>
  );
}

function EmptyBadge({ fetching, onClick }: { fetching: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="language-badge language-badge-empty"
      onClick={onClick}
      disabled={fetching}
      title={t.languages?.clickToFetch ?? "Click to fetch languages"}
    >
      {fetching ? "..." : "?"}
    </button>
  );
}

function LanguageBadge({ language, languageCount }: { language: string; languageCount: number }) {
  const colors = getLanguageColors(language);
  const title = languageCount > 1 ? `${language} (+${languageCount - 1} more)` : language;

  return (
    <span
      className="language-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={title}
    >
      {language}
    </span>
  );
}

export function LanguagesBadge({ repoId }: LanguagesBadgeProps) {
  const { summary, loading, fetching, error, fetchData } = useLanguagesSummary(repoId);

  if (loading) {
    return <LoadingBadge />;
  }

  if (error) {
    return <ErrorBadge error={error} />;
  }

  if (!summary || !summary.primary_language) {
    return <EmptyBadge fetching={fetching} onClick={() => void fetchData()} />;
  }

  return (
    <LanguageBadge language={summary.primary_language} languageCount={summary.language_count} />
  );
}
