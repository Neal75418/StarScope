/**
 * GitHub connection component for OAuth Device Flow authentication.
 * Shows connection status and allows users to connect/disconnect GitHub account.
 */

import { useI18n } from "../i18n";
import { useGitHubConnection } from "../hooks/useGitHubConnection";
import {
  ConnectionLoading,
  ConnectionDisconnected,
  ConnectionConnecting,
  ConnectionAwaitingAuth,
  ConnectionConnected,
  ConnectionError,
  ErrorBanner,
} from "./github-connection";

export function GitHubConnection() {
  const { t } = useI18n();
  const {
    state,
    status,
    deviceCode,
    error,
    pollStatus,
    copied,
    fetchStatus,
    startDeviceFlow,
    cancelAuth,
    handleDisconnect,
    copyUserCode,
    openGitHubManually,
    clearError,
  } = useGitHubConnection();

  return (
    <div className="github-connection">
      <div className="section-header">
        <h3>{t.githubConnection.title}</h3>
      </div>

      {error && <ErrorBanner error={error} onDismiss={clearError} />}

      {state === "loading" && <ConnectionLoading />}

      {state === "disconnected" && <ConnectionDisconnected onConnect={startDeviceFlow} />}

      {state === "connecting" && <ConnectionConnecting />}

      {state === "awaiting_auth" && deviceCode && (
        <ConnectionAwaitingAuth
          deviceCode={deviceCode}
          pollStatus={pollStatus}
          copied={copied}
          onCopy={copyUserCode}
          onOpenManually={openGitHubManually}
          onCancel={cancelAuth}
        />
      )}

      {state === "connected" && status && (
        <ConnectionConnected
          status={status}
          onDisconnect={handleDisconnect}
          onRefresh={fetchStatus}
        />
      )}

      {state === "error" && <ConnectionError onRetry={fetchStatus} />}
    </div>
  );
}
