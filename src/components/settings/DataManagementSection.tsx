/**
 * 資料管理設定區塊。
 * 提供清除快取與重置所有資料的操作。
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { clearCache, resetAllData } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";
import { STORAGE_KEYS } from "../../constants/storage";
import { DATA_RESET_EVENT } from "../../constants/events";

/** 資料衍生型 localStorage key — reset 時一併清除 */
const DATA_DERIVED_KEYS: string[] = [
  STORAGE_KEYS.COMPARE_REPOS,
  STORAGE_KEYS.NOTIFICATIONS_READ,
  STORAGE_KEYS.DISMISSED_RECS,
  STORAGE_KEYS.SEARCH_HISTORY,
  STORAGE_KEYS.RECENTLY_VIEWED,
  STORAGE_KEYS.SAVED_FILTERS,
  STORAGE_KEYS.WATCHLIST_SORT,
];

interface DataManagementSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function DataManagementSection({ onToast }: DataManagementSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const isOperating = isClearingCache || isResetting;

  const handleClearCache = async () => {
    if (isOperating) return;
    setIsClearingCache(true);
    try {
      await clearCache();
      // 使所有 React Query 快取失效，強制重新拉取
      await queryClient.invalidateQueries();
      onToast(t.settings.data.toast.cacheCleared, "success");
    } catch {
      onToast(t.settings.data.toast.cacheClearFailed, "error");
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleResetData = async () => {
    if (isOperating) return;
    setIsResetting(true);
    try {
      await resetAllData();
      // 清除所有快取
      queryClient.clear();
      // 清除資料衍生型 localStorage（保留使用者偏好如主題/語言）
      for (const key of DATA_DERIVED_KEYS) {
        localStorage.removeItem(key);
      }
      // 通知 app-wide 的 in-memory 狀態（notification ref、watchlist filters）同步清除
      window.dispatchEvent(new Event(DATA_RESET_EVENT));
      setShowResetConfirm(false);
      onToast(t.settings.data.toast.dataReset, "success");
    } catch {
      onToast(t.settings.data.toast.dataResetFailed, "error");
    } finally {
      setIsResetting(false);
    }
    // 失敗時保留 dialog 開啟，讓使用者可以重試
  };

  return (
    <>
      <section className="settings-section" data-testid="data-management-section">
        <h2>{t.settings.data.title}</h2>

        <div className="data-management-actions">
          {/* 清除快取 */}
          <div className="data-action-card">
            <div className="data-action-info">
              <div className="data-action-title">{t.settings.data.clearCache}</div>
              <div className="data-action-desc">{t.settings.data.clearCacheDesc}</div>
            </div>
            <button className="btn" onClick={() => void handleClearCache()} disabled={isOperating}>
              {isClearingCache ? `${t.settings.data.clearCache}...` : t.settings.data.clearCache}
            </button>
          </div>

          {/* 危險操作區 */}
          <div className="danger-zone">
            <div className="danger-zone-label">{t.settings.data.dangerZone}</div>
            <div className="data-action-card data-action-card--danger">
              <div className="data-action-info">
                <div className="data-action-title">{t.settings.data.resetData}</div>
                <div className="data-action-desc">{t.settings.data.resetDataDesc}</div>
                <div className="data-action-warning">{t.settings.data.resetWarning}</div>
              </div>
              <button
                className="btn btn-danger"
                onClick={() => setShowResetConfirm(true)}
                disabled={isOperating}
              >
                {isResetting ? `${t.settings.data.resetData}...` : t.settings.data.resetData}
              </button>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={showResetConfirm}
        title={t.settings.data.resetData}
        message={`${t.settings.data.resetDataDesc} ${t.settings.data.resetWarning}`}
        confirmText={t.settings.data.resetData}
        variant="danger"
        isProcessing={isResetting}
        onConfirm={() => void handleResetData()}
        onCancel={() => setShowResetConfirm(false)}
      />
    </>
  );
}
