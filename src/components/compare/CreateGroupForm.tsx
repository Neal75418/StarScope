/**
 * Create comparison group form component.
 */

import { useState, FormEvent } from "react";
import { useI18n } from "../../i18n";

interface CreateGroupFormProps {
  onSubmit: (name: string, description?: string) => Promise<boolean>;
  onCancel: () => void;
}

export function CreateGroupForm({ onSubmit, onCancel }: CreateGroupFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const success = await onSubmit(name.trim(), description.trim() || undefined);
    if (success) {
      setName("");
      setDescription("");
      onCancel();
    }
  };

  return (
    <form className="compare-create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.compare.form.groupNamePlaceholder}
        autoFocus
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t.compare.form.description}
      />
      <div className="compare-form-actions">
        <button type="submit" className="btn btn-sm btn-primary">
          {t.compare.form.create}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
