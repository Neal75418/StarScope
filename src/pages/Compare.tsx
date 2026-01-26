/**
 * Compare page - compare multiple repositories side by side.
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { CompareSidebar, CompareContent } from "../components/compare";
import { useCompare } from "../hooks/useCompare";
import { useI18n } from "../i18n";

export function Compare() {
  const { t } = useI18n();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const compare = useCompare(toast);

  if (compare.isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.compare.loading}</div>
      </div>
    );
  }

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.compare.title}</h1>
        <p className="subtitle">{t.compare.subtitle}</p>
      </header>

      <div className="compare-layout">
        <CompareSidebar
          groups={compare.groups}
          selectedGroupId={compare.selectedGroup?.group_id ?? null}
          onSelectGroup={compare.loadGroupDetail}
          onEditGroup={compare.handleUpdateGroup}
          onDeleteGroup={compare.deleteConfirm.open}
          onCreateGroup={compare.handleCreateGroup}
        />

        <CompareContent
          selectedGroup={compare.selectedGroup}
          onRemoveRepo={compare.handleRemoveRepo}
        />
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <ConfirmDialog
        isOpen={compare.deleteConfirm.isOpen}
        title={t.compare.confirm.deleteTitle}
        message={t.compare.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={compare.confirmDeleteGroup}
        onCancel={compare.deleteConfirm.close}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </AnimatedPage>
  );
}
