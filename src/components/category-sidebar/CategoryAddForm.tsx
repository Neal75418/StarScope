/**
 * 新增分類的表單。
 */

import { useState, FormEvent } from "react";
import { useI18n } from "../../i18n";

interface CategoryAddFormProps {
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

export function CategoryAddForm({ onSubmit, onCancel }: CategoryAddFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !name.trim()) return;

    setIsSubmitting(true);
    setError(false);
    try {
      const success = await onSubmit(name.trim());
      if (success) {
        setName("");
        onCancel();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setName("");
    onCancel();
  };

  return (
    <form className="category-add-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.categories.namePlaceholder}
        autoFocus
        disabled={isSubmitting}
      />
      <button
        type="submit"
        className="btn btn-sm btn-primary"
        disabled={isSubmitting || !name.trim()}
      >
        {isSubmitting ? t.common.loading : t.categories.add}
      </button>
      <button type="button" className="btn btn-sm" onClick={handleCancel} disabled={isSubmitting}>
        {t.categories.cancel}
      </button>
      {error && (
        <span className="category-add-error" role="alert">
          {t.common.error}
        </span>
      )}
    </form>
  );
}
