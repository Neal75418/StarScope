/**
 * 編輯分類的對話框（名稱、說明、圖示、顏色）。
 */

import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { CategoryTreeNode, CategoryUpdate } from "../../api/client";
import { useI18n } from "../../i18n";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";

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
  const focusTrapRef = useFocusTrap(true, false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 焦點一開始放在名稱欄。不用 autoFocus 屬性：React 會搶在 useFocusTrap 記下「先前的焦點」之前聚焦，
  // 關閉時焦點就回不到側欄的編輯鈕。這個 effect 要排在 useFocusTrap 之後
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: SyntheticEvent) => {
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
  const overlayDismiss = useOverlayDismiss(onClose, !isSubmitting);

  // 掛到 document.body（同 ConfirmDialog、AddRepoDialog）：遮罩是 position: fixed，祖先只要帶著 transform
  // 就會改成相對那個祖先定位，而頁面容器在進場動畫期間有 transform
  return createPortal(
    <div className="dialog-overlay" {...overlayDismiss} role="presentation">
      <div
        ref={focusTrapRef}
        className="dialog category-edit-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-edit-dialog-title"
      >
        <div className="dialog-header">
          <h2 id="category-edit-dialog-title">{t.categories.editCategory}</h2>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label={t.common.close}
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            <div className="form-group">
              <label htmlFor="category-edit-name">{t.categories.form.name}</label>
              <input
                ref={nameInputRef}
                id="category-edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.categories.namePlaceholder}
                required
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
          <div className="dialog-footer">
            <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
              {t.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t.categories.saving : t.categories.save}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
