/**
 * 錯誤橫幅元件
 */

import { useI18n } from "../../i18n";

interface ErrorBannerProps {
  error: string;
  onClear: () => void;
}

export function ErrorBanner({ error, onClear }: ErrorBannerProps) {
  const { t } = useI18n();
  return (
    <div className="error-banner" role="alert">
      {error}
      <button onClick={onClear} aria-label={t.common.close}>
        &times;
      </button>
    </div>
  );
}
