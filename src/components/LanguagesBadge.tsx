/**
 * 程式語言徽章，顯示主要語言。
 */

import { useLanguagesSummary } from "../hooks/useLanguagesSummary";
import { useI18n } from "../i18n";
import { getLanguageColors } from "../constants/languageColors";
import { StatusBadge } from "./StatusBadge";

interface LanguagesBadgeProps {
  repoId: number;
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
  const { t } = useI18n();
  const { summary, loading, fetching, error, fetchData } = useLanguagesSummary(repoId);

  if (loading) {
    return <StatusBadge variant="loading" classPrefix="language-badge" />;
  }

  if (error) {
    return <StatusBadge variant="error" classPrefix="language-badge" error={error} />;
  }

  if (!summary || !summary.primary_language) {
    return (
      <StatusBadge
        variant="empty"
        classPrefix="language-badge"
        fetching={fetching}
        onClick={() => void fetchData()}
        emptyTooltip={t.languages?.clickToFetch ?? "Click to fetch languages"}
      />
    );
  }

  return (
    <LanguageBadge language={summary.primary_language} languageCount={summary.language_count} />
  );
}
