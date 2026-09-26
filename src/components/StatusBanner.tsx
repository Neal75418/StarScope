/**
 * 全域狀態橫幅，顯示離線、sidecar 不可用等降級狀態。
 */

import { memo } from "react";
import { useAppStatus, DegradationLevel } from "../contexts/AppStatusContext";
import { useI18n } from "../i18n";

const ICONS: Record<DegradationLevel, string> = {
  online: "",
  offline: "⚡",
  "sidecar-starting": "🔄",
  "sidecar-down": "🔌",
  "rate-limited": "⏳",
};

/** 全域降級狀態橫幅。 */
export const StatusBanner = memo(function StatusBanner() {
  const { level, showBanner, bannerMessage } = useAppStatus();
  const { t } = useI18n();

  if (!showBanner || !bannerMessage) return null;

  const message = t.status[bannerMessage];

  return (
    <div
      // 從 status 換成 alert 時換一個新節點：同一個節點同時改 role 與文字，有些螢幕閱讀器會漏念
      key={level === "sidecar-starting" ? "status" : "alert"}
      className={`status-banner status-banner--${level}`}
      // 「啟動中」每次開 app 都會出現、也不是錯誤：用 status／polite，不打斷螢幕閱讀器
      role={level === "sidecar-starting" ? "status" : "alert"}
      aria-live={level === "sidecar-starting" ? "polite" : "assertive"}
      data-testid="status-banner"
    >
      <span className="status-banner-icon">{ICONS[level]}</span>
      <span className="status-banner-message">{message}</span>
    </div>
  );
});
