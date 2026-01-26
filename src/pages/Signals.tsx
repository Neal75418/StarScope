/**
 * Signals page - view and manage early signals.
 */

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { SignalCard, SignalSummaryCards, SignalToolbar } from "../components/signals";
import { useI18n } from "../i18n";
import { useSignals } from "../hooks/useSignals";
import { useSignalActions } from "../hooks/useSignalActions";

export function Signals() {
  const { t } = useI18n();
  const toast = useToast();
  const signalsState = useSignals();
  const actions = useSignalActions({
    filterType: signalsState.filterType,
    reload: signalsState.reload,
    toast,
  });

  if (signalsState.isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.signals.loading}</div>
      </div>
    );
  }

  const hasUnacknowledged = signalsState.signals.some((s) => !s.acknowledged);

  return (
    <div className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.signals.title}</h1>
        <p className="subtitle">{t.signals.subtitle}</p>
      </header>

      {signalsState.summary && <SignalSummaryCards summary={signalsState.summary} />}

      <SignalToolbar
        filterType={signalsState.filterType}
        setFilterType={signalsState.setFilterType}
        filterSeverity={signalsState.filterSeverity}
        setFilterSeverity={signalsState.setFilterSeverity}
        showAcknowledged={signalsState.showAcknowledged}
        setShowAcknowledged={signalsState.setShowAcknowledged}
        hasUnacknowledged={hasUnacknowledged}
        isDetecting={actions.isDetecting}
        onAcknowledgeAll={actions.openAcknowledgeAllDialog}
        onRunDetection={actions.handleRunDetection}
      />

      <div className="signals-list" data-testid="signals-list">
        {signalsState.signals.length === 0 ? (
          <div className="signals-empty" data-testid="empty-state">
            <p>{t.signals.emptyState.noSignals}</p>
            <p className="hint">
              {signalsState.showAcknowledged
                ? t.signals.emptyState.noMatch
                : t.signals.emptyState.allAcknowledged}
            </p>
          </div>
        ) : (
          signalsState.signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              onAcknowledge={actions.handleAcknowledge}
              onDelete={actions.openDeleteDialog}
            />
          ))
        )}
      </div>

      {signalsState.error && (
        <div className="error-banner">
          {signalsState.error}
          <button onClick={() => signalsState.setError(null)}>x</button>
        </div>
      )}

      <ConfirmDialog
        isOpen={actions.confirmDialog.isOpen && actions.confirmDialog.type === "acknowledgeAll"}
        title={t.signals.confirm.acknowledgeAllTitle}
        message={t.signals.confirm.acknowledgeAllMessage}
        confirmText={t.signals.actions.acknowledgeAll}
        variant="warning"
        onConfirm={actions.confirmAcknowledgeAll}
        onCancel={actions.closeDialog}
      />

      <ConfirmDialog
        isOpen={actions.confirmDialog.isOpen && actions.confirmDialog.type === "delete"}
        title={t.signals.confirm.deleteTitle}
        message={t.signals.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={actions.confirmDelete}
        onCancel={actions.closeDialog}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
