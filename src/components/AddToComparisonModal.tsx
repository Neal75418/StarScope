/**
 * Modal for adding a repo to a comparison group.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ComparisonGroup, listComparisonGroups, addRepoToComparison } from "../api/client";
import { useI18n } from "../i18n";

interface AddToComparisonModalProps {
  repoId: number;
  repoName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddToComparisonModal({
  repoId,
  repoName,
  onClose,
  onSuccess,
}: AddToComparisonModalProps) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const response = await listComparisonGroups();
        setGroups(response.groups);
      } catch (err) {
        console.error("Failed to load groups:", err);
        setError(t.compare.loadingError);
      } finally {
        setIsLoading(false);
      }
    };
    void loadGroups();
  }, [t]);

  const handleAddToGroup = async (groupId: number) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await addRepoToComparison(groupId, repoId);
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Failed to add repo to comparison:", err);
      setError(t.compare.toast.addFailed);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal add-to-comparison-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t.compare.addToGroup.title}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-content">
          <p className="add-to-comparison-subtitle">
            {t.compare.addToGroup.subtitle}: <strong>{repoName}</strong>
          </p>

          {isLoading ? (
            <div className="loading">{t.common.loading}</div>
          ) : error ? (
            <div className="error">{error}</div>
          ) : groups.length === 0 ? (
            <div className="empty">
              <p>{t.compare.noGroups}</p>
            </div>
          ) : (
            <div className="comparison-group-select">
              {groups.map((group) => (
                <button
                  key={group.id}
                  className="comparison-group-option"
                  onClick={() => handleAddToGroup(group.id)}
                  disabled={isSubmitting}
                >
                  <span className="group-name">{group.name}</span>
                  <span className="group-count">({group.member_count} repos)</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
