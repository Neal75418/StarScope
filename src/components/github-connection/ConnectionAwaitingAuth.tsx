/**
 * GitHub 連線等待授權狀態。
 */

import { DeviceCodeResponse } from "../../api/client";
import { useI18n } from "../../i18n";

interface ConnectionAwaitingAuthProps {
  deviceCode: DeviceCodeResponse;
  pollStatus: string;
  copied: boolean;
  onCopy: () => void;
  onOpenManually: () => void;
  onCancel: () => void;
}

export function ConnectionAwaitingAuth({
  deviceCode,
  pollStatus,
  copied,
  onCopy,
  onOpenManually,
  onCancel,
}: ConnectionAwaitingAuthProps) {
  const { t } = useI18n();

  return (
    <div className="github-status awaiting">
      <div className="device-code-section">
        <div className="device-code-label">{t.githubConnection.enterCode}</div>
        <div className="device-code-box">
          <code className="device-code">{deviceCode.user_code}</code>
          <button onClick={onCopy} className="btn btn-small" title={t.githubConnection.copy}>
            {copied ? t.githubConnection.copied : t.githubConnection.copy}
          </button>
        </div>
        <div className="device-code-hint">
          <span className="spinner-small" />
          {pollStatus || t.githubConnection.waitingAuth}
        </div>
        <div className="device-code-warning">{t.githubConnection.stayOnPage}</div>
        <div className="device-code-actions">
          <button onClick={onOpenManually} className="btn btn-link">
            {t.githubConnection.openManually}
          </button>
          <button onClick={onCancel} className="btn">
            {t.githubConnection.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
