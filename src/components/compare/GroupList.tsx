/**
 * Comparison group list component.
 */

import { ComparisonGroup } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";

interface GroupListProps {
  groups: ComparisonGroup[];
  selectedGroupId: number | null;
  onSelect: (groupId: number) => void;
  onEdit: (group: ComparisonGroup) => void;
  onDelete: (groupId: number) => void;
}

function GroupItem({
  group,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  group: ComparisonGroup;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className={`compare-group-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="compare-group-info">
        <span className="compare-group-name">{group.name}</span>
        <span className="compare-group-count">
          {interpolate(t.compare.sidebar.repoCount, { count: group.member_count })}
        </span>
      </div>
      <button
        className="compare-group-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title={t.compare.form.editGroup}
      >
        &#9998;
      </button>
      <button
        className="compare-group-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t.compare.sidebar.deleteGroup}
      >
        &times;
      </button>
    </div>
  );
}

export function GroupList({ groups, selectedGroupId, onSelect, onEdit, onDelete }: GroupListProps) {
  const { t } = useI18n();

  if (groups.length === 0) {
    return (
      <div className="compare-group-list" data-testid="group-list">
        <div className="compare-empty" data-testid="empty-state">
          {t.compare.noGroups}
        </div>
      </div>
    );
  }

  return (
    <div className="compare-group-list" data-testid="group-list">
      {groups.map((group) => (
        <GroupItem
          key={group.id}
          group={group}
          isSelected={selectedGroupId === group.id}
          onSelect={() => onSelect(group.id)}
          onEdit={() => onEdit(group)}
          onDelete={() => onDelete(group.id)}
        />
      ))}
    </div>
  );
}
