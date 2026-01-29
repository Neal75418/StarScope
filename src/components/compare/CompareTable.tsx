/**
 * Comparison table component.
 */

import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ComparisonGroupDetail } from "../../api/client";
import { formatNumber, formatDelta, formatVelocity } from "../../utils/format";
import { useI18n } from "../../i18n";

interface CompareTableProps {
  members: ComparisonGroupDetail["members"];
  onRemoveRepo: (repoId: number) => void;
}

function getGradeColor(grade: string | null): string {
  if (!grade) return "var(--gray-400)";
  if (grade.startsWith("A")) return "var(--success-color)";
  if (grade.startsWith("B")) return "#22c55e";
  if (grade.startsWith("C")) return "var(--warning-color)";
  return "var(--danger-color)";
}

function CompareTableRow({
  member,
  onRemove,
  removeTitle,
}: {
  member: ComparisonGroupDetail["members"][0];
  onRemove: () => void;
  removeTitle: string;
}) {
  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await openUrl(member.url);
  };

  return (
    <tr>
      <td>
        <a href={member.url} onClick={handleLinkClick} className="compare-repo-link">
          {member.full_name}
        </a>
      </td>
      <td>
        <span className="compare-language">{member.language || "-"}</span>
      </td>
      <td className="compare-number">{member.stars !== null ? formatNumber(member.stars) : "-"}</td>
      <td className="compare-delta">
        {member.stars_delta_7d !== null ? formatDelta(member.stars_delta_7d) : "-"}
      </td>
      <td className="compare-delta">
        {member.stars_delta_30d !== null ? formatDelta(member.stars_delta_30d) : "-"}
      </td>
      <td className="compare-number">
        {member.velocity !== null ? formatVelocity(member.velocity) : "-"}
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
        <button className="btn btn-sm btn-danger" onClick={onRemove} title={removeTitle}>
          &times;
        </button>
      </td>
    </tr>
  );
}

export function CompareTable({ members, onRemoveRepo }: CompareTableProps) {
  const { t } = useI18n();

  return (
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
          {members.map((member) => (
            <CompareTableRow
              key={member.repo_id}
              member={member}
              onRemove={() => onRemoveRepo(member.repo_id)}
              removeTitle={t.repo.remove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
