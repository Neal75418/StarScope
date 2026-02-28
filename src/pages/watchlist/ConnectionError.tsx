/**
 * 連線錯誤元件
 */

import { useI18n } from "../../i18n";

interface ConnectionErrorProps {
  onRetry: () => void;
}

export function ConnectionError({ onRetry }: ConnectionErrorProps) {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="error-container">
        <h2>{t.watchlist.connection.title}</h2>
        <p>{t.watchlist.connection.message}</p>
        <p className="hint">{t.watchlist.connection.autoRetry}</p>
        <button onClick={onRetry} className="btn btn-primary">
          {t.watchlist.connection.retry}
        </button>
      </div>
    </div>
  );
}
