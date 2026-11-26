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
      <div className="error-container" role="alert">
        <h2>{t.watchlist.connection.title}</h2>
        {/* 只在資料引擎沒連上時出現，那時連線狀態只會是 sidecar-*（排在斷網前面），不依連線狀態換說法 */}
        <p>{t.watchlist.connection.message}</p>
        <p className="hint">{t.watchlist.connection.autoRetry}</p>
        <button onClick={onRetry} className="btn btn-primary">
          {t.watchlist.connection.retry}
        </button>
      </div>
    </div>
  );
}
