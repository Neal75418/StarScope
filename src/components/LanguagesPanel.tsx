/**
 * Languages panel showing programming language breakdown visualization.
 */

import { useState, useEffect, useCallback } from "react";
import { LanguagesResponse, getLanguages, fetchLanguages, ApiError } from "../api/client";
import { useI18n } from "../i18n";

interface LanguagesPanelProps {
  repoId: number;
  repoName: string;
  onClose: () => void;
}

/**
 * GitHub language colors (subset of common languages).
 */
const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Scala: "#c22d40",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Dart: "#00B4AB",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Lua: "#000080",
  R: "#198CE7",
  Perl: "#0298c3",
  "Objective-C": "#438eff",
  Clojure: "#db5855",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Jupyter: "#DA5B0B",
};

/**
 * Get color for a language, with fallback.
 */
function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language] || "#8b949e";
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LanguagesEmptyState({
  fetching,
  onFetch,
  t,
}: {
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="no-data">
      <p>{t.languages.noData}</p>
      <button className="btn btn-primary" onClick={onFetch} disabled={fetching}>
        {fetching ? t.languages.fetching : t.languages.fetch}
      </button>
    </div>
  );
}

function LanguagesStats({
  data,
  t,
}: {
  data: LanguagesResponse;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="languages-stats">
      <div className="stat">
        <span className="stat-value">{data.primary_language || "N/A"}</span>
        <span className="stat-label">{t.languages.primary}</span>
      </div>
      <div className="stat">
        <span className="stat-value">{data.languages.length}</span>
        <span className="stat-label">{t.languages.languageCount.replace("{count}", "")}</span>
      </div>
      <div className="stat">
        <span className="stat-value">{formatBytes(data.total_bytes)}</span>
        <span className="stat-label">{t.languages.totalBytes}</span>
      </div>
    </div>
  );
}

function LanguageBar({ languages }: { languages: LanguagesResponse["languages"] }) {
  return (
    <div className="language-bar">
      {languages.map((lang) => (
        <div
          key={lang.language}
          className="language-bar-segment"
          style={{
            width: `${lang.percentage}%`,
            backgroundColor: getLanguageColor(lang.language),
          }}
          title={`${lang.language}: ${lang.percentage}%`}
        />
      ))}
    </div>
  );
}

function LanguageList({ languages }: { languages: LanguagesResponse["languages"] }) {
  return (
    <div className="language-list">
      {languages.map((lang) => (
        <div key={lang.language} className="language-item">
          <div className="language-info">
            <span
              className="language-dot"
              style={{ backgroundColor: getLanguageColor(lang.language) }}
            />
            <span className="language-name">{lang.language}</span>
          </div>
          <div className="language-stats">
            <span className="language-percentage">{lang.percentage.toFixed(1)}%</span>
            <span className="language-bytes">{formatBytes(lang.bytes)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function LanguagesActions({
  fetching,
  onFetch,
  t,
}: {
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="languages-actions">
      <button className="btn btn-secondary" onClick={onFetch} disabled={fetching}>
        {fetching ? t.languages.fetching : t.languages.refresh}
      </button>
    </div>
  );
}

function LanguagesDetails({
  data,
  fetching,
  onFetch,
  t,
}: {
  data: LanguagesResponse;
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <>
      <LanguagesStats data={data} t={t} />
      <LanguageBar languages={data.languages} />
      <LanguageList languages={data.languages} />
      {data.last_updated && (
        <div className="last-updated">
          {t.languages.lastUpdated.replace(
            "{date}",
            new Date(data.last_updated).toLocaleDateString()
          )}
        </div>
      )}
      <LanguagesActions fetching={fetching} onFetch={onFetch} t={t} />
    </>
  );
}

function LanguagesContent({
  loading,
  error,
  data,
  fetching,
  onFetch,
  t,
}: {
  loading: boolean;
  error: string | null;
  data: LanguagesResponse | null;
  fetching: boolean;
  onFetch: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (loading) {
    return <div className="loading">{t.languages.fetching}</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data || data.languages.length === 0) {
    return <LanguagesEmptyState fetching={fetching} onFetch={onFetch} t={t} />;
  }

  return <LanguagesDetails data={data} fetching={fetching} onFetch={onFetch} t={t} />;
}

export function LanguagesPanel({ repoId, repoName, onClose }: LanguagesPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<LanguagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getLanguages(repoId);
      setData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setData(null);
      } else {
        console.error("Failed to load languages:", err);
        setError(t.languages.fetchFailed);
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, t]);

  const handleFetch = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);
      const result = await fetchLanguages(repoId);
      setData(result);
    } catch {
      setError(t.languages.fetchFailed);
    } finally {
      setFetching(false);
    }
  }, [repoId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="languages-overlay" onClick={onClose}>
      <div className="languages-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="languages-header">
          <div>
            <h3>{t.languages.title}</h3>
            <span className="repo-name">{repoName}</span>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="languages-content">
          <LanguagesContent
            loading={loading}
            error={error}
            data={data}
            fetching={fetching}
            onFetch={handleFetch}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
