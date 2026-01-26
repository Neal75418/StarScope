/**
 * Error banner for GitHub connection errors.
 */

import { useI18n } from "../../i18n";

interface ErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  const { t } = useI18n();

  return (
    <div className="github-error">
      {error}
      <button onClick={onDismiss} className="dismiss-btn">
        {t.githubConnection.dismiss}
      </button>
    </div>
  );
}
