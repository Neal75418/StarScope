/**
 * Compare page main content component.
 */

import { ReactNode } from "react";
import { ComparisonGroupDetail } from "../../api/client";
import { useI18n } from "../../i18n";
import { CompareSummary } from "./CompareSummary";
import { CompareTable } from "./CompareTable";
import { ComparisonChart } from "./ComparisonChart";
import { VelocityComparison } from "./VelocityComparison";

interface CompareContentProps {
  selectedGroup: ComparisonGroupDetail | null;
  onRemoveRepo: (repoId: number) => void;
}

function Placeholder({ children }: { children: ReactNode }) {
  return <div className="compare-placeholder">{children}</div>;
}

export function CompareContent({ selectedGroup, onRemoveRepo }: CompareContentProps) {
  const { t } = useI18n();

  if (!selectedGroup) {
    return (
      <div className="compare-main">
        <Placeholder>
          <p>{t.compare.placeholder.selectGroup}</p>
          <p className="hint">{t.compare.placeholder.addReposHint}</p>
        </Placeholder>
      </div>
    );
  }

  if (selectedGroup.members.length === 0) {
    return (
      <div className="compare-main">
        <Placeholder>
          <h2>{selectedGroup.group_name}</h2>
          <p>{t.compare.placeholder.emptyGroup}</p>
          <p className="hint">{t.compare.placeholder.addReposButton}</p>
        </Placeholder>
      </div>
    );
  }

  return (
    <div className="compare-main">
      <div className="compare-header">
        <h2>{selectedGroup.group_name}</h2>
        {selectedGroup.description && (
          <p className="compare-description">{selectedGroup.description}</p>
        )}
      </div>

      <CompareSummary summary={selectedGroup.summary} />
      <ComparisonChart groupId={selectedGroup.group_id} />
      <VelocityComparison groupId={selectedGroup.group_id} />
      <CompareTable members={selectedGroup.members} onRemoveRepo={onRemoveRepo} />
    </div>
  );
}
