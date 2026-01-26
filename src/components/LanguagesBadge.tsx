/**
 * Languages badge showing primary language.
 */

import { useLanguagesSummary } from "../hooks/useLanguagesSummary";
import { useI18n } from "../i18n";

interface LanguagesBadgeProps {
  repoId: number;
}

// GitHub language colors (subset of common languages)
const LANGUAGE_COLORS: Record<string, { bg: string; text: string }> = {
  TypeScript: { bg: "#3178c6", text: "#ffffff" },
  JavaScript: { bg: "#f1e05a", text: "#000000" },
  Python: { bg: "#3572A5", text: "#ffffff" },
  Rust: { bg: "#dea584", text: "#000000" },
  Go: { bg: "#00ADD8", text: "#ffffff" },
  Java: { bg: "#b07219", text: "#ffffff" },
  "C++": { bg: "#f34b7d", text: "#ffffff" },
  C: { bg: "#555555", text: "#ffffff" },
  "C#": { bg: "#178600", text: "#ffffff" },
  Ruby: { bg: "#701516", text: "#ffffff" },
  PHP: { bg: "#4F5D95", text: "#ffffff" },
  Swift: { bg: "#F05138", text: "#ffffff" },
  Kotlin: { bg: "#A97BFF", text: "#ffffff" },
  Shell: { bg: "#89e051", text: "#000000" },
  HTML: { bg: "#e34c26", text: "#ffffff" },
  CSS: { bg: "#563d7c", text: "#ffffff" },
  Vue: { bg: "#41b883", text: "#ffffff" },
  Dart: { bg: "#00B4AB", text: "#ffffff" },
  Scala: { bg: "#c22d40", text: "#ffffff" },
  Elixir: { bg: "#6e4a7e", text: "#ffffff" },
  Haskell: { bg: "#5e5086", text: "#ffffff" },
  Lua: { bg: "#000080", text: "#ffffff" },
  R: { bg: "#198CE7", text: "#ffffff" },
  Julia: { bg: "#a270ba", text: "#ffffff" },
  Zig: { bg: "#ec915c", text: "#000000" },
};

const DEFAULT_COLORS = { bg: "#6b7280", text: "#f3f4f6" };

function getLanguageColors(language: string): { bg: string; text: string } {
  return LANGUAGE_COLORS[language] || DEFAULT_COLORS;
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
