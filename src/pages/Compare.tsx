/**
 * Compare page - compare multiple repositories side by side.
 */

import { useState, useEffect } from "react";
import {
  ComparisonGroup,
  ComparisonGroupDetail,
  listComparisonGroups,
  getComparisonGroup,
  createComparisonGroup,
  deleteComparisonGroup,
  removeRepoFromComparison,
} from "../api/client";
import { formatNumber, formatDelta, formatVelocity } from "../utils/format";
import { getErrorMessage } from "../utils/error";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { useI18n } from "../i18n";

export function Compare() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ComparisonGroupDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; groupId: number | null }>({
    isOpen: false,
    groupId: null,
  });
  const toast = useToast();

  // Load groups
  const loadGroups = async () => {
    try {
      const response = await listComparisonGroups();
      setGroups(response.groups);
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    }
  };

  // Load group details
  const loadGroupDetail = async (groupId: number) => {
    try {
      const detail = await getComparisonGroup(groupId);
      setSelectedGroup(detail);
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    try {
      await createComparisonGroup(newGroupName.trim(), newGroupDesc.trim() || undefined);
      setNewGroupName("");
      setNewGroupDesc("");
      setShowCreateForm(false);
      toast.success(t.compare.toast.groupCreated);
      loadGroups();
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    }
  };

  const handleDeleteGroup = (groupId: number) => {
    setDeleteConfirm({ isOpen: true, groupId });
  };

  const confirmDeleteGroup = async () => {
    if (!deleteConfirm.groupId) return;

    try {
      await deleteComparisonGroup(deleteConfirm.groupId);
      if (selectedGroup?.group_id === deleteConfirm.groupId) {
        setSelectedGroup(null);
      }
      toast.success(t.compare.toast.groupDeleted);
      loadGroups();
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    } finally {
      setDeleteConfirm({ isOpen: false, groupId: null });
    }
  };

  const handleRemoveRepo = async (repoId: number) => {
    if (!selectedGroup) return;

    try {
      await removeRepoFromComparison(selectedGroup.group_id, repoId);
      loadGroupDetail(selectedGroup.group_id);
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    }
  };

  const getGradeColor = (grade: string | null): string => {
    if (!grade) return "var(--gray-400)";
    if (grade.startsWith("A")) return "var(--success-color)";
    if (grade.startsWith("B")) return "#22c55e";
    if (grade.startsWith("C")) return "var(--warning-color)";
    return "var(--danger-color)";
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.compare.loading}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t.compare.title}</h1>
        <p className="subtitle">{t.compare.subtitle}</p>
      </header>

      <div className="compare-layout">
        {/* Sidebar - Group List */}
        <div className="compare-sidebar">
          <div className="compare-sidebar-header">
            <h3>{t.compare.sidebar.title}</h3>
            <button
              className="btn btn-sm"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              +
            </button>
          </div>

          {showCreateForm && (
            <form className="compare-create-form" onSubmit={handleCreateGroup}>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder={t.compare.form.groupNamePlaceholder}
                autoFocus
              />
              <input
                type="text"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder={t.compare.form.description}
              />
              <div className="compare-form-actions">
                <button type="submit" className="btn btn-sm btn-primary">
                  {t.compare.form.create}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowCreateForm(false)}
                >
                  {t.common.cancel}
                </button>
              </div>
            </form>
          )}

          <div className="compare-group-list">
            {groups.length === 0 ? (
              <div className="compare-empty">
                {t.compare.noGroups}
              </div>
            ) : (
              groups.map((group) => (
                <div
                  key={group.id}
                  className={`compare-group-item ${
                    selectedGroup?.group_id === group.id ? "selected" : ""
                  }`}
                  onClick={() => loadGroupDetail(group.id)}
                >
                  <div className="compare-group-info">
                    <span className="compare-group-name">{group.name}</span>
                    <span className="compare-group-count">
                      {group.member_count} {group.member_count === 1 ? "repo" : "repos"}
                    </span>
                  </div>
                  <button
                    className="compare-group-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(group.id);
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Content - Comparison Table */}
        <div className="compare-main">
          {!selectedGroup ? (
            <div className="compare-placeholder">
              <p>{t.compare.placeholder.selectGroup}</p>
              <p className="hint">
                {t.compare.placeholder.addReposHint}
              </p>
            </div>
          ) : selectedGroup.members.length === 0 ? (
            <div className="compare-placeholder">
              <h2>{selectedGroup.group_name}</h2>
              <p>{t.compare.placeholder.emptyGroup}</p>
              <p className="hint">
                {t.compare.placeholder.addReposButton}
              </p>
            </div>
          ) : (
            <>
              <div className="compare-header">
                <h2>{selectedGroup.group_name}</h2>
                {selectedGroup.description && (
                  <p className="compare-description">{selectedGroup.description}</p>
                )}
              </div>

              {/* Summary Cards */}
              <div className="compare-summary">
                <div className="compare-summary-card">
                  <div className="compare-summary-label">{t.compare.summary.leaderByStars}</div>
                  <div className="compare-summary-value">
                    {selectedGroup.summary.leader_by_stars || "-"}
                  </div>
                </div>
                <div className="compare-summary-card">
                  <div className="compare-summary-label">{t.compare.summary.leaderByVelocity}</div>
                  <div className="compare-summary-value">
                    {selectedGroup.summary.leader_by_velocity || "-"}
                  </div>
                </div>
                <div className="compare-summary-card">
                  <div className="compare-summary-label">{t.compare.summary.leaderByHealth}</div>
                  <div className="compare-summary-value">
                    {selectedGroup.summary.leader_by_health || "-"}
                  </div>
                </div>
                <div className="compare-summary-card">
                  <div className="compare-summary-label">{t.compare.summary.totalStars}</div>
                  <div className="compare-summary-value">
                    {formatNumber(selectedGroup.summary.total_stars)}
                  </div>
                </div>
              </div>

              {/* Comparison Table */}
              <div className="compare-table-container">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>{t.compare.table.repository}</th>
                      <th>{t.compare.table.language}</th>
                      <th>{t.compare.table.stars}</th>
                      <th>{t.compare.table.delta7d}</th>
                      <th>{t.compare.table.delta30d}</th>
                      <th>{t.compare.table.velocity}</th>
                      <th>{t.compare.table.health}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroup.members.map((member) => (
                      <tr key={member.repo_id}>
                        <td>
                          <a
                            href={member.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="compare-repo-link"
                          >
                            {member.full_name}
                          </a>
                        </td>
                        <td>
                          <span className="compare-language">
                            {member.language || "-"}
                          </span>
                        </td>
                        <td className="compare-number">
                          {member.stars !== null ? formatNumber(member.stars) : "-"}
                        </td>
                        <td className="compare-delta">
                          {member.stars_delta_7d !== null
                            ? formatDelta(member.stars_delta_7d)
                            : "-"}
                        </td>
                        <td className="compare-delta">
                          {member.stars_delta_30d !== null
                            ? formatDelta(member.stars_delta_30d)
                            : "-"}
                        </td>
                        <td className="compare-number">
                          {member.velocity !== null
                            ? formatVelocity(member.velocity)
                            : "-"}
                        </td>
                        <td>
                          {member.health_grade ? (
                            <span
                              className="compare-health-badge"
                              style={{ color: getGradeColor(member.health_grade) }}
                            >
                              {member.health_grade}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleRemoveRepo(member.repo_id)}
                            title={t.repo.remove}
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={t.compare.confirm.deleteTitle}
        message={t.compare.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={confirmDeleteGroup}
        onCancel={() => setDeleteConfirm({ isOpen: false, groupId: null })}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
