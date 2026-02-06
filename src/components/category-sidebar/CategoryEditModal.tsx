/**
 * 編輯分類詳細資訊的 modal。
 */

import { useState, FormEvent } from "react";
import { CategoryTreeNode, CategoryUpdate } from "../../api/client";
import { useI18n } from "../../i18n";

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal category-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t.categories.editCategory}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            <div className="form-group">
              <label>{t.categories.form.name}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.categories.namePlaceholder}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>{t.categories.form.description}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.categories.form.descriptionPlaceholder}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.categories.form.icon}</label>
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder={t.categories.form.iconPlaceholder}
                  maxLength={2}
                />
              </div>
              <div className="form-group">
                <label>{t.categories.form.color}</label>
                <input
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
            <button type="button" className="btn" onClick={onClose}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
