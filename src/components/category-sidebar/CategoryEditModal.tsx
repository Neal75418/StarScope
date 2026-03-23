/**
 * 編輯分類詳細資訊的 modal。
 */

import { useState, FormEvent } from "react";
import { CategoryTreeNode, CategoryUpdate } from "../../api/client";
import { useI18n } from "../../i18n";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface CategoryEditModalProps {
  category: CategoryTreeNode;
  isSubmitting: boolean;
  onSubmit: (categoryId: number, data: CategoryUpdate) => Promise<boolean>;
  onClose: () => void;
}

export function CategoryEditModal({
  category,
  isSubmitting,
  onSubmit,
  onClose,
}: CategoryEditModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [icon, setIcon] = useState(category.icon ?? "");
  const [color, setColor] = useState(category.color ?? "");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const data: CategoryUpdate = {
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon.trim() || undefined,
      color: color.trim() || undefined,
    };

    const success = await onSubmit(category.id, data);
    if (success) {
      onClose();
    }
  };

  useEscapeKey(onClose, !isSubmitting);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal category-edit-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-edit-modal-title"
      >
        <div className="modal-header">
          <h3 id="category-edit-modal-title">{t.categories.editCategory}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t.common.close}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            <div className="form-group">
              <label htmlFor="category-edit-name">{t.categories.form.name}</label>
              <input
                id="category-edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.categories.namePlaceholder}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="category-edit-desc">{t.categories.form.description}</label>
              <input
                id="category-edit-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.categories.form.descriptionPlaceholder}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="category-edit-icon">{t.categories.form.icon}</label>
                <input
                  id="category-edit-icon"
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder={t.categories.form.iconPlaceholder}
                  maxLength={2}
                />
              </div>
              <div className="form-group">
                <label htmlFor="category-edit-color">{t.categories.form.color}</label>
                <input
                  id="category-edit-color"
                  type="color"
                  value={color || "#000000"}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t.categories.saving : t.categories.save}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
