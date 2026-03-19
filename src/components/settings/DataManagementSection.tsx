/**
 * 資料管理設定區塊。
 * 提供清除快取與重置所有資料的操作。
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { clearCache, resetAllData } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";

interface DataManagementSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function DataManagementSection({ onToast }: DataManagementSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await clearCache();
      // 使所有 React Query 快取失效，強制重新拉取
      await queryClient.invalidateQueries();
      onToast(t.settings.data.toast.cacheCleared, "success");
    } catch {
      onToast(t.common.error, "error");
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleResetData = async () => {
    setShowResetConfirm(false);
    setIsResetting(true);
    try {
      await resetAllData();
      // 清除所有快取
      queryClient.clear();
      onToast(t.settings.data.toast.dataReset, "success");
    } catch {
      onToast(t.common.error, "error");
    } finally {
      setIsResetting(false);
    }
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
            <button
              className="btn"
              onClick={() => void handleClearCache()}
              disabled={isClearingCache}
            >
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
                disabled={isResetting}
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
        onConfirm={() => void handleResetData()}
        onCancel={() => setShowResetConfirm(false)}
      />
    </>
  );
}
