/**
 * 全域狀態橫幅，顯示離線、sidecar 不可用等降級狀態。
 */

import { memo } from "react";
import { useAppStatus, DegradationLevel } from "../contexts/AppStatusContext";
import { useI18n } from "../i18n";

const ICONS: Record<DegradationLevel, string> = {
  online: "",
  offline: "⚡",
  "sidecar-down": "🔌",
  "rate-limited": "⏳",
  "partial-failure": "⚠️",
};

/** 全域降級狀態橫幅。 */
export const StatusBanner = memo(function StatusBanner() {
  const { level, showBanner, bannerMessage } = useAppStatus();
  const { t } = useI18n();

  if (!showBanner || !bannerMessage) return null;

  const message = t.status[bannerMessage];

  return (
    <div
      className={`status-banner status-banner--${level}`}
      role="alert"
      aria-live="assertive"
      data-testid="status-banner"
    >
      <span className="status-banner-icon">{ICONS[level]}</span>
      <span className="status-banner-message">{message}</span>
    </div>
  );
});
