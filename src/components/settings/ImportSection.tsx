/**
 * 批次匯入 repo 的區塊元件。
 */

import { useState, useRef, ChangeEvent, memo } from "react";
import { useI18n } from "../../i18n";
import { useImport, ParsedRepo } from "../../hooks/useImport";

function StatusIcon({ status }: { status: ParsedRepo["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="import-status pending" aria-label="pending">
          ○
        </span>
      );
    case "importing":
      return (
        <span className="import-status importing" aria-label="importing">
          ◐
        </span>
      );
    case "success":
      return (
        <span className="import-status success" aria-label="success">
          ✓
        </span>
      );
    case "error":
      return (
        <span className="import-status error" aria-label="error">
          ✗
        </span>
      );
    case "skipped":
      return (
        <span className="import-status skipped" aria-label="skipped">
          -
        </span>
      );
  }
}

const RepoItem = memo(({ repo }: { repo: ParsedRepo }) => {
  const errorDisplay = repo.error
    ? repo.error.length > 100
      ? `${repo.error.substring(0, 100)}...`
      : repo.error
    : null;

  return (
    <div className={`import-item ${repo.status}`}>
      <StatusIcon status={repo.status} />
      <span className="import-item-name">{repo.fullName}</span>
      {errorDisplay && (
        <span className="import-item-error" title={repo.error}>
          {errorDisplay}
        </span>
      )}
    </div>
  );
});
RepoItem.displayName = "RepoItem";

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

function ImportResult({
  result,
}: {
  result: { total: number; success: number; skipped: number; failed: number };
}) {
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

        {/* 操作按鈕 */}
        {parsedRepos.length > 0 && !result && (
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

        {/* 完成後重設 */}
        {result && (
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
