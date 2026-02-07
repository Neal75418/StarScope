/**
 * 程式語言面板，視覺化呈現語言佔比。
 */

import { useState, useEffect, useCallback } from "react";
import { LanguagesResponse, getLanguages, fetchLanguages, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { getLanguageColor } from "../constants/languageColors";
import { logger } from "../utils/logger";

interface LanguagesPanelProps {
  repoId: number;
  repoName: string;
  onClose: () => void;
}

/**
 * 將位元組格式化為易讀字串。
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
        logger.error("載入程式語言資料失敗:", err);
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
        {/* 標題列 */}
        <div className="languages-header">
          <div>
            <h3>{t.languages.title}</h3>
            <span className="repo-name">{repoName}</span>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* 內容區 */}
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
