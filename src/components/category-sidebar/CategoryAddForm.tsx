/**
 * Form for adding a new category.
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const success = await onSubmit(name.trim());
    if (success) {
      setName("");
      onCancel();
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
      />
      <button type="submit" className="btn btn-sm btn-primary">
        {t.categories.add}
      </button>
      <button type="button" className="btn btn-sm" onClick={handleCancel}>
        {t.categories.cancel}
      </button>
    </form>
  );
}
