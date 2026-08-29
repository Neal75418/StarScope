/**
 * 批次匯入 repo 的區塊元件。
 */

import { useState, useRef, memo } from "react";
import type { ChangeEvent } from "react";
import { useI18n } from "../../i18n";
import type { ImportResult as ImportResultData } from "../../utils/importHelpers";
import { useImport, ParsedRepo } from "../../hooks/useImport";

function StatusIcon({ status }: { status: ParsedRepo["status"] }) {
  const { t } = useI18n();
  const labels: Record<string, string> = {
    pending: t.settings.import.statusPending,
    importing: t.settings.import.statusImporting,
    success: t.settings.import.statusSuccess,
    error: t.settings.import.statusError,
    skipped: t.settings.import.statusSkipped,
  };
  const icons: Record<string, string> = {
    pending: "○",
    importing: "◐",
    success: "✓",
    error: "✗",
    skipped: "-",
  };
  return (
    <span className={`import-status ${status}`} aria-label={labels[status]}>
      {icons[status]}
    </span>
  );
}

const RepoItem = memo(function RepoItem({ repo }: { repo: ParsedRepo }) {
  const isLong = repo.error && repo.error.length > 100;

  return (
    <div className={`import-item ${repo.status}`}>
      <StatusIcon status={repo.status} />
      <span className="import-item-name">{repo.fullName}</span>
      {repo.error &&
        (isLong ? (
          <details className="import-item-error-details">
            <summary className="import-item-error">{repo.error.substring(0, 100)}…</summary>
            <p className="import-item-error-full">{repo.error}</p>
          </details>
        ) : (
          <span className="import-item-error">{repo.error}</span>
        ))}
    </div>
  );
});

function ImportPreview({ repos }: { repos: ParsedRepo[] }) {
  const { t } = useI18n();

  if (repos.length === 0) return null;

  const isLargeImport = repos.length > 100;

  return (
    <div className="import-preview" role="region" aria-label={t.settings.import.preview}>
      <div className="import-preview-header">
        <span>{t.settings.import.preview}</span>
        <span className="import-count">
          {repos.length} {t.settings.import.repos}
          {isLargeImport && " ⚠️"}
        </span>
      </div>
      <div className="import-preview-list">
        {repos.map((repo) => (
          <RepoItem key={repo.fullName} repo={repo} />
        ))}
      </div>
    </div>
  );
}

function ImportResult({ result }: { result: ImportResultData }) {
  const { t } = useI18n();

  return (
    <div className="import-result" role="status" aria-live="polite">
      <div className="import-result-title">{t.settings.import.complete}</div>
      <div className="import-result-stats">
        <div className="import-stat success">
          <span className="import-stat-value">{result.success}</span>
          <span className="import-stat-label">{t.settings.import.imported}</span>
        </div>
        <div className="import-stat skipped">
          <span className="import-stat-value">{result.skipped}</span>
          <span className="import-stat-label">{t.settings.import.skipped}</span>
        </div>
        <div className="import-stat failed">
          <span className="import-stat-value">{result.failed}</span>
          <span className="import-stat-label">{t.settings.import.failed}</span>
        </div>
      </div>
      {result.dedupCheckFailed && (
        <p className="import-result-warning" role="alert">
          {t.settings.import.dedupWarning}
        </p>
      )}
    </div>
  );
}

export function ImportSection() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [textInput, setTextInput] = useState("");

  const { parsedRepos, isImporting, result, parseError, parseFile, parseText, startImport, reset } =
    useImport();

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void parseFile(file);
      setTextInput("");
    }
  };

  const handleTextParse = () => {
    parseText(textInput);
  };

  const handleReset = () => {
    reset();
    setTextInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <section className="settings-section" data-testid="import-section">
      <div className="settings-section-header">
        <div>
          <h2>{t.settings.import.title}</h2>
          <p className="settings-description">{t.settings.import.description}</p>
        </div>
      </div>

      {/* 分隔線 */}
      <div className="import-divider" aria-hidden="true">
        <span>{t.settings.import.or}</span>
      </div>

      <div className="import-form">
        {/* 檔案上傳 */}
        <div className="import-method">
          <label htmlFor="import-file-input" className="import-label">
            {t.settings.import.uploadFile}
          </label>
          <div className="import-file-input">
            <input
              id="import-file-input"
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.txt"
              onChange={handleFileChange}
              disabled={isImporting}
              aria-describedby="import-file-hint"
            />
          </div>
          <p id="import-file-hint" className="import-hint">
            {t.settings.import.fileHint}
          </p>
        </div>

        {/* 或分隔線 */}
        <div className="import-divider" aria-hidden="true">
          <span>{t.settings.import.or}</span>
        </div>

        {/* 文字輸入 */}
        <div className="import-method">
          <label htmlFor="import-text-input" className="import-label">
            {t.settings.import.pasteText}
          </label>
          <textarea
            id="import-text-input"
            className="import-textarea"
            placeholder={t.settings.import.textPlaceholder}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={isImporting}
            rows={5}
            aria-label={t.settings.import.pasteText}
          />
          <button
            className="btn btn-secondary"
            onClick={handleTextParse}
            disabled={isImporting || !textInput.trim()}
            aria-label={t.settings.import.parse}
          >
            {t.settings.import.parse}
          </button>
        </div>

        {/* 錯誤訊息 */}
        {parseError && (
          <div className="import-error" role="alert">
            {parseError}
          </div>
        )}

        {/* 預覽 */}
        <ImportPreview repos={parsedRepos} />

        {/* 結果 */}
        {result && <ImportResult result={result} />}

        {/* 操作按鈕：未完成或有失敗時可重試 */}
        {parsedRepos.length > 0 && (!result || result.failed > 0) && (
          <div className="import-actions">
            <button
              className="btn btn-primary"
              onClick={() => void startImport()}
              disabled={isImporting}
              aria-busy={isImporting}
            >
              {isImporting ? t.settings.import.importing : t.settings.import.startImport}
            </button>
            <button className="btn" onClick={handleReset} disabled={isImporting}>
              {t.common.cancel}
            </button>
          </div>
        )}

        {/* 全部成功後重設 */}
        {result && result.failed === 0 && (
          <div className="import-actions">
            <button className="btn btn-primary" onClick={handleReset}>
              {t.settings.import.importMore}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
