/**
 * 連線錯誤元件
 */

import { useI18n } from "../../i18n";
import { useAppStatus } from "../../contexts/AppStatusContext";

interface ConnectionErrorProps {
  onRetry: () => void;
}

export function ConnectionError({ onRetry }: ConnectionErrorProps) {
  const { t } = useI18n();
  const { level } = useAppStatus();

  const message = level === "offline" ? t.status.offline : t.watchlist.connection.message;

  return (
    <div className="page">
      <div className="error-container">
        <h2>{t.watchlist.connection.title}</h2>
        <p>{message}</p>
        <p className="hint">{t.watchlist.connection.autoRetry}</p>
        <button onClick={onRetry} className="btn btn-primary">
          {t.watchlist.connection.retry}
        </button>
      </div>
    </div>
  );
}
