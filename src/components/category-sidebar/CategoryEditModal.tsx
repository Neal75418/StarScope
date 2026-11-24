/**
 * 編輯分類的對話框（名稱、說明、圖示、顏色）。
 */

import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { CategoryTreeNode, CategoryEditFields } from "../../api/client";
import { useI18n } from "../../i18n";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";

interface CategoryEditModalProps {
  category: CategoryTreeNode;
  isSubmitting: boolean;
  onSubmit: (categoryId: number, data: CategoryEditFields) => Promise<boolean>;
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
  const colorInputRef = useRef<HTMLInputElement>(null);

  // 焦點一開始放在名稱欄。不用 autoFocus 屬性：React 會搶在 useFocusTrap 記下「先前的焦點」之前聚焦，
  // 關閉時焦點就回不到側欄的編輯鈕。這個 effect 要排在 useFocusTrap 之後
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // 只送改過的欄位（名稱也是）：讀分類失敗時框裡是樹上的快取，可能比伺服器舊，沒動的欄位送出去會把
    // 較新的值蓋掉或清掉。什麼都沒改就送空的，後端不動任何欄位。
    // 清空的送 null：送 undefined 的話 JSON 裡沒有這個欄位，後端當成沒改，舊的值會留著
    const data: CategoryEditFields = {};
    if (name.trim() !== category.name) data.name = name.trim();
    if (description !== (category.description ?? "")) data.description = description.trim() || null;
    if (icon !== (category.icon ?? "")) data.icon = icon.trim() || null;
    if (color !== (category.color ?? "")) data.color = color.trim() || null;

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
                <label id="category-edit-color-label" htmlFor="category-edit-color">
                  {t.categories.form.color}
                </label>
                {/* 取色器沒有「空的」狀態（值一定是某個顏色）：沒有顏色時把色塊畫成空的、旁邊寫明未設定，
                    並把「未設定」併進名稱，報讀軟體才不會先唸出 #000000 */}
                <div className="category-color-field">
                  <input
                    ref={colorInputRef}
                    id="category-edit-color"
                    type="color"
                    className={color ? undefined : "category-color-unset"}
                    value={color || "#000000"}
                    onChange={(e) => setColor(e.target.value)}
                    aria-labelledby={
                      color ? undefined : "category-edit-color-label category-edit-color-status"
                    }
                  />
                  {color ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={t.categories.form.clearColorLabel}
                      onClick={() => {
                        setColor("");
                        // 清除鈕會跟著消失：焦點不移過去的話，鍵盤使用者會掉到 body
                        colorInputRef.current?.focus();
                      }}
                    >
                      {t.categories.form.clearColor}
                    </button>
                  ) : (
                    <span id="category-edit-color-status" className="category-color-status">
                      {t.categories.form.colorNotSet}
                    </span>
                  )}
                </div>
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
