/**
 * Compare page sidebar component.
 */

import { useState } from "react";
import { ComparisonGroup } from "../../api/client";
import { useI18n } from "../../i18n";
import { CreateGroupForm } from "./CreateGroupForm";
import { EditGroupModal } from "./EditGroupModal";
import { GroupList } from "./GroupList";

interface CompareSidebarProps {
  groups: ComparisonGroup[];
  selectedGroupId: number | null;
  onSelectGroup: (groupId: number) => void;
  onEditGroup: (groupId: number, name: string, description?: string) => Promise<boolean>;
  onDeleteGroup: (groupId: number) => void;
  onCreateGroup: (name: string, description?: string) => Promise<boolean>;
}

export function CompareSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  onEditGroup,
  onDeleteGroup,
  onCreateGroup,
}: CompareSidebarProps) {
  const { t } = useI18n();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ComparisonGroup | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEditSubmit = async (groupId: number, name: string, description?: string) => {
    setIsSubmitting(true);
    try {
      return await onEditGroup(groupId, name, description);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="compare-sidebar">
      <div className="compare-sidebar-header">
        <h3>{t.compare.sidebar.title}</h3>
        <button
          data-testid="create-group-btn"
          className="btn btn-sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          +
        </button>
      </div>

      {showCreateForm && (
        <CreateGroupForm
          onSubmit={onCreateGroup}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <GroupList
        groups={groups}
        selectedGroupId={selectedGroupId}
        onSelect={onSelectGroup}
        onEdit={setEditingGroup}
        onDelete={onDeleteGroup}
      />

      {editingGroup && (
        <EditGroupModal
          group={editingGroup}
          isSubmitting={isSubmitting}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}
