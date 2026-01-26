/**
 * Modal for editing comparison group details.
 */

import { useState, FormEvent } from "react";
import { ComparisonGroup } from "../../api/client";
import { useI18n } from "../../i18n";

interface EditGroupModalProps {
  group: ComparisonGroup;
  isSubmitting: boolean;
  onSubmit: (groupId: number, name: string, description?: string) => Promise<boolean>;
  onClose: () => void;
}

export function EditGroupModal({ group, isSubmitting, onSubmit, onClose }: EditGroupModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const success = await onSubmit(group.id, name.trim(), description.trim() || undefined);
    if (success) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-group-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t.compare.form.editGroup}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            <div className="form-group">
              <label>{t.compare.form.groupName}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.compare.form.groupNamePlaceholder}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>{t.compare.form.description}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.compare.form.descriptionPlaceholder}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t.compare.form.saving : t.compare.form.save}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
